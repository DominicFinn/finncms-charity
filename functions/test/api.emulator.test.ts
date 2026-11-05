import { SUPER_USER_ROLE_ID } from "@ccm/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveCaller } from "../src/core/context.js";
import { C, db } from "../src/core/firebase.js";
import { runReminders } from "../src/jobs/reminders.js";
import { runRetention } from "../src/jobs/retention.js";
import { auditFor, call, clearFirestore, NEW_CLIENT, seedBasics, userWith } from "./helpers.js";

beforeEach(async () => {
  await clearFirestore();
  await seedBasics();
});

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

describe("sign in and access", () => {
  it("gives the bootstrap email super user and refuses strangers", async () => {
    const boss = await resolveCaller({ uid: "boss", email: "boss@example.org", provider: "google.com" }, "ui");
    expect(boss.user.roleIds).toEqual([SUPER_USER_ROLE_ID]);
    expect(boss.can("users.manage")).toBe(true);

    await expectCode(resolveCaller({ uid: "x", email: "stranger@gmail.com", provider: "google.com" }, "ui"), "failed-precondition");
    const denied = await auditFor({ actorUid: "x" });
    expect(denied.map((a) => a.action)).toContain("denied");
  });

  it("only accepts Google sign in on the UI channel", async () => {
    await expectCode(resolveCaller({ uid: "boss", email: "boss@example.org", provider: "password" }, "ui"), "unauthenticated");
  });

  it("turns an invitation into a user on first sign in", async () => {
    const admin = await userWith([SUPER_USER_ROLE_ID], "Admin");
    const invite = await call(admin, "users.invite", { email: "Volunteer@Example.org", roleIds: ["volunteer"] });
    expect(invite.invited).toBe(true);
    const vol = await resolveCaller({ uid: "vol-uid", email: "volunteer@example.org", provider: "google.com" }, "ui");
    expect(vol.user.roleIds).toEqual(["volunteer"]);
    expect((await db.collection(C.users).doc(invite.uid).get()).exists).toBe(false);
  });

  it("lets users from an allowed domain in with no roles", async () => {
    await db.collection(C.config).doc("org").set({ allowedDomains: ["ndie.org.uk"] });
    const u = await resolveCaller({ uid: "d1", email: "staff@ndie.org.uk", provider: "google.com" }, "ui");
    expect(u.permissions.size).toBe(0);
  });

  it("refuses deactivated users", async () => {
    const admin = await userWith([SUPER_USER_ROLE_ID], "Admin");
    const vol = await userWith(["volunteer"], "Vol");
    await call(admin, "users.update", { uid: vol.uid, active: false });
    await expectCode(resolveCaller({ uid: vol.uid, email: vol.email, provider: "google.com" }, "ui"), "failed-precondition");
  });

  it("keeps at least one active super user", async () => {
    const admin = await userWith([SUPER_USER_ROLE_ID], "Only admin");
    const other = await userWith(["manager"], "Manager");
    await expectCode(call(admin, "users.update", { uid: admin.uid, roleIds: ["manager"] }), "failed-precondition");
    await call(admin, "users.update", { uid: other.uid, roleIds: [SUPER_USER_ROLE_ID] });
    await call(admin, "users.update", { uid: admin.uid, roleIds: ["manager"] });
    await expectCode(call(admin, "roles.delete", { id: SUPER_USER_ROLE_ID }), "failed-precondition");
  });
});

describe("permissions and audit", () => {
  it("denies and audits operations a role doesn't allow", async () => {
    const vol = await userWith(["volunteer"]);
    await expectCode(call(vol, "clients.create", NEW_CLIENT), "permission-denied");
    const audit = await auditFor({ actorUid: vol.uid });
    expect(audit[0]).toMatchObject({ action: "denied", op: "clients.create" });
  });

  it("audits every read with the clients it touched", async () => {
    const cw = await userWith(["caseworker"]);
    const client = await call(cw, "clients.create", NEW_CLIENT);
    await call(cw, "clients.get", { id: client.id });
    await call(cw, "clients.list", { search: "molly" });
    const reads = await auditFor({ clientId: client.id });
    const actions = reads.map((r) => `${r.action}:${r.op}`).sort();
    expect(actions).toEqual(["create:clients.create", "list:clients.list", "read:clients.get"]);
    expect(reads.every((r) => r.channel === "ui")).toBe(true);
  });

  it("seals before and after values with the client's key", async () => {
    const cw = await userWith(["caseworker"]);
    const client = await call(cw, "clients.create", NEW_CLIENT);
    await call(cw, "clients.update", { id: client.id, patch: { town: "Derby" } });
    const [entry] = await auditFor({ op: "clients.update" });
    expect(entry.diffSealed).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain("Derby");

    const manager = await userWith(["manager"]);
    const page = await call(manager, "audit.list", { clientId: client.id, limit: 50 });
    const update = page.items.find((i) => i.op === "clients.update")!;
    expect(update.diff).toEqual({ before: { town: "Nottingham" }, after: { town: "Derby" } });
  });
});

describe("clients", () => {
  it("creates, searches and normalises", async () => {
    const cw = await userWith(["caseworker"]);
    const c = await call(cw, "clients.create", NEW_CLIENT);
    expect(c.postcode).toBe("NG7 2RD");
    expect(c.postcodeDistrict).toBe("NG7");
    expect(c.contacts[0].id).toBeTruthy();
    expect(c.questionSetIds.sort()).toEqual(["health", "social"]);

    for (const search of ["mol", "o'brien", "NG7 2RD", "ng7", "mary o'b"]) {
      const res = await call(cw, "clients.list", { search });
      expect(res.items.map((i) => i.id), search).toEqual([c.id]);
    }
    expect((await call(cw, "clients.list", { search: "smith" })).items).toEqual([]);
    expect((await call(cw, "clients.list", { helpCategoryId: "lifts" })).items).toHaveLength(1);
    expect((await call(cw, "clients.list", { helpCategoryId: "health" })).items).toHaveLength(0);
  });

  it("paginates with a cursor", async () => {
    const cw = await userWith(["caseworker"]);
    for (const lastName of ["Adams", "Byrne", "Collins", "Doyle", "Egan"]) {
      await call(cw, "clients.create", { ...NEW_CLIENT, lastName, preferredName: undefined });
    }
    const first = await call(cw, "clients.list", { limit: 2 });
    const second = await call(cw, "clients.list", { limit: 2, cursor: first.nextCursor });
    const third = await call(cw, "clients.list", { limit: 2, cursor: second.nextCursor });
    expect([...first.items, ...second.items, ...third.items].map((c) => c.lastName)).toEqual(["Adams", "Byrne", "Collins", "Doyle", "Egan"]);
  });

  it("validates input", async () => {
    const cw = await userWith(["caseworker"]);
    await expectCode(call(cw, "clients.create", { ...NEW_CLIENT, firstName: "" }), "invalid-argument");
    await expectCode(call(cw, "clients.create", { ...NEW_CLIENT, email: "not-an-email" }), "invalid-argument");
  });
});

describe("questionnaires", () => {
  it("restricts sensitive sets and versions answers", async () => {
    const cw = await userWith(["caseworker"]);
    const vol = await userWith(["volunteer"]);
    const c = await call(cw, "clients.create", NEW_CLIENT);

    await call(cw, "answers.save", { clientId: c.id, setId: "health", answers: { "q-illness": "Arthritis" } });
    await call(cw, "answers.save", { clientId: c.id, setId: "health", answers: { "q-illness": "Arthritis, diabetes" } });
    const got = await call(cw, "answers.get", { clientId: c.id, setId: "health", includeHistory: true });
    expect(got.current?.version).toBe(2);
    expect(got.history.map((h) => h.answers["q-illness"])).toEqual(["Arthritis"]);

    await expectCode(call(vol, "answers.get", { clientId: c.id, setId: "health" }), "permission-denied");
    expect((await call(vol, "answers.get", { clientId: c.id, setId: "social" })).current).toBeNull();
  });

  it("rejects answers that don't fit the question", async () => {
    const cw = await userWith(["caseworker"]);
    const c = await call(cw, "clients.create", NEW_CLIENT);
    await expectCode(call(cw, "answers.save", { clientId: c.id, setId: "social", answers: { "q-lonely": "very" } }), "invalid-argument");
    await expectCode(call(cw, "answers.save", { clientId: c.id, setId: "social", answers: { "q-illness": "x" } }), "invalid-argument");
  });
});

describe("consent", () => {
  it("restricts processing when consent is withdrawn and lifts it when given again", async () => {
    const cw = await userWith(["caseworker"]);
    const c = await call(cw, "clients.create", NEW_CLIENT);
    const consent = await call(cw, "consents.record", {
      clientId: c.id,
      purpose: "data_processing",
      method: "verbal",
      givenAt: "2026-01-01T10:00:00Z",
    });
    await call(cw, "consents.withdraw", { id: consent.id });
    const restricted = await call(cw, "clients.get", { id: c.id });
    expect(restricted.status).toBe("restricted");
    expect(restricted.restrictions).toEqual(["no_processing"]);
    await expectCode(
      call(cw, "sessions.create", { clientId: c.id, typeId: "phone", startsAt: "2026-02-01T10:00:00Z", durationMinutes: 30 }),
      "failed-precondition",
    );
    // Safeguarding duties don't depend on consent.
    await call(cw, "safeguarding.raise", { clientId: c.id, description: "Worried", severity: "low" });

    await call(cw, "consents.record", { clientId: c.id, purpose: "data_processing", method: "written", givenAt: "2026-03-01T10:00:00Z" });
    expect((await call(cw, "clients.get", { id: c.id })).status).toBe("active");
  });

  it("blocks callbacks when consent to contact is withdrawn", async () => {
    const cw = await userWith(["caseworker"]);
    const c = await call(cw, "clients.create", NEW_CLIENT);
    const consent = await call(cw, "consents.record", { clientId: c.id, purpose: "contact", method: "verbal", givenAt: "2026-01-01T10:00:00Z" });
    await call(cw, "consents.withdraw", { id: consent.id });
    await expectCode(call(cw, "callbacks.create", { clientId: c.id, dueAt: "2026-05-01T10:00:00Z", reason: "Check in" }), "failed-precondition");
  });
});

describe("safeguarding and anonymisation", () => {
  it("flags clients only to people allowed to see it, and holds anonymisation until closed", async () => {
    const cw = await userWith(["caseworker"]);
    const vol = await userWith(["volunteer"]);
    const manager = await userWith(["manager"]);
    const c = await call(cw, "clients.create", NEW_CLIENT);

    const session = await call(cw, "sessions.create", {
      clientId: c.id,
      typeId: "in-person",
      startsAt: "2026-02-10T10:00:00Z",
      durationMinutes: 90,
      helpCategoryIds: ["lifts"],
      locationId: "other",
      locationOther: "Molly's sister's flat",
      status: "completed",
      notes: "Drove Molly to the hospital",
    });
    await call(cw, "notes.create", { clientId: c.id, body: "Molly's son visits on Sundays", linkedTo: { kind: "session", id: session.id } });
    await call(cw, "answers.save", { clientId: c.id, setId: "health", answers: { "q-illness": "Arthritis" } });
    await call(cw, "outcomes.record", {
      clientId: c.id,
      setId: "impact",
      helpCategoryId: "lifts",
      sessionId: session.id,
      perspective: "client",
      answers: { "q-helped": true, "q-better": 4, "q-comment": "Sean says thanks" },
    });

    const concern = await call(cw, "safeguarding.raise", { clientId: c.id, description: "Bruising noticed", severity: "high" });
    expect((await call(cw, "clients.get", { id: c.id })).openSafeguardingConcerns).toBe(1);
    expect((await call(vol, "clients.get", { id: c.id })).openSafeguardingConcerns).toBeUndefined();
    expect((await call(manager, "clients.list", { flaggedOnly: true })).items).toHaveLength(1);

    await expectCode(call(manager, "clients.anonymise", { id: c.id, basis: "erasure_request" }), "failed-precondition");
    await call(manager, "safeguarding.update", { id: concern.id, status: "closed", comment: "Resolved with GP" });
    expect((await call(manager, "clients.get", { id: c.id })).openSafeguardingConcerns).toBe(0);

    await call(manager, "clients.anonymise", { id: c.id, basis: "erasure_request" });

    const after = await call(manager, "clients.get", { id: c.id });
    expect(after.status).toBe("anonymised");
    expect(after.postcodeDistrict).toBe("NG7");
    expect(after.contacts).toEqual([]);
    expect(after.postcode).toBeUndefined();
    expect(after.town).toBeUndefined();

    const raw = JSON.stringify((await db.collection(C.clients).doc(c.id).get()).data());
    for (const personal of ["Mary", "O'Brien", "Molly", "Shamrock", "Sean", "1941"]) expect(raw).not.toContain(personal);

    expect(await call(manager, "notes.list", { clientId: c.id, limit: 50 })).toEqual([]);
    expect((await call(manager, "answers.get", { clientId: c.id, setId: "health" })).current).toBeNull();
    const [outcome] = await call(manager, "outcomes.list", { clientId: c.id });
    expect(outcome.answers).toEqual({ "q-helped": true, "q-better": 4 });
    expect(outcome.recordedAt.endsWith("-01T00:00:00.000Z")).toBe(true);
    const [s] = await call(manager, "sessions.list", { clientId: c.id, limit: 10 });
    expect(s.notes).toBeUndefined();
    expect(s.locationId).toBe("other");
    expect(s.locationOther).toBeUndefined();
    expect(s.startsAt).toBe("2026-02-01T00:00:00.000Z");
    const [closed] = await call(manager, "safeguarding.list", { clientId: c.id });
    expect(closed.description).toBe("");

    // Audit entries survive, but their sealed values can no longer be read.
    const audit = await call(manager, "audit.list", { clientId: c.id, limit: 200 });
    const update = audit.items.find((i) => i.op === "clients.create")!;
    expect(update.diff).toBeNull();
    const anon = audit.items.find((i) => i.action === "anonymise")!;
    expect(anon.detail).toBe("Right to erasure request");

    // Reports still count the help given.
    const demand = await call(manager, "reports.demand", { filters: {}, dimension: "helpCategory" });
    expect(demand.rows.find((r) => r.key === "lifts")?.values).toMatchObject({ clients: 1, sessions: 1, hours: 1.5 });
    const outcomes = await call(manager, "reports.outcomes", { setId: "impact", filters: {}, dimension: "postcodeDistrict" });
    expect(outcomes.rows).toEqual([{ key: "NG7", label: "NG7", values: { responses: 1, "q-helped:yes": 100, "q-better:avg": 4 } }]);

    // Nothing more can be written to an anonymised client.
    await expectCode(call(manager, "clients.update", { id: c.id, patch: { firstName: "X" } }), "failed-precondition");
  });
});

describe("retention", () => {
  it("anonymises clients past the retention period unless safeguarding holds them", async () => {
    const cw = await userWith(["caseworker"]);
    const manager = await userWith(["manager"]);
    const old = await call(cw, "clients.create", NEW_CLIENT);
    const held = await call(cw, "clients.create", { ...NEW_CLIENT, firstName: "Bridget" });
    const recent = await call(cw, "clients.create", { ...NEW_CLIENT, firstName: "Patrick" });
    await call(cw, "safeguarding.raise", { clientId: held.id, description: "Concern", severity: "medium" });
    const fourYearsAgo = Timestamp.fromDate(new Date(Date.now() - 4 * 365 * 86_400_000));
    await db.collection(C.clients).doc(old.id).update({ lastActivityAt: fourYearsAgo });
    await db.collection(C.clients).doc(held.id).update({ lastActivityAt: fourYearsAgo });
    const nearly = Timestamp.fromDate(new Date(Date.now() - (3 * 365 - 30) * 86_400_000));
    await db.collection(C.clients).doc(recent.id).update({ lastActivityAt: nearly });

    const upcoming = await call(manager, "retention.upcoming", {});
    expect(upcoming.map((u) => u.clientId).sort()).toEqual([old.id, held.id, recent.id].sort());
    expect(upcoming.find((u) => u.clientId === held.id)?.heldBySafeguarding).toBe(true);

    // The first run only warns. Nobody is anonymised until the warning period has passed.
    expect(await runRetention()).toMatchObject({ anonymised: 0, warned: 3 });
    expect((await call(manager, "clients.get", { id: old.id })).status).toBe("active");
    const longAgo = Timestamp.fromMillis(Date.now() - 61 * 86_400_000);
    for (const id of [old.id, held.id]) await db.collection(C.clients).doc(id).update({ retentionWarnedAt: longAgo });

    const result = await runRetention();
    expect(result).toMatchObject({ anonymised: 1, held: 1 });
    expect((await call(manager, "clients.get", { id: old.id })).status).toBe("anonymised");
    expect((await call(manager, "clients.get", { id: held.id })).status).toBe("active");
    expect((await call(manager, "clients.get", { id: recent.id })).status).toBe("active");

    const system = await auditFor({ actorUid: "system" });
    expect(system.find((a) => a.action === "anonymise")).toMatchObject({ channel: "system", detail: "Retention period passed" });
    const notes = await db.collection(C.notifications).where("userUid", "==", manager.uid).get();
    expect(notes.docs.map((d) => d.get("kind"))).toContain("retention_upcoming");
  });
});

describe("callbacks and reminders", () => {
  it("notifies the assignee once before and once when overdue", async () => {
    const cw = await userWith(["caseworker"]);
    const c = await call(cw, "clients.create", NEW_CLIENT);
    const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const cb = await call(cw, "callbacks.create", { clientId: c.id, dueAt: soon, reason: "Check how the appointment went" });

    expect(await runReminders()).toEqual({ due: 1, overdue: 0 });
    expect(await runReminders()).toEqual({ due: 0, overdue: 0 });
    expect(await runReminders(Timestamp.fromMillis(Date.now() + 3 * 3_600_000))).toEqual({ due: 0, overdue: 1 });

    const dash = await call(cw, "dashboard.get", {});
    expect(dash.notifications.map((n) => n.kind).sort()).toEqual(["callback_due", "callback_overdue"]);
    expect(dash.notifications.every((n) => !n.message.includes("Mary"))).toBe(true);
    expect(dash.upcomingCallbacks[0]).toMatchObject({ id: cb.id, clientName: "Molly O'Brien" });

    await call(cw, "callbacks.update", { id: cb.id, patch: { status: "done" } });
    expect((await call(cw, "dashboard.get", {})).upcomingCallbacks).toEqual([]);
  });
});

describe("reports", () => {
  it("splits activity by staff and month", async () => {
    const cw = await userWith(["caseworker"], "Aoife");
    const manager = await userWith(["manager"]);
    const c = await call(cw, "clients.create", NEW_CLIENT);
    for (const startsAt of ["2026-01-05T10:00:00Z", "2026-01-20T10:00:00Z", "2026-02-03T10:00:00Z"]) {
      await call(cw, "sessions.create", { clientId: c.id, typeId: "phone", startsAt, durationMinutes: 30, status: "completed" });
    }
    const byMonth = await call(manager, "reports.activity", { filters: { from: "2026-01-01", to: "2026-02-28" }, dimension: "month" });
    expect(byMonth.rows.map((r) => [r.key, r.values.sessionsCompleted])).toEqual([
      ["2026-01", 2],
      ["2026-02", 1],
    ]);
    const byStaff = await call(manager, "reports.activity", { filters: {}, dimension: "staff" });
    expect(byStaff.rows[0]).toMatchObject({ label: "Aoife", values: { sessionsCompleted: 3 } });

    const csv = await call(manager, "reports.exportCsv", { report: "activity", filters: {}, dimension: "month" });
    expect(csv.csv.split("\r\n")[0]).toContain("Sessions completed");
    expect((await auditFor({ op: "reports.exportCsv" }))[0].action).toBe("export");
  });
});

describe("tokens", () => {
  it("creates, lists and revokes personal access tokens", async () => {
    const cw = await userWith(["caseworker"]);
    const { token, summary } = await call(cw, "tokens.create", { name: "Claude Desktop", expiresInDays: 30 });
    expect(token.startsWith("ccm_")).toBe(true);
    const list = await call(cw, "tokens.list", {});
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(token);
    const vol = await userWith(["volunteer"]);
    await expectCode(call(vol, "tokens.create", { name: "x", expiresInDays: 1 }), "permission-denied");
    await call(cw, "tokens.revoke", { id: summary.id });
    expect((await call(cw, "tokens.list", {}))[0].revokedAt).toBeTruthy();
  });
});

describe("protections found in review", () => {
  it("hides sensitive audit values from people who can't see them", async () => {
    const cw = await userWith(["caseworker"]);
    const c = await call(cw, "clients.create", NEW_CLIENT);
    await call(cw, "answers.save", { clientId: c.id, setId: "health", answers: { "q-illness": "Angina" } });
    await db.collection(C.roles).doc("auditor").set({ name: "Auditor", permissions: ["clients.view", "audit.view"], system: false });
    const auditor = await userWith(["auditor"]);
    const page = await call(auditor, "audit.list", { clientId: c.id, limit: 50 });
    const save = page.items.find((i) => i.op === "answers.save")!;
    expect(save.diff).toBeUndefined();
    expect(save.diffHidden).toBe(true);
    expect(JSON.stringify(page)).not.toContain("Angina");
    // Viewing the audit log counts as viewing the client.
    const access = await auditFor({ op: "audit.list", actorUid: auditor.uid });
    expect(access[0].clientIds).toContain(c.id);
  });

  it("keeps sensitive sets and safeguarding out of exports for people without those permissions", async () => {
    const cw = await userWith(["caseworker"]);
    const c = await call(cw, "clients.create", NEW_CLIENT);
    await call(cw, "answers.save", { clientId: c.id, setId: "health", answers: { "q-illness": "Angina" } });
    await call(cw, "safeguarding.raise", { clientId: c.id, description: "Concern", severity: "low" });
    await db.collection(C.roles).doc("exporter").set({ name: "Exporter", permissions: ["clients.view", "clients.export"], system: false });
    const exporter = await userWith(["exporter"]);
    const out = await call(exporter, "clients.export", { id: c.id });
    expect(out.answers).toEqual([]);
    expect(out.safeguarding).toEqual([]);
  });

  it("needs permission to anonymise before the retention period can be shortened", async () => {
    await db.collection(C.roles).doc("config").set({ name: "Config", permissions: ["config.manage"], system: false });
    const config = await userWith(["config"]);
    await expectCode(call(config, "org.updateSettings", { retentionMonths: 1 }), "permission-denied");
    await call(config, "org.updateSettings", { retentionMonths: 48 });
    const manager = await userWith(["manager"]);
    await call(manager, "org.updateSettings", { retentionMonths: 24 });
  });

  it("treats null as absent and an empty string as clearing a field", async () => {
    const cw = await userWith(["caseworker"]);
    const c = await call(cw, "clients.create", { ...NEW_CLIENT, email: null } as never);
    const updated = await call(cw, "clients.update", { id: c.id, patch: { preferredName: "", dateOfBirth: "", town: null } as never });
    expect(updated.preferredName).toBeUndefined();
    expect(updated.dateOfBirth).toBeUndefined();
    expect(updated.town).toBe("Nottingham");
    expect((await call(cw, "clients.list", { search: "molly" })).items).toEqual([]);
    expect((await call(cw, "clients.list", { search: "mary" })).items).toHaveLength(1);
  });

  it("cancels open callbacks and scheduled sessions on anonymisation and refuses later safeguarding edits", async () => {
    const cw = await userWith(["caseworker"]);
    const manager = await userWith(["manager"]);
    const c = await call(cw, "clients.create", NEW_CLIENT);
    await call(cw, "callbacks.create", { clientId: c.id, dueAt: "2027-01-01T10:00:00Z", reason: "Ring Molly" });
    const concern = await call(cw, "safeguarding.raise", { clientId: c.id, description: "Concern", severity: "low" });
    await call(manager, "safeguarding.update", { id: concern.id, status: "closed" });
    await call(manager, "clients.anonymise", { id: c.id, basis: "no_longer_needed" });
    const [cb] = await call(manager, "callbacks.list", { clientId: c.id, limit: 5 });
    expect(cb.status).toBe("cancelled");
    await expectCode(call(manager, "safeguarding.update", { id: concern.id, comment: "Reopening" }), "failed-precondition");
  });
});

describe("session locations", () => {
  it("require a description for Other, group reports by managed location and promote Other descriptions", async () => {
    const cw = await userWith(["caseworker"]);
    const manager = await userWith(["manager"]);
    const c = await call(cw, "clients.create", NEW_CLIENT);
    const base = { clientId: c.id, typeId: "in-person", durationMinutes: 60, status: "completed" as const, helpCategoryIds: ["lifts"] };

    await expectCode(call(cw, "sessions.create", { ...base, startsAt: "2026-03-01T10:00:00Z", locationId: "other" }), "invalid-argument");
    await expectCode(call(cw, "sessions.create", { ...base, startsAt: "2026-03-01T10:00:00Z", locationId: "nowhere" }), "invalid-argument");

    await call(cw, "sessions.create", { ...base, startsAt: "2026-03-01T10:00:00Z", locationId: "hospital" });
    const s2 = await call(cw, "sessions.create", { ...base, startsAt: "2026-03-02T10:00:00Z", locationId: "other", locationOther: "Irish Centre " });
    await call(cw, "sessions.create", { ...base, startsAt: "2026-03-03T10:00:00Z", locationId: "other", locationOther: "irish centre" });
    await call(cw, "sessions.create", { ...base, startsAt: "2026-03-04T10:00:00Z", locationId: "other", locationOther: "Library" });
    // Free text is ignored when a managed location is chosen, and dropped for sessions not in person.
    const s5 = await call(cw, "sessions.create", { ...base, startsAt: "2026-03-05T10:00:00Z", locationId: "hospital", locationOther: "ignored" });
    expect(s5.locationOther).toBeUndefined();
    const phone = await call(cw, "sessions.create", { ...base, typeId: "phone", startsAt: "2026-03-06T10:00:00Z", locationId: "hospital" });
    expect(phone.locationId).toBeUndefined();

    const byLocation = await call(manager, "reports.demand", { filters: {}, dimension: "location" });
    expect(Object.fromEntries(byLocation.rows.map((r) => [r.label, r.values.sessions]))).toEqual({ Hospital: 2, Other: 3, Unknown: 1 });
    expect(JSON.stringify(byLocation)).not.toContain("Irish");

    expect(await call(manager, "sessionLocations.otherValues", {})).toEqual([
      { text: "irish centre", sessions: 2, lastUsedAt: "2026-03-03T10:00:00.000Z" },
      { text: "Library", sessions: 1, lastUsedAt: "2026-03-04T10:00:00.000Z" },
    ]);

    const centre = await call(manager, "sessionLocations.upsert", { name: "Irish Centre", isOther: false, archived: false });
    expect(await call(manager, "sessionLocations.promoteOther", { texts: ["irish centre"], locationId: centre.id })).toEqual({ moved: 2 });
    await expectCode(call(manager, "sessionLocations.promoteOther", { texts: ["Library"], locationId: "other" }), "invalid-argument");

    const [moved] = (await call(cw, "sessions.list", { clientId: c.id, limit: 20 })).filter((s) => s.id === s2.id);
    expect(moved.locationId).toBe(centre.id);
    expect(moved.locationOther).toBeUndefined();
    expect((await call(manager, "sessionLocations.otherValues", {})).map((o) => o.text)).toEqual(["Library"]);
    const after = await call(manager, "reports.demand", { filters: { locationId: centre.id }, dimension: "location" });
    expect(after.rows).toEqual([{ key: centre.id, label: "Irish Centre", values: { sessions: 2, hours: 2, clients: 1 } }]);

    // Editing a session to a non Other location clears its description.
    const lib = (await call(cw, "sessions.list", { clientId: c.id, limit: 20 })).find((s) => s.locationOther === "Library")!;
    const edited = await call(cw, "sessions.update", { id: lib.id, patch: { locationId: "hospital" } });
    expect(edited.locationOther).toBeUndefined();
  });
});
