/**
 * The public analytics endpoint. A website's tracking script posts one small
 * JSON event per page view. Only origins listed in the organisation settings
 * are accepted.
 *
 * What's stored: the page path, a referring domain, UTM campaign fields,
 * coarse device and browser, and hashed visitor and session ids. Raw events
 * expire after 13 months through a Firestore TTL policy. Daily rollups keep
 * the counts the dashboard reads, so it reads one document per day.
 *
 * What isn't stored: IP addresses, full user agents, query strings other
 * than utm_*, or the raw cookie value.
 */
import { DEFAULT_ORG_SETTINGS, type OrgSettings } from "@ccm/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { C, db, REGION } from "../core/firebase.js";
import { capKey, cleanUrl, cleanUtm, hashId, londonDay, parseUserAgent, referrerDomain, widthBucket, type Utm } from "./clean.js";

export const MAX_BODY_BYTES = 4096;
/** Events per visitor per minute before they're refused. */
export const VISITOR_PER_MINUTE = 60;
/** Requests per network address per minute, counted in memory only. */
export const ADDRESS_PER_MINUTE = 240;
const RETENTION_MS = 396 * 86_400_000; // 13 months

/** The most distinct values each daily map keeps. The rest go into "(other)". */
export const CAPS = {
  pages: 300,
  landing: 150,
  referrers: 150,
  sources: 100,
  mediums: 50,
  campaigns: 100,
  devices: 5,
  browsers: 20,
  eventNames: 50,
} as const;

const utmValue = z.string().max(200).optional();

export const eventSchema = z
  .object({
    /** pageview, or event for a named action such as a button press. */
    t: z.enum(["pageview", "event"]),
    n: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[\w .:/-]+$/)
      .optional(),
    u: z.string().min(8).max(2000),
    r: z.string().max(2000).optional(),
    ti: z.string().max(300).optional(),
    v: z.uuid(),
    s: z.uuid(),
    w: z.number().int().min(0).max(20_000).optional(),
    utm: z.object({ source: utmValue, medium: utmValue, campaign: utmValue, term: utmValue, content: utmValue }).optional(),
    /** navigator.webdriver, set by automated browsers. */
    wd: z.boolean().optional(),
  })
  .strict()
  .refine((e) => e.t !== "event" || !!e.n, { message: "Events need a name.", path: ["n"] });

export type CollectEvent = z.infer<typeof eventSchema>;

export interface CollectRequest {
  method: string;
  origin?: string;
  userAgent?: string;
  /** Used only for an in-memory rate limit. Never stored or logged. */
  ip?: string;
  body: unknown;
  now?: Date;
}

export interface CollectResult {
  status: number;
  headers: Record<string, string>;
  /** Why an event was refused or dropped. For tests and logs, never sent to the browser. */
  reason?: string;
}

// Allowed origins, cached briefly so each page view doesn't read the settings.
let originsCache: { at: number; origins: Set<string> } | null = null;
const ORIGINS_TTL_MS = 60_000;

async function allowedOrigins(): Promise<Set<string>> {
  if (originsCache && Date.now() - originsCache.at < ORIGINS_TTL_MS) return originsCache.origins;
  const snap = await db.collection(C.config).doc("org").get();
  const org = { ...DEFAULT_ORG_SETTINGS, ...(snap.data() as Partial<OrgSettings> | undefined) };
  const origins = new Set((org.analyticsAllowedOrigins ?? []).map((o) => o.toLowerCase()));
  originsCache = { at: Date.now(), origins };
  return origins;
}

// Per address request counts for the current minute. The key is a truncated
// hash with a salt that changes daily, and the map is cleared every minute.
let addressWindow = { minute: 0, counts: new Map<string, number>() };

function addressLimited(ip: string | undefined, now: Date): boolean {
  if (!ip) return false;
  const minute = Math.floor(now.getTime() / 60_000);
  if (addressWindow.minute !== minute) addressWindow = { minute, counts: new Map() };
  if (addressWindow.counts.size > 50_000) return false; // Fail open rather than grow without bound.
  const key = hashId(ip, `addr:${londonDay(now)}`).slice(0, 16);
  const n = (addressWindow.counts.get(key) ?? 0) + 1;
  addressWindow.counts.set(key, n);
  return n > ADDRESS_PER_MINUTE;
}

/** Clears in-memory caches. For tests. */
export function resetCollectState() {
  originsCache = null;
  addressWindow = { minute: 0, counts: new Map() };
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function parseBody(body: unknown): { ok: true; value: unknown } | { ok: false; status: number; reason: string } {
  let text: string;
  if (Buffer.isBuffer(body)) text = body.toString("utf8");
  else if (typeof body === "string") text = body;
  else if (body && typeof body === "object") text = JSON.stringify(body);
  else return { ok: false, status: 400, reason: "empty" };
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return { ok: false, status: 413, reason: "too-large" };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, reason: "not-json" };
  }
}

interface VisitorState {
  firstDay: string;
  firstVisitToday: boolean;
  newSession: boolean;
  limited: boolean;
}

async function touchVisitor(visitorHash: string, sessionHash: string, day: string, now: Date): Promise<VisitorState> {
  const ref = db.collection(C.analyticsVisitors).doc(visitorHash);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as
      | { firstDay: string; lastDay: string; lastSession: string; rlMinute: number; rlCount: number }
      | undefined;
    const minute = Math.floor(now.getTime() / 60_000);
    const count = data && data.rlMinute === minute ? data.rlCount + 1 : 1;
    if (count > VISITOR_PER_MINUTE) return { firstDay: data?.firstDay ?? day, firstVisitToday: false, newSession: false, limited: true };
    const state: VisitorState = {
      firstDay: data?.firstDay ?? day,
      firstVisitToday: !data || data.lastDay !== day,
      newSession: !data || data.lastSession !== sessionHash,
      limited: false,
    };
    tx.set(ref, {
      firstDay: state.firstDay,
      lastDay: day,
      lastSession: sessionHash,
      lastSeenAt: Timestamp.fromDate(now),
      rlMinute: minute,
      rlCount: count,
      expireAt: Timestamp.fromMillis(now.getTime() + RETENTION_MS),
    });
    return state;
  });
}

type Maps = Partial<Record<keyof typeof CAPS, Record<string, unknown>>>;

/** Validates, filters and records one event. Separate from the HTTP wrapper so it can be tested directly. */
export async function processCollect(req: CollectRequest): Promise<CollectResult> {
  const now = req.now ?? new Date();
  const origin = req.origin?.toLowerCase();
  const allowed = await allowedOrigins();
  if (!origin || !allowed.has(origin)) return { status: 403, headers: {}, reason: "origin" };
  const headers = corsHeaders(req.origin!);

  if (req.method === "OPTIONS") return { status: 204, headers };
  if (req.method !== "POST") return { status: 405, headers: { ...headers, Allow: "POST, OPTIONS" }, reason: "method" };

  const body = parseBody(req.body);
  if (!body.ok) return { status: body.status, headers, reason: body.reason };
  const parsed = eventSchema.safeParse(body.value);
  if (!parsed.success) return { status: 400, headers, reason: "invalid" };
  const e = parsed.data;

  const page = cleanUrl(e.u);
  if (!page || page.host !== new URL(origin).host) return { status: 400, headers, reason: "url" };

  // Bots get a success response so they don't retry, but nothing is recorded.
  const agent = parseUserAgent(req.userAgent, e.w);
  if (agent.bot || e.wd) return { status: 204, headers, reason: "bot" };

  if (addressLimited(req.ip, now)) return { status: 429, headers, reason: "rate-address" };

  const day = londonDay(now);
  const visitorHash = hashId(e.v);
  const sessionHash = hashId(e.s);
  const visitor = await touchVisitor(visitorHash, sessionHash, day, now);
  if (visitor.limited) return { status: 429, headers, reason: "rate-visitor" };

  const utm: Utm = { ...page.utm, ...cleanUtm(e.utm) };
  const referrer = referrerDomain(e.r, page.host);
  const isNew = visitor.firstDay === day;

  const dailyRef = db.collection(C.analyticsDaily).doc(day);
  const existing = ((await dailyRef.get()).data() ?? {}) as Maps;
  const inc = FieldValue.increment(1);
  const key = (map: keyof typeof CAPS, value: string) => capKey(existing[map], value, CAPS[map]);

  const rollup: Record<string, unknown> = { date: day, updatedAt: Timestamp.fromDate(now) };
  const maps: Record<string, Record<string, FieldValue>> = {};
  const add = (map: keyof typeof CAPS, value: string) => {
    (maps[map] ??= {})[key(map, value)] = inc;
  };

  if (e.t === "pageview") {
    rollup.views = inc;
    add("pages", page.path);
  } else {
    rollup.events = inc;
    add("eventNames", e.n!);
  }
  if (visitor.firstVisitToday) {
    rollup.visitors = inc;
    rollup[isNew ? "newVisitors" : "returningVisitors"] = inc;
  }
  if (visitor.newSession) {
    rollup.sessions = inc;
    if (!isNew) rollup.returningSessions = inc;
    add("landing", page.path);
    add("referrers", referrer ?? "(direct)");
    add("sources", utm.source ?? referrer ?? "(direct)");
    if (utm.medium) add("mediums", utm.medium);
    if (utm.campaign) add("campaigns", utm.campaign);
    add("devices", agent.device);
    add("browsers", agent.browser);
  }

  const batch = db.batch();
  batch.set(dailyRef, { ...rollup, ...maps }, { merge: true });
  batch.set(db.collection(C.analyticsEvents).doc(), {
    type: e.t,
    name: e.n,
    path: page.path,
    title: e.ti?.trim().slice(0, 200) || undefined,
    referrer,
    utm: Object.keys(utm).length ? utm : undefined,
    device: agent.device,
    browser: agent.browser,
    width: widthBucket(e.w),
    visitor: visitorHash,
    session: sessionHash,
    newVisitor: isNew,
    day,
    at: Timestamp.fromDate(now),
    expireAt: Timestamp.fromMillis(now.getTime() + RETENTION_MS),
  });
  await batch.commit();
  return { status: 204, headers };
}

export const collect = onRequest({ region: REGION, memory: "256MiB", maxInstances: 3, concurrency: 80, timeoutSeconds: 10 }, async (req, res) => {
  try {
    const result = await processCollect({
      method: req.method,
      origin: req.get("origin") ?? undefined,
      userAgent: req.get("user-agent") ?? undefined,
      ip: req.ip,
      body: req.rawBody ?? req.body,
    });
    res.set(result.headers).status(result.status).end();
  } catch (err) {
    logger.error("Analytics event failed", err);
    if (!res.headersSent) res.status(500).end();
  }
});
