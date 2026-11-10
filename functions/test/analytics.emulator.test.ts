import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeKey, hashId } from "../src/analytics/clean.js";
import { processCollect, resetCollectState, VISITOR_PER_MINUTE, type CollectRequest } from "../src/analytics/collect.js";
import { C, db } from "../src/core/firebase.js";
import { auditFor, call, clearFirestore, seedBasics, userWith } from "./helpers.js";

const ORIGIN = "https://www.example.org";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DAY1 = new Date("2026-06-01T10:00:00Z");
const DAY2 = new Date("2026-06-02T10:00:00Z");

beforeEach(async () => {
  await clearFirestore();
  await seedBasics();
  await db.collection(C.config).doc("org").set({ analyticsAllowedOrigins: [ORIGIN] });
  resetCollectState();
});

function event(overrides: Record<string, unknown> = {}) {
  return { t: "pageview", u: `${ORIGIN}/`, v: randomUUID(), s: randomUUID(), w: 390, ...overrides };
}

function send(body: unknown, opts: Partial<CollectRequest> = {}) {
  return processCollect({
    method: "POST",
    origin: ORIGIN,
    userAgent: UA,
    ip: "203.0.113.7",
    body: typeof body === "string" ? body : JSON.stringify(body),
    now: DAY1,
    ...opts,
  });
}

async function daily(day: string) {
  return (await db.collection(C.analyticsDaily).doc(day).get()).data() ?? {};
}

describe("collect", () => {
  it("records a page view with only cleaned data", async () => {
    const v = randomUUID();
    const res = await send(
      event({
        v,
        u: `${ORIGIN}/events/?email=someone%40example.com&utm_source=Facebook&utm_medium=social&utm_campaign=ceili`,
        r: "https://www.google.com/search?q=charity",
        ti: "Events",
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe(ORIGIN);

    const events = (await db.collection(C.analyticsEvents).get()).docs.map((d) => d.data());
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e).toMatchObject({
      type: "pageview",
      path: "/events",
      title: "Events",
      referrer: "google.com",
      utm: { source: "facebook", medium: "social", campaign: "ceili" },
      device: "mobile",
      browser: "Safari",
      width: "small",
      visitor: hashId(v),
      newVisitor: true,
      day: "2026-06-01",
    });
    expect(e.expireAt.toMillis()).toBeGreaterThan(DAY1.getTime() + 390 * 86_400_000);
    // Nothing that could identify the person.
    const stored = JSON.stringify(e);
    expect(stored).not.toContain("someone");
    expect(stored).not.toContain(v);
    expect(stored).not.toContain("203.0.113.7");
    expect(stored).not.toContain("iPhone OS");

    const d = await daily("2026-06-01");
    expect(d).toMatchObject({ views: 1, visitors: 1, newVisitors: 1, sessions: 1 });
    expect(d.pages[encodeKey("/events")]).toBe(1);
    expect(d.sources[encodeKey("facebook")]).toBe(1);
    expect(d.referrers[encodeKey("google.com")]).toBe(1);
    expect(d.campaigns[encodeKey("ceili")]).toBe(1);
    expect(d.devices[encodeKey("mobile")]).toBe(1);
  });

  it("refuses origins that aren't allowed, with no CORS headers", async () => {
    const res = await send(event({ u: "https://evil.example.com/" }), { origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect((await send(event(), { origin: undefined })).status).toBe(403);
    expect((await db.collection(C.analyticsEvents).get()).size).toBe(0);
  });

  it("refuses a page URL from a different site to the origin", async () => {
    const res = await send(event({ u: "https://other.example.com/" }));
    expect(res).toMatchObject({ status: 400, reason: "url" });
  });

  it("answers the CORS preflight", async () => {
    const res = await send("", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers["Access-Control-Allow-Methods"]).toContain("POST");
    expect((await send("", { method: "GET" })).status).toBe(405);
  });

  it("drops bots quietly", async () => {
    const bot = await send(event(), { userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
    expect(bot).toMatchObject({ status: 204, reason: "bot" });
    const webdriver = await send(event({ wd: true }));
    expect(webdriver).toMatchObject({ status: 204, reason: "bot" });
    expect((await send(event(), { userAgent: undefined })).reason).toBe("bot");
    expect((await db.collection(C.analyticsEvents).get()).size).toBe(0);
  });

  it("refuses oversized and invalid bodies", async () => {
    expect((await send(event({ ti: "x".repeat(5000) }))).status).toBe(413);
    expect((await send("{not json")).status).toBe(400);
    expect((await send(event({ v: "not-a-uuid" }))).status).toBe(400);
    expect((await send(event({ extra: "field" }))).status).toBe(400);
    expect((await send(event({ t: "event" }))).status).toBe(400);
    expect((await db.collection(C.analyticsEvents).get()).size).toBe(0);
  });

  it("counts visitors once a day, sessions once each, and spots returning visitors", async () => {
    const v = randomUUID();
    const s1 = randomUUID();
    await send(event({ v, s: s1 }));
    await send(event({ v, s: s1, u: `${ORIGIN}/about` }));
    await send(event({ v, s: randomUUID(), u: `${ORIGIN}/events` }), { now: new Date(DAY1.getTime() + 3_600_000) });
    expect(await daily("2026-06-01")).toMatchObject({ views: 3, visitors: 1, newVisitors: 1, sessions: 2 });
    expect((await daily("2026-06-01")).returningVisitors).toBeUndefined();

    await send(event({ v, s: randomUUID() }), { now: DAY2 });
    const d2 = await daily("2026-06-02");
    expect(d2).toMatchObject({ views: 1, visitors: 1, returningVisitors: 1, sessions: 1, returningSessions: 1 });
    expect(d2.newVisitors).toBeUndefined();

    const visitorDoc = (await db.collection(C.analyticsVisitors).doc(hashId(v)).get()).data();
    expect(visitorDoc).toMatchObject({ firstDay: "2026-06-01", lastDay: "2026-06-02" });
  });

  it("attributes landing page, referrer and campaign to the session, not every view", async () => {
    const v = randomUUID();
    const s = randomUUID();
    const utm = { source: "newsletter", campaign: "spring" };
    await send(event({ v, s, u: `${ORIGIN}/volunteer`, utm, r: "https://mail.example.net/" }));
    await send(event({ v, s, u: `${ORIGIN}/contact`, utm, r: `${ORIGIN}/volunteer` }));
    const d = await daily("2026-06-01");
    expect(d.landing).toEqual({ [encodeKey("/volunteer")]: 1 });
    expect(d.campaigns).toEqual({ [encodeKey("spring")]: 1 });
    expect(d.sources).toEqual({ [encodeKey("newsletter")]: 1 });
    expect(d.pages).toEqual({ [encodeKey("/volunteer")]: 1, [encodeKey("/contact")]: 1 });
  });

  it("records named events separately from page views", async () => {
    await send(event({ t: "event", n: "referral_submitted" }));
    const d = await daily("2026-06-01");
    expect(d.events).toBe(1);
    expect(d.views).toBeUndefined();
    expect(d.eventNames[encodeKey("referral_submitted")]).toBe(1);
  });

  it("buckets pages past the daily cap into other", async () => {
    const pages: Record<string, number> = {};
    for (let i = 0; i < 300; i++) pages[encodeKey(`/p${i}`)] = 1;
    await db.collection(C.analyticsDaily).doc("2026-06-01").set({ pages });
    await send(event({ u: `${ORIGIN}/new-page` }));
    const d = await daily("2026-06-01");
    expect(d.pages[encodeKey("/new-page")]).toBeUndefined();
    expect(d.pages[encodeKey("(other)")]).toBe(1);
  });

  it("limits how fast one visitor can send events", async () => {
    const v = randomUUID();
    const s = randomUUID();
    const results: number[] = [];
    for (let i = 0; i <= VISITOR_PER_MINUTE; i++) results.push((await send(event({ v, s }), { ip: `198.51.100.${i % 200}` })).status);
    expect(results.slice(0, VISITOR_PER_MINUTE).every((r) => r === 204)).toBe(true);
    expect(results[VISITOR_PER_MINUTE]).toBe(429);
    expect((await daily("2026-06-01")).views).toBe(VISITOR_PER_MINUTE);
  });
});

describe("analytics.summary", () => {
  it("adds up the days and is limited to people with analytics access", async () => {
    const v = randomUUID();
    await send(event({ v, utm: { source: "facebook", campaign: "ceili" } }));
    await send(event({ v, s: randomUUID(), u: `${ORIGIN}/events` }), { now: DAY2 });
    await send(event({ u: `${ORIGIN}/events`, r: "https://www.google.com/" }), { now: DAY2 });

    const manager = await userWith(["manager"]);
    const s = await call(manager, "analytics.summary", { from: "2026-05-31", to: "2026-06-02" });
    expect(s.totals).toMatchObject({ views: 3, sessions: 3, visitors: 3, newVisitors: 2, returningVisitors: 1, returningSessions: 1 });
    expect(s.daily.map((d) => d.date)).toEqual(["2026-05-31", "2026-06-01", "2026-06-02"]);
    expect(s.daily[0]).toEqual({ date: "2026-05-31", views: 0, visitors: 0, sessions: 0 });
    expect(s.pages).toEqual([
      { label: "/events", count: 2 },
      { label: "/", count: 1 },
    ]);
    expect(s.sources.map((r) => r.label)).toEqual(expect.arrayContaining(["facebook", "google.com", "Direct or unknown"]));
    expect(s.campaigns).toEqual([{ label: "ceili", count: 1 }]);
    expect(s.devices).toEqual([{ label: "Mobile", count: 3 }]);

    expect((await auditFor({ op: "analytics.summary" })).map((a) => a.action)).toEqual(["read"]);

    const caseworker = await userWith(["caseworker"]);
    await expect(call(caseworker, "analytics.summary", { from: "2026-06-01", to: "2026-06-02" })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("refuses back to front and very long ranges", async () => {
    const manager = await userWith(["manager"]);
    await expect(call(manager, "analytics.summary", { from: "2026-06-02", to: "2026-06-01" })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(call(manager, "analytics.summary", { from: "2024-01-01", to: "2026-06-01" })).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("lets the allowed origins be set and rejects anything that isn't an origin", async () => {
    const admin = await userWith(["super-user"]);
    const saved = await call(admin, "org.updateSettings", { analyticsAllowedOrigins: ["https://www.example.org", "http://localhost:3000"] });
    expect(saved.analyticsAllowedOrigins).toEqual(["https://www.example.org", "http://localhost:3000"]);
    await expect(call(admin, "org.updateSettings", { analyticsAllowedOrigins: ["https://www.example.org/"] })).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
