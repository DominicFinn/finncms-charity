/**
 * Reports aggregate sessions, callbacks and outcomes. They only use fields
 * that survive anonymisation (help categories, types, statuses, month level
 * dates, postcode district, session location) plus town, which anonymised
 * records report as "Unknown". Locations come from a managed list, so the
 * free text typed for "Other" never appears in a report. No personal data is returned.
 */
import { toCsv, type ReportDimension, type ReportFilters, type ReportResult, type ReportRow } from "@ccm/shared";
import { Timestamp, type Query } from "firebase-admin/firestore";
import type { Ctx } from "../core/context.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { fail } from "../core/errors.js";
import { C, db } from "../core/firebase.js";
import { loadQuestions, loadSet } from "./questionnaires.js";

type Doc = FirebaseFirestore.DocumentData;
const UNKNOWN = "Unknown";

interface Labels {
  location: Map<string, string>;
  helpCategory: Map<string, string>;
  sessionType: Map<string, string>;
  staff: Map<string, string>;
}

async function labels(): Promise<Labels> {
  const [locations, cats, types, users] = await Promise.all([
    db.collection(C.sessionLocations).get(),
    db.collection(C.helpCategories).get(),
    db.collection(C.sessionTypes).get(),
    db.collection(C.users).get(),
  ]);
  return {
    location: new Map(locations.docs.map((d) => [d.id, d.get("name") as string])),
    helpCategory: new Map(cats.docs.map((d) => [d.id, d.get("name") as string])),
    sessionType: new Map(types.docs.map((d) => [d.id, d.get("name") as string])),
    staff: new Map(users.docs.map((d) => [d.id, d.get("displayName") as string])),
  };
}

function range(q: Query, field: string, f: ReportFilters): Query {
  if (f.from) q = q.where(field, ">=", Timestamp.fromDate(new Date(`${f.from}T00:00:00Z`)));
  if (f.to) q = q.where(field, "<", Timestamp.fromDate(new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000)));
  return q;
}

function month(v: unknown): string {
  if (!(v instanceof Timestamp)) return UNKNOWN;
  return v.toDate().toISOString().slice(0, 7);
}

/** Normalised view of a record for filtering and grouping. */
interface Facts {
  town?: string | null;
  postcodeDistrict?: string | null;
  locationId?: string | null;
  helpCategoryIds: string[];
  sessionTypeId?: string | null;
  staffUid?: string | null;
  month: string;
}

function passes(f: ReportFilters, x: Facts): boolean {
  if (f.town && x.town !== f.town) return false;
  if (f.postcodeDistrict && x.postcodeDistrict?.toUpperCase() !== f.postcodeDistrict.toUpperCase()) return false;
  if (f.locationId && x.locationId !== f.locationId) return false;
  if (f.helpCategoryId && !x.helpCategoryIds.includes(f.helpCategoryId)) return false;
  if (f.sessionTypeId && x.sessionTypeId !== f.sessionTypeId) return false;
  if (f.staffUid && x.staffUid !== f.staffUid) return false;
  return true;
}

/** The groups a record falls into. Help category can put one record in several groups. */
function groups(dim: ReportDimension | null, x: Facts, l: Labels): { key: string; label: string }[] {
  const one = (key: string | null | undefined, label?: string) => [{ key: key || UNKNOWN, label: key ? (label ?? key) : UNKNOWN }];
  switch (dim) {
    case null:
      return [{ key: "all", label: "All" }];
    case "town":
      return one(x.town);
    case "postcodeDistrict":
      return one(x.postcodeDistrict);
    case "location":
      return one(x.locationId, x.locationId ? l.location.get(x.locationId) : undefined);
    case "month":
      return one(x.month === UNKNOWN ? null : x.month);
    case "sessionType":
      return one(x.sessionTypeId, x.sessionTypeId ? l.sessionType.get(x.sessionTypeId) : undefined);
    case "staff":
      return one(x.staffUid, x.staffUid ? l.staff.get(x.staffUid) : undefined);
    case "helpCategory":
      return x.helpCategoryIds.length ? x.helpCategoryIds.map((id) => ({ key: id, label: l.helpCategory.get(id) ?? id })) : one(null);
  }
}

class Table {
  rows = new Map<string, ReportRow>();
  add(g: { key: string; label: string }, col: string, amount = 1) {
    let row = this.rows.get(g.key);
    if (!row) this.rows.set(g.key, (row = { key: g.key, label: g.label, values: {} }));
    row.values[col] = (row.values[col] ?? 0) + amount;
  }
  sorted(dim: ReportDimension | null, by: string): ReportRow[] {
    const rows = [...this.rows.values()];
    if (dim === "month") return rows.sort((a, b) => a.key.localeCompare(b.key));
    return rows.sort((a, b) => (b.values[by] ?? 0) - (a.values[by] ?? 0) || a.label.localeCompare(b.label));
  }
}

function sessionFacts(d: Doc): Facts {
  return {
    town: d.dims?.town,
    postcodeDistrict: d.dims?.postcodeDistrict,
    locationId: d.locationId ?? d.dims?.locationId,
    helpCategoryIds: d.helpCategoryIds ?? [],
    sessionTypeId: d.typeId,
    staffUid: d.staffUid,
    month: month(d.startsAt),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

async function outcomesReport(setId: string, f: ReportFilters, dim: ReportDimension | null, ctx: Ctx): Promise<ReportResult> {
  const set = await loadSet(setId);
  if (set.kind !== "outcome") throw fail.invalid("That question set is not an outcome measure.");
  if (set.sensitive && !ctx.can("questionnaires.viewSensitive")) throw fail.denied();
  const [questions, l] = await Promise.all([loadQuestions(set.questionIds), labels()]);
  const snap = await range(db.collection(C.outcomes).where("setId", "==", setId), "recordedAt", f).get();

  const table = new Table();
  const sums = new Map<string, { total: number; n: number }>();
  const columns: { key: string; label: string }[] = [{ key: "responses", label: "Responses" }];
  for (const qid of set.questionIds) {
    const q = questions.get(qid);
    if (!q) continue;
    if (q.type === "yes_no") columns.push({ key: `${qid}:yes`, label: `${q.text} (% yes)` });
    if (q.type === "scale" || q.type === "number") columns.push({ key: `${qid}:avg`, label: `${q.text} (average)` });
    if (q.type === "single_choice" || q.type === "multiple_choice") {
      for (const o of q.options ?? []) columns.push({ key: `${qid}:${o}`, label: `${q.text}: ${o}` });
    }
  }

  for (const doc of snap.docs) {
    const d = doc.data();
    const facts: Facts = {
      town: d.dims?.town,
      postcodeDistrict: d.dims?.postcodeDistrict,
      locationId: d.dims?.locationId,
      helpCategoryIds: [d.helpCategoryId],
      sessionTypeId: d.dims?.sessionTypeId,
      staffUid: d.dims?.staffUid,
      month: month(d.recordedAt),
    };
    if (!passes(f, facts)) continue;
    for (const g of groups(dim, facts, l)) {
      table.add(g, "responses");
      for (const [qid, value] of Object.entries((d.answers as Record<string, unknown>) ?? {})) {
        const q = questions.get(qid);
        if (!q || value === null || value === undefined) continue;
        if (q.type === "yes_no") {
          const k = `${g.key}|${qid}:yes`;
          const s = sums.get(k) ?? { total: 0, n: 0 };
          s.total += value === true ? 1 : 0;
          s.n += 1;
          sums.set(k, s);
        } else if ((q.type === "scale" || q.type === "number") && typeof value === "number") {
          const k = `${g.key}|${qid}:avg`;
          const s = sums.get(k) ?? { total: 0, n: 0 };
          s.total += value;
          s.n += 1;
          sums.set(k, s);
        } else if (q.type === "single_choice" && typeof value === "string") {
          table.add(g, `${qid}:${value}`);
        } else if (q.type === "multiple_choice" && Array.isArray(value)) {
          for (const v of value) table.add(g, `${qid}:${v}`);
        }
      }
    }
  }

  for (const [k, s] of sums) {
    const [groupKey, col] = k.split("|");
    const row = table.rows.get(groupKey);
    if (!row || s.n === 0) continue;
    row.values[col] = col.endsWith(":yes") ? round1((s.total / s.n) * 100) : round1(s.total / s.n);
  }

  return {
    title: `Outcomes: ${set.name}`,
    dimension: dim,
    columns,
    rows: table.sorted(dim, "responses"),
    generatedAt: new Date().toISOString(),
    notes: ["Percentages and averages count only the people who answered that question."],
  };
}

async function demandReport(f: ReportFilters, dimIn: ReportDimension | null): Promise<ReportResult> {
  const dim = dimIn ?? "helpCategory";
  const l = await labels();
  const snap = await range(db.collection(C.sessions), "startsAt", f).get();
  const table = new Table();
  const clients = new Map<string, Set<string>>();
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.status === "cancelled") continue;
    const facts = sessionFacts(d);
    if (!passes(f, facts)) continue;
    for (const g of groups(dim, facts, l)) {
      table.add(g, "sessions");
      table.add(g, "hours", (d.durationMinutes ?? 0) / 60);
      const set = clients.get(g.key) ?? new Set();
      set.add(d.clientId);
      clients.set(g.key, set);
    }
  }
  for (const [key, set] of clients) table.rows.get(key)!.values.clients = set.size;
  for (const row of table.rows.values()) row.values.hours = round1(row.values.hours ?? 0);
  return {
    title: "Demand for help",
    dimension: dim,
    columns: [
      { key: "clients", label: "Clients" },
      { key: "sessions", label: "Sessions" },
      { key: "hours", label: "Hours" },
    ],
    rows: table.sorted(dim, "clients"),
    generatedAt: new Date().toISOString(),
    notes: ["Counts sessions that were not cancelled. A session tagged with several help categories counts once in each."],
  };
}

async function activityReport(f: ReportFilters, dimIn: ReportDimension | null): Promise<ReportResult> {
  const dim = dimIn ?? "month";
  const l = await labels();
  const now = Timestamp.now();
  const [sessions, callbacks] = await Promise.all([
    range(db.collection(C.sessions), "startsAt", f).get(),
    range(db.collection(C.callbacks), "dueAt", f).get(),
  ]);
  const table = new Table();
  for (const doc of sessions.docs) {
    const d = doc.data();
    const facts = sessionFacts(d);
    if (!passes(f, facts)) continue;
    const col = { completed: "sessionsCompleted", scheduled: "sessionsScheduled", cancelled: "sessionsCancelled", did_not_attend: "sessionsDidNotAttend" }[
      d.status as string
    ];
    for (const g of groups(dim, facts, l)) if (col) table.add(g, col);
  }
  // Callbacks only carry staff and dates, so location style filters exclude them.
  const callbackFilterable = !f.town && !f.postcodeDistrict && !f.locationId && !f.helpCategoryId && !f.sessionTypeId;
  const callbackDim = dim === "staff" || dim === "month" || dim === null;
  if (callbackFilterable && callbackDim) {
    for (const doc of callbacks.docs) {
      const d = doc.data();
      const facts: Facts = { helpCategoryIds: [], staffUid: d.assigneeUid, month: month(d.dueAt) };
      if (!passes(f, facts)) continue;
      for (const g of groups(dim, facts, l)) {
        if (d.status === "done") table.add(g, "callbacksDone");
        if (d.status === "open" && (d.dueAt as Timestamp).toMillis() < now.toMillis()) table.add(g, "callbacksOverdue");
        if (d.status === "open") table.add(g, "callbacksOpen");
      }
    }
  }
  return {
    title: "Activity",
    dimension: dim,
    columns: [
      { key: "sessionsCompleted", label: "Sessions completed" },
      { key: "sessionsScheduled", label: "Sessions scheduled" },
      { key: "sessionsCancelled", label: "Sessions cancelled" },
      { key: "sessionsDidNotAttend", label: "Did not attend" },
      { key: "callbacksDone", label: "Callbacks done" },
      { key: "callbacksOpen", label: "Callbacks open" },
      { key: "callbacksOverdue", label: "Callbacks overdue" },
    ],
    rows: table.sorted(dim, "sessionsCompleted"),
    generatedAt: new Date().toISOString(),
    notes: callbackFilterable && callbackDim ? undefined : ["Callbacks are left out when filtering or splitting by place, help category or session type."],
  };
}

export const reportHandlers: HandlerGroup = {
  async "reports.outcomes"(input, ctx) {
    return outcomesReport(input.setId, input.filters, input.dimension, ctx);
  },
  async "reports.demand"(input) {
    return demandReport(input.filters, input.dimension);
  },
  async "reports.activity"(input) {
    return activityReport(input.filters, input.dimension);
  },
  async "reports.exportCsv"(input, ctx) {
    let result: ReportResult;
    if (input.report === "outcomes") {
      if (!input.setId) throw fail.invalid("Choose an outcome measure.");
      result = await outcomesReport(input.setId, input.filters, input.dimension, ctx);
    } else if (input.report === "demand") result = await demandReport(input.filters, input.dimension);
    else result = await activityReport(input.filters, input.dimension);
    const header = ["Group", ...result.columns.map((c) => c.label)];
    const body = result.rows.map((r) => [r.label, ...result.columns.map((c) => r.values[c.key] ?? 0)]);
    const stamp = new Date().toISOString().slice(0, 10);
    return { fileName: `${input.report}-report-${stamp}.csv`, csv: toCsv([header, ...body]) };
  },
};
