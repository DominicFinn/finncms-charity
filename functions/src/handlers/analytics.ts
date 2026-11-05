/**
 * Website analytics dashboard. Reads the daily rollups written by the
 * collect endpoint, one document per day, and adds them up. No personal data
 * is involved: visitors are only ever counted.
 */
import type { AnalyticsDay, AnalyticsRow, AnalyticsSummary } from "@ccm/shared";
import { FieldPath } from "firebase-admin/firestore";
import { decodeKey, OTHER } from "../analytics/clean.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { C, db } from "../core/firebase.js";

const TOP = 20;
const MAPS = ["pages", "landing", "referrers", "sources", "mediums", "campaigns", "devices", "browsers", "eventNames"] as const;
type MapName = (typeof MAPS)[number];

const LABELS: Record<string, string> = {
  [OTHER]: "Other",
  "(direct)": "Direct or unknown",
  mobile: "Mobile",
  tablet: "Tablet",
  desktop: "Desktop",
};

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function top(totals: Map<string, number>): AnalyticsRow[] {
  const rows = [...totals.entries()].map(([k, count]) => {
    const value = decodeKey(k);
    return { label: LABELS[value] ?? value, count, other: value === OTHER };
  });
  // "Other" always goes last, whatever its size.
  rows.sort((a, b) => Number(a.other) - Number(b.other) || b.count - a.count || a.label.localeCompare(b.label));
  return rows.slice(0, TOP).map(({ label, count }) => ({ label, count }));
}

export async function summarise(from: string, to: string): Promise<AnalyticsSummary> {
  const snap = await db
    .collection(C.analyticsDaily)
    .where(FieldPath.documentId(), ">=", from)
    .where(FieldPath.documentId(), "<=", to)
    .get();
  const byDay = new Map(snap.docs.map((d) => [d.id, d.data()]));

  const totals = { views: 0, sessions: 0, visitors: 0, newVisitors: 0, returningVisitors: 0, returningSessions: 0, events: 0 };
  const maps = Object.fromEntries(MAPS.map((m) => [m, new Map<string, number>()])) as Record<MapName, Map<string, number>>;
  const daily: AnalyticsDay[] = [];

  for (const date of days(from, to)) {
    const d = byDay.get(date) ?? {};
    const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : 0);
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += n(k);
    daily.push({ date, views: n("views"), visitors: n("visitors"), sessions: n("sessions") });
    for (const m of MAPS) {
      const map = d[m] as Record<string, number> | undefined;
      if (!map) continue;
      for (const [k, v] of Object.entries(map)) maps[m].set(k, (maps[m].get(k) ?? 0) + (typeof v === "number" ? v : 0));
    }
  }

  return {
    from,
    to,
    totals,
    daily,
    pages: top(maps.pages),
    landingPages: top(maps.landing),
    referrers: top(maps.referrers),
    sources: top(maps.sources),
    mediums: top(maps.mediums),
    campaigns: top(maps.campaigns),
    devices: top(maps.devices),
    browsers: top(maps.browsers),
    eventNames: top(maps.eventNames),
  };
}

export const analyticsHandlers: HandlerGroup = {
  async "analytics.summary"(input) {
    return summarise(input.from, input.to);
  },
};
