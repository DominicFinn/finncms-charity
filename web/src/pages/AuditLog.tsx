import type { AuditEntry } from "@ccm/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Empty, ErrorState, Loading } from "@/components/States";
import { UserSelect } from "@/components/UserSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNameLookup } from "@/hooks/api";
import { api } from "@/lib/api";
import { formatDateTime, humanise } from "@/lib/format";

export function AuditLogPage() {
  const [actorUid, setActorUid] = useState("");
  const [entity, setEntity] = useState("");
  const [clientId, setClientId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const input = {
    actorUid: actorUid || undefined,
    entity: entity.trim() || undefined,
    clientId: clientId.trim() || undefined,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
    limit: 100,
  };
  const list = useInfiniteQuery({
    queryKey: ["audit.list", input],
    queryFn: ({ pageParam }) => api("audit.list", { ...input, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title="Audit log" description="Every view and change, through the app, through Claude (MCP) and by the system. Entries can't be edited or deleted." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Person"><UserSelect value={actorUid} onChange={(e) => setActorUid(e.target.value)} emptyLabel="Anyone" /></Field>
        <Field label="Record type" hint="For example client, note, session."><Input value={entity} onChange={(e) => setEntity(e.target.value)} /></Field>
        <Field label="Client id"><Input value={clientId} onChange={(e) => setClientId(e.target.value)} /></Field>
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorState error={list.error} />
      ) : items.length === 0 ? (
        <Empty>No entries match.</Empty>
      ) : (
        <>
          <ul className="flex flex-col gap-2">{items.map((e) => <Entry key={e.id} e={e} />)}</ul>
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

function Entry({ e }: { e: AuditEntry }) {
  const name = useNameLookup();
  const actor = e.actorUid === "system" ? "System" : (e.actorEmail ?? name(e.actorUid));
  return (
    <li className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{formatDateTime(e.at)}</span>
        <span className="font-medium">{actor}</span>
        <Badge variant={e.action === "denied" ? "destructive" : "secondary"}>{humanise(e.action)}</Badge>
        <span>{e.entity}{e.entityId ? ` ${e.entityId}` : ""}</span>
        <Badge variant="outline">{e.channel.toUpperCase()}</Badge>
        {e.clientId && <Link to={`/clients/${e.clientId}`} className="underline-offset-4 hover:underline">Client record</Link>}
      </div>
      {e.detail && <p className="text-muted-foreground">{e.detail}</p>}
      {e.diffHidden ? (
        <p className="text-muted-foreground italic">Values hidden: you don't have permission to see this kind of record.</p>
      ) : e.diff === null ? (
        <p className="text-muted-foreground italic">Values removed when the client was anonymised.</p>
      ) : e.diff ? (
        <details>
          <summary className="cursor-pointer">Changes</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Before</div>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(e.diff.before ?? null, null, 2)}</pre>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground">After</div>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(e.diff.after ?? null, null, 2)}</pre>
            </div>
          </div>
        </details>
      ) : null}
    </li>
  );
}
