import type { AnalyticsDay, AnalyticsRow, AnalyticsSummary } from "@ccm/shared";
import { useState } from "react";
import { BarChart } from "@/components/BarChart";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Empty, QueryView } from "@/components/States";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOp } from "@/hooks/api";
import { formatDate } from "@/lib/format";

type Preset = "7" | "30" | "90" | "custom";

/** Today in London as YYYY-MM-DD, matching how the server buckets days. */
function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function daysBefore(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const fmt = (n: number) => n.toLocaleString("en-GB");

export function AnalyticsPage() {
  const today = londonToday();
  const [preset, setPreset] = useState<Preset>("30");
  const [custom, setCustom] = useState({ from: daysBefore(today, 29), to: today });
  const range = preset === "custom" ? custom : { from: daysBefore(today, Number(preset) - 1), to: today };
  const valid = !!range.from && !!range.to && range.from <= range.to;
  const query = useOp("analytics.summary", range, { enabled: valid });

  return (
    <>
      <PageHeader
        title="Website analytics"
        description="Visits to the charity's website. No personal data is kept: visitors are counted, never identified."
      />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <Tabs value={preset} onValueChange={(v) => setPreset(v as Preset)}>
            <TabsList aria-label="Date range">
              <TabsTrigger value="7">7 days</TabsTrigger>
              <TabsTrigger value="30">30 days</TabsTrigger>
              <TabsTrigger value="90">90 days</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>
          </Tabs>
          {preset === "custom" && (
            <div className="flex flex-wrap gap-3">
              <Field label="From">
                <Input type="date" max={custom.to} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
              </Field>
              <Field label="To">
                <Input type="date" min={custom.from} max={today} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
              </Field>
            </div>
          )}
        </div>
        {!valid ? (
          <Empty>Choose a start date on or before the end date.</Empty>
        ) : (
          <QueryView query={query}>{(s) => <Summary s={s} />}</QueryView>
        )}
      </div>
    </>
  );
}

function Summary({ s }: { s: AnalyticsSummary }) {
  if (s.totals.views === 0 && s.totals.events === 0) {
    return (
      <Empty>
        No visits recorded between {formatDate(s.from)} and {formatDate(s.to)}. If the website's tracking script is new, check its address is
        listed under Admin, Organisation settings, Website analytics.
      </Empty>
    );
  }
  const t = s.totals;
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Page views" value={t.views} />
        <Stat label="Visits" value={t.sessions} hint="A visit is one browsing session." />
        <Stat label="New visitors" value={t.newVisitors} hint="First time on the site." />
        <Stat label="Returning visits" value={t.returningSessions} hint="Visits from people who'd been before." />
      </dl>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Each day</CardTitle>
        </CardHeader>
        <CardContent>
          <DailyChart days={s.daily} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="Top pages" rows={s.pages} valueLabel="Page views" />
        <Breakdown title="Where visits start" rows={s.landingPages} valueLabel="Visits" />
        <Breakdown title="Sources" rows={s.sources} valueLabel="Visits" note="The campaign source if the link had one, otherwise the referring site." />
        <Breakdown title="Referring sites" rows={s.referrers} valueLabel="Visits" />
        <Breakdown title="Devices" rows={s.devices} valueLabel="Visits" />
        <Breakdown title="Browsers" rows={s.browsers} valueLabel="Visits" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TableCard title="Campaigns" rows={s.campaigns} empty="No visits came from links with a utm_campaign tag." />
        <TableCard title="Campaign mediums" rows={s.mediums} empty="No visits came from links with a utm_medium tag." />
        {s.eventNames.length > 0 && <TableCard title="Events" rows={s.eventNames} empty="" valueHeader="Times" />}
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-5">
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="font-heading text-3xl font-semibold tabular-nums">{fmt(value)}</dd>
        {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
      </CardContent>
    </Card>
  );
}

/**
 * Columns for page views with a line for visitors. Each column has a title
 * for hover, and a table carries the same figures for screen readers.
 */
function DailyChart({ days }: { days: AnalyticsDay[] }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.views, d.visitors)));
  const W = 100;
  const H = 40;
  const step = W / days.length;
  const bar = Math.max(step * 0.7, 0.2);
  const y = (n: number) => H - (n / max) * H;
  const line = days.map((d, i) => `${i === 0 ? "M" : "L"}${(i * step + step / 2).toFixed(2)},${y(d.visitors).toFixed(2)}`).join(" ");
  const labelEvery = Math.ceil(days.length / 7);

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-3 rounded-sm bg-primary/70" /> Page views
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 bg-foreground" /> Visitors
        </span>
        <span className="ml-auto tabular-nums">Highest {fmt(max)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-48 w-full overflow-visible" aria-hidden>
        <line x1={0} x2={W} y1={H} y2={H} className="stroke-border" strokeWidth={0.3} vectorEffect="non-scaling-stroke" />
        {days.map((d, i) => (
          <rect key={d.date} x={i * step + (step - bar) / 2} y={y(d.views)} width={bar} height={H - y(d.views)} className="fill-primary/70 hover:fill-primary">
            <title>{`${formatDate(d.date)}: ${fmt(d.views)} page views, ${fmt(d.visitors)} visitors`}</title>
          </rect>
        ))}
        <path d={line} fill="none" className="stroke-foreground" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden>
        {days.map((d, i) => (i % labelEvery === 0 ? <span key={d.date}>{formatDate(d.date).replace(/ \d{4}$/, "")}</span> : null))}
      </div>
      <table className="sr-only">
        <caption>Page views and visitors each day</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Page views</th>
            <th>Visitors</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{formatDate(d.date)}</td>
              <td>{d.views}</td>
              <td>{d.visitors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function Breakdown({ title, rows, valueLabel, note }: { title: string; rows: AnalyticsRow[]; valueLabel: string; note?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? <Empty>Nothing recorded.</Empty> : <BarChart valueLabel={valueLabel} rows={rows.map((r) => ({ label: r.label, value: r.count }))} />}
      </CardContent>
    </Card>
  );
}

function TableCard({ title, rows, empty, valueHeader = "Visits" }: { title: string; rows: AnalyticsRow[]; empty: string; valueHeader?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <Empty>{empty}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Name</Th>
                <Th className="text-right">{valueHeader}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.label}>
                  <Td className="font-medium">{r.label}</Td>
                  <Td className="text-right tabular-nums">{fmt(r.count)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
