import { cn } from "@/lib/utils";
import { REPORT_DIMENSIONS, type ReportDimension, type ReportFilters, type ReportResult } from "@ccm/shared";
import { Download } from "lucide-react";
import { useState } from "react";
import { BarChart } from "@/components/BarChart";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Empty, MutationError, QueryView } from "@/components/States";
import { UserSelect } from "@/components/UserSelect";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHelpCategories, useOp, useQuestionSets, useSessionLocations, useSessionTypes } from "@/hooks/api";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { downloadFile } from "@/lib/utils";

type Kind = "outcomes" | "demand" | "activity";

const DIMENSION_LABELS: Record<ReportDimension, string> = {
  town: "Town",
  postcodeDistrict: "Postcode district",
  location: "Location",
  helpCategory: "Help category",
  sessionType: "Session type",
  staff: "Staff member",
  month: "Month",
};

export function ReportsPage() {
  const [kind, setKind] = useState<Kind>("demand");
  const [filters, setFilters] = useState<ReportFilters>({});
  const [dimension, setDimension] = useState<ReportDimension | "">("helpCategory");
  const [setId, setSetId] = useState("");
  const sets = useQuestionSets("outcome");
  const outcomeSet = setId || sets.data?.[0]?.id || "";

  return (
    <>
      <PageHeader title="Reports" description="Figures include anonymised clients, so they cover the whole history of the service." />
      <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
        <TabsList aria-label="Report">
          <TabsTrigger value="demand">Demand</TabsTrigger>
          <TabsTrigger value="outcomes">Outcomes</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4 grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader><CardTitle className="text-base">Filters</CardTitle></CardHeader>
          <CardContent>
            <Filters
              kind={kind}
              filters={filters}
              setFilters={setFilters}
              dimension={dimension}
              setDimension={setDimension}
              setId={outcomeSet}
              setSetId={setSetId}
              sets={sets.data ?? []}
            />
          </CardContent>
        </Card>
        <ReportBody kind={kind} filters={filters} dimension={dimension || null} setId={outcomeSet} />
      </div>
    </>
  );
}

function Filters({
  kind,
  filters,
  setFilters,
  dimension,
  setDimension,
  setId,
  setSetId,
  sets,
}: {
  kind: Kind;
  filters: ReportFilters;
  setFilters: (f: ReportFilters) => void;
  dimension: ReportDimension | "";
  setDimension: (d: ReportDimension | "") => void;
  setId: string;
  setSetId: (s: string) => void;
  sets: { id: string; name: string }[];
}) {
  const cats = useHelpCategories(true);
  const types = useSessionTypes(true);
  const locations = useSessionLocations(true);
  const set = (k: keyof ReportFilters, v: string) => setFilters({ ...filters, [k]: v || undefined });
  return (
    <div className="flex flex-col gap-3">
      {kind === "outcomes" && (
        <Field label="Outcome measure">
          <Select value={setId} onChange={(e) => setSetId(e.target.value)}>
            {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Split by">
        <Select value={dimension} onChange={(e) => setDimension(e.target.value as ReportDimension | "")}>
          <option value="">No split (totals)</option>
          {REPORT_DIMENSIONS.map((d) => <option key={d} value={d}>{DIMENSION_LABELS[d]}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From"><Input type="date" value={filters.from ?? ""} onChange={(e) => set("from", e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={filters.to ?? ""} onChange={(e) => set("to", e.target.value)} /></Field>
      </div>
      <Field label="Town"><Input value={filters.town ?? ""} onChange={(e) => set("town", e.target.value)} /></Field>
      <Field label="Postcode district" hint="For example NG7."><Input value={filters.postcodeDistrict ?? ""} onChange={(e) => set("postcodeDistrict", e.target.value.toUpperCase())} /></Field>
      <Field label="Location">
        <Select value={filters.locationId ?? ""} onChange={(e) => set("locationId", e.target.value)}>
          <option value="">Any</option>
          {locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}{l.archived ? " (archived)" : ""}</option>)}
        </Select>
      </Field>
      <Field label="Help category">
        <Select value={filters.helpCategoryId ?? ""} onChange={(e) => set("helpCategoryId", e.target.value)}>
          <option value="">Any</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Session type">
        <Select value={filters.sessionTypeId ?? ""} onChange={(e) => set("sessionTypeId", e.target.value)}>
          <option value="">Any</option>
          {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </Field>
      <Field label="Staff member">
        <UserSelect value={filters.staffUid ?? ""} onChange={(e) => set("staffUid", e.target.value)} emptyLabel="Anyone" />
      </Field>
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setFilters({})}>Clear filters</Button>
    </div>
  );
}

function ReportBody({ kind, filters, dimension, setId }: { kind: Kind; filters: ReportFilters; dimension: ReportDimension | null; setId: string }) {
  const outcomes = useOp("reports.outcomes", { setId, filters, dimension }, { enabled: kind === "outcomes" && !!setId });
  const demand = useOp("reports.demand", { filters, dimension }, { enabled: kind === "demand" });
  const activity = useOp("reports.activity", { filters, dimension }, { enabled: kind === "activity" });
  const query = kind === "outcomes" ? outcomes : kind === "demand" ? demand : activity;
  const [exportError, setExportError] = useState<unknown>(null);

  if (kind === "outcomes" && !setId) return <Empty>Set up an outcome measure first.</Empty>;

  return (
    <QueryView query={query}>
      {(r) => (
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>{r.title}</CardTitle>
              <p className="text-sm text-muted-foreground">Generated {formatDateTime(r.generatedAt)}</p>
            </div>
            <Button
              variant="outline"
              onClick={async () => {
                setExportError(null);
                try {
                  const { fileName, csv } = await api("reports.exportCsv", { report: kind, setId: kind === "outcomes" ? setId : undefined, filters, dimension });
                  downloadFile(fileName, csv, "text/csv;charset=utf-8");
                } catch (e) {
                  setExportError(e);
                }
              }}
            >
              <Download /> Export CSV
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <MutationError error={exportError} />
            {r.notes?.map((n, i) => <p key={i} className="text-sm text-muted-foreground">{n}</p>)}
            <ReportTable report={r} />
          </CardContent>
        </Card>
      )}
    </QueryView>
  );
}

function ReportTable({ report: r }: { report: ReportResult }) {
  const [chartCol, setChartCol] = useState(r.columns[0]?.key ?? "");
  const col = r.columns.find((c) => c.key === chartCol) ?? r.columns[0];
  if (r.rows.length === 0) return <Empty>No data for these filters.</Empty>;
  const fmt = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? "" : Number.isInteger(n) ? n.toLocaleString("en-GB") : n.toFixed(1));
  return (
    <>
      {col && r.rows.length > 1 && (
        <div className="flex flex-col gap-3">
          {r.columns.length > 1 && (
            <Field label="Chart" className="max-w-xs">
              <Select value={col.key} onChange={(e) => setChartCol(e.target.value)}>
                {r.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </Select>
            </Field>
          )}
          <BarChart valueLabel={col.label} rows={r.rows.map((row) => ({ label: row.label, value: row.values[col.key] ?? 0 }))} format={(n) => fmt(n)} />
        </div>
      )}
      <div className="overflow-x-auto">
      <Table>
        <THead>
          <Tr>
            <Th>{r.dimension ? DIMENSION_LABELS[r.dimension] : ""}</Th>
            {r.columns.map((c) => <Th key={c.key} className={cn("text-right align-bottom", c.label.length > 24 && "min-w-32")}>{c.label}</Th>)}
          </Tr>
        </THead>
        <TBody>
          {r.rows.map((row) => (
            <Tr key={row.key}>
              <Td className="min-w-36 font-medium">{row.label}</Td>
              {r.columns.map((c) => <Td key={c.key} className="text-right tabular-nums">{fmt(row.values[c.key])}</Td>)}
            </Tr>
          ))}
        </TBody>
      </Table>
      </div>
    </>
  );
}
