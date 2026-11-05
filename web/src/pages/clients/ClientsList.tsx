import { clientDisplayName, type ClientSummary } from "@ccm/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Plus, Search, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Can } from "@/components/RequirePermission";
import { Empty, ErrorState, Loading } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { useHelpCategories } from "@/hooks/api";
import { useAuth } from "@/hooks/auth";
import { api } from "@/lib/api";
import { formatDate, humanise } from "@/lib/format";

type Status = "active" | "restricted" | "anonymised" | "all";

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ClientsListPage() {
  const { can } = useAuth();
  const cats = useHelpCategories();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [helpCategoryId, setHelpCategoryId] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const q = useDebounced(search.trim());

  const input = { search: q || undefined, status, helpCategoryId: helpCategoryId || undefined, flaggedOnly, limit: 50 };
  const list = useInfiniteQuery({
    queryKey: ["clients.list", input],
    queryFn: ({ pageParam }) => api("clients.list", { ...input, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const catName = (id: string) => cats.data?.find((c) => c.id === id)?.name ?? "";

  return (
    <>
      <PageHeader
        title="Clients"
        actions={
          <Can need="clients.create">
            <Button asChild>
              <Link to="/clients/new"><Plus /> New client</Link>
            </Button>
          </Can>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2">
          <Field label="Search">
            <Input type="search" placeholder="Name or postcode" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </Field>
          <Search className="pointer-events-none absolute bottom-3.5 left-3 size-4 text-muted-foreground" aria-hidden />
        </div>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="active">Active</option>
            <option value="restricted">Restricted</option>
            <option value="anonymised">Anonymised</option>
            <option value="all">All</option>
          </Select>
        </Field>
        <Field label="Help category">
          <Select value={helpCategoryId} onChange={(e) => setHelpCategoryId(e.target.value)}>
            <option value="">Any</option>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {can("safeguarding.view") && (
          <Checkbox label="Only clients with open safeguarding concerns" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} className="sm:col-span-2" />
        )}
      </div>

      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorState error={list.error} />
      ) : items.length === 0 ? (
        <Empty>No clients match.</Empty>
      ) : (
        <>
          {/* Phones get cards, wider screens a table. */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {items.map((c) => (
              <li key={c.id}>
                <Link to={`/clients/${c.id}`} className="flex flex-col gap-1 rounded-lg border bg-card p-3">
                  <span className="flex items-center gap-2 font-semibold">
                    {displayName(c)} <Flags c={c} />
                  </span>
                  <span className="text-sm text-muted-foreground">{[c.town, c.postcodeDistrict].filter(Boolean).join(", ")}</span>
                  <span className="text-xs text-muted-foreground">{c.helpCategoryIds.map(catName).filter(Boolean).join(", ")}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden rounded-lg border bg-card sm:block">
            <Table>
              <THead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Area</Th>
                  <Th>Help</Th>
                  <Th>Last activity</Th>
                </Tr>
              </THead>
              <TBody>
                {items.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <Link to={`/clients/${c.id}`} className="flex items-center gap-2 font-medium underline-offset-4 hover:underline">
                        {displayName(c)} <Flags c={c} />
                      </Link>
                    </Td>
                    <Td>{[c.town, c.postcodeDistrict].filter(Boolean).join(", ")}</Td>
                    <Td className="max-w-64 truncate">{c.helpCategoryIds.map(catName).filter(Boolean).join(", ")}</Td>
                    <Td>{formatDate(c.lastActivityAt)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
          {list.hasNextPage && (
            <Button variant="outline" className="mt-4" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              Load more
            </Button>
          )}
        </>
      )}
    </>
  );
}

function displayName(c: ClientSummary) {
  return c.status === "anonymised" ? "Anonymised client" : clientDisplayName(c);
}

function Flags({ c }: { c: ClientSummary }) {
  return (
    <>
      {!!c.openSafeguardingConcerns && (
        <Badge variant="destructive" title="Open safeguarding concern">
          <ShieldAlert className="size-3.5" aria-hidden /> Safeguarding
        </Badge>
      )}
      {c.status !== "active" && <Badge variant="outline">{humanise(c.status)}</Badge>}
    </>
  );
}
