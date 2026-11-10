import { SUPER_USER_ROLE_ID } from "@ccm/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { C, db } from "../src/core/firebase.js";
import { handleIntake, MAX_BODY_BYTES, type IntakeRequest } from "../src/intake.js";
import { runRetention } from "../src/jobs/retention.js";
import { auditFor, call, clearFirestore, NEW_CLIENT, seedBasics, userWith } from "./helpers.js";

beforeEach(async () => {
  await clearFirestore();
  await seedBasics();
});

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

const FAMILY_REFERRAL = {
  referrerType: "family_or_friend",
  referrerName: "Sean O'Brien",
  referrerRelationship: "Son",
  referrerPhone: "07700 900000",
  firstName: "Mary",
  lastName: "O'Brien",
  town: "Nottingham",
  postcode: "ng7 2rd",
  phone: "0115 000 0000",
  preferredContactMethod: "phone",
  helpNeeded: "Mum is on her own most days and would like some company.",
  helpCategoryHints: ["Loneliness"],
  personAware: true,
  consentToContact: true,
  heardAbout: "Church newsletter",
  sourceUrl: "https://example.org/refer",
};

function post(key: string | null, body: unknown, extra: Partial<IntakeRequest> = {}): IntakeRequest {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body,
    rawBody: Buffer.from(JSON.stringify(body)),
    ...extra,
  };
}

async function newKey(hourlyLimit = 20) {
  const admin = await userWith([SUPER_USER_ROLE_ID], "Admin");
  const { key, summary } = await call(admin, "integrationKeys.create", { name: "Charity website", source: "Website", hourlyLimit });
  return { admin, key, summary };
}

describe("referral intake", () => {
  it("accepts a valid referral with a good key and returns only a reference", async () => {
    const { key } = await newKey();
    const res = await handleIntake(post(key, FAMILY_REFERRAL));
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(["reference"]);
    expect(res.body.reference).toMatch(/^R-[2-9A-Z]{6}$/);

    const stored = (await db.collection(C.referrals).get()).docs[0].data();
    expect(stored).toMatchObject({ status: "new", source: "Website", firstName: "Mary", postcode: "NG7 2RD", postcodeDistrict: "NG7" });

    const audit = await auditFor({ op: "referrals.intake" });
    expect(audit).toHaveLength(1);
    expect(audit[0].channel).toBe("integration");
    expect(JSON.stringify(audit[0])).not.toContain("Mary");
  });

  it("refuses missing, unknown and revoked keys with the same answer", async () => {
    const { admin, key, summary } = await newKey();
    expect((await handleIntake(post(null, FAMILY_REFERRAL))).status).toBe(401);
    expect((await handleIntake(post("ccmk_not-a-real-key", FAMILY_REFERRAL))).status).toBe(401);
    expect((await handleIntake(post("ccm_personal-token", FAMILY_REFERRAL))).status).toBe(401);

    await call(admin, "integrationKeys.revoke", { id: summary.id });
    const revoked = await handleIntake(post(key, FAMILY_REFERRAL));
    expect(revoked.status).toBe(401);
    expect(revoked.body).toEqual({ error: "unauthorised" });
    expect((await db.collection(C.referrals).get()).size).toBe(0);
  });

  it("checks method, content type and size", async () => {
    const { key } = await newKey();
    expect((await handleIntake({ ...post(key, FAMILY_REFERRAL), method: "GET" })).status).toBe(405);
    expect((await handleIntake(post(key, FAMILY_REFERRAL, { headers: { "content-type": "text/plain", authorization: `Bearer ${key}` } }))).status).toBe(415);
    const huge = { ...FAMILY_REFERRAL, helpNeeded: "x".repeat(MAX_BODY_BYTES) };
    expect((await handleIntake(post(key, huge))).status).toBe(413);
  });

  it("rejects invalid bodies and unknown fields without echoing values", async () => {
    const { key } = await newKey();
    const noConsent = await handleIntake(post(key, { ...FAMILY_REFERRAL, consentToContact: false }));
    expect(noConsent.status).toBe(400);
    expect(JSON.stringify(noConsent.body)).toContain("consentToContact");

    const extra = await handleIntake(post(key, { ...FAMILY_REFERRAL, isAdmin: true, nationalInsurance: "QQ123456C" }));
    expect(extra.status).toBe(400);
    expect(JSON.stringify(extra.body)).not.toContain("QQ123456C");

    const noContact = await handleIntake(post(key, { ...FAMILY_REFERRAL, phone: "" }));
    expect(noContact.status).toBe(400);

    const anonymousThirdParty = await handleIntake(post(key, { ...FAMILY_REFERRAL, referrerName: "", referrerPhone: "" }));
    expect(anonymousThirdParty.status).toBe(400);
    expect((await handleIntake(post(key, "not an object"))).status).toBe(400);
    expect((await db.collection(C.referrals).get()).size).toBe(0);
  });

  it("rate limits each key per hour, counting invalid requests too", async () => {
    const { key } = await newKey(3);
    const now = new Date("2026-11-05T10:15:00Z");
    expect((await handleIntake(post(key, FAMILY_REFERRAL), now)).status).toBe(201);
    expect((await handleIntake(post(key, { junk: true }), now)).status).toBe(400);
    expect((await handleIntake(post(key, FAMILY_REFERRAL), now)).status).toBe(201);
    const limited = await handleIntake(post(key, FAMILY_REFERRAL), now);
    expect(limited.status).toBe(429);
    expect(limited.headers?.["Retry-After"]).toBe(String(45 * 60));
    // The next hour starts afresh.
    expect((await handleIntake(post(key, FAMILY_REFERRAL), new Date("2026-11-05T11:00:01Z"))).status).toBe(201);
  });

  it("treats a repeated submission id as the same referral", async () => {
    const { key } = await newKey();
    const body = { ...FAMILY_REFERRAL, submissionId: "form-1234567890" };
    const first = await handleIntake(post(key, body));
    const again = await handleIntake(post(key, body));
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.reference).toBe(first.body.reference);
    expect((await db.collection(C.referrals).get()).size).toBe(1);
  });

  it("drops referrer details from self referrals", async () => {
    const { key } = await newKey();
    const res = await handleIntake(post(key, { ...FAMILY_REFERRAL, referrerType: "self", personAware: false }));
    expect(res.status).toBe(201);
    const stored = (await db.collection(C.referrals).get()).docs[0].data();
    expect(stored.referrerName).toBeUndefined();
    expect(stored.personAware).toBe(true);
  });
});

async function intake(body: Record<string, unknown> = FAMILY_REFERRAL) {
  const { key } = await newKey();
  await handleIntake(post(key, body));
  const doc = (await db.collection(C.referrals).get()).docs[0];
  return doc.id;
}

describe("referral triage", () => {
  it("lets caseworkers see and work referrals, but not volunteers", async () => {
    const id = await intake();
    const cw = await userWith(["caseworker"], "Caseworker");
    const vol = await userWith(["volunteer"], "Volunteer");

    const list = await call(cw, "referrals.list", {});
    expect(list.items.map((r) => r.id)).toEqual([id]);
    expect(list.items[0].displayName).toBe("Mary O'Brien");
    await expectCode(call(vol, "referrals.list", {}), "permission-denied");
    await expectCode(call(vol, "referrals.decline", { id, reason: "No" }), "permission-denied");
    await expectCode(call(cw, "integrationKeys.list", {}), "permission-denied");

    const updated = await call(cw, "referrals.update", { id, status: "contacted", assigneeUid: cw.uid, notes: "Left a message" });
    expect(updated).toMatchObject({ status: "contacted", assigneeUid: cw.uid, notes: "Left a message" });
    expect((await call(cw, "referrals.list", { status: "new" })).items).toHaveLength(0);
    expect((await call(cw, "referrals.list", { status: "open", assigneeUid: cw.uid })).items).toHaveLength(1);

    const audit = await auditFor({ op: "referrals.update" });
    expect(JSON.stringify(audit)).not.toContain("Left a message");
    expect((await auditFor({ op: "referrals.list" })).length).toBeGreaterThan(0);
  });

  it("shows new referrals on the dashboard", async () => {
    await intake();
    const cw = await userWith(["caseworker"]);
    expect((await call(cw, "dashboard.get", {})).newReferrals).toBe(1);
    const vol = await userWith(["volunteer"]);
    expect((await call(vol, "dashboard.get", {})).newReferrals).toBeUndefined();
  });

  it("accepts a referral as a new client with the details as a note", async () => {
    const id = await intake();
    const cw = await userWith(["caseworker"]);
    const res = await call(cw, "referrals.accept", { id, helpCategoryIds: ["loneliness"] });
    expect(res.createdClient).toBe(true);
    expect(res.referral).toMatchObject({ status: "accepted", clientId: res.clientId, decidedBy: cw.uid });

    const client = await call(cw, "clients.get", { id: res.clientId });
    expect(client).toMatchObject({ firstName: "Mary", lastName: "O'Brien", postcode: "NG7 2RD", helpCategoryIds: ["loneliness"] });
    expect(client.contacts[0]).toMatchObject({ name: "Sean O'Brien", relationship: "Son" });
    const notes = await call(cw, "notes.list", { clientId: res.clientId });
    expect(notes[0].body).toContain("company");

    await expectCode(call(cw, "referrals.decline", { id, reason: "Changed mind" }), "failed-precondition");
    expect((await auditFor({ op: "referrals.accept", clientId: res.clientId })).length).toBe(1);
  });

  it("warns about possible duplicates and can link to the existing client", async () => {
    const cw = await userWith(["caseworker"]);
    const existing = await call(cw, "clients.create", NEW_CLIENT);
    const id = await intake();
    const { possibleDuplicates } = await call(cw, "referrals.get", { id });
    expect(possibleDuplicates).toHaveLength(1);
    expect(possibleDuplicates[0]).toMatchObject({ clientId: existing.id, reason: "same name, postcode and phone number" });

    const res = await call(cw, "referrals.accept", { id, existingClientId: existing.id });
    expect(res).toMatchObject({ clientId: existing.id, createdClient: false });
    expect((await db.collection(C.clients).get()).size).toBe(1);
  });

  it("needs clients.create to accept as a new client", async () => {
    const id = await intake();
    await db.collection(C.roles).doc("triage").set({ name: "Triage", permissions: ["referrals.view", "referrals.manage"], system: false });
    const triage = await userWith(["triage"]);
    await expectCode(call(triage, "referrals.accept", { id }), "permission-denied");
  });

  it("declines with a reason and removes personal details after the retention period", async () => {
    const id = await intake();
    const cw = await userWith(["caseworker"]);
    const declined = await call(cw, "referrals.decline", { id, reason: "Outside our area" });
    expect(declined).toMatchObject({ status: "declined", declineReason: "Outside our area" });

    await runRetention();
    expect((await db.collection(C.referrals).doc(id).get()).get("firstName")).toBe("Mary");

    await db.collection(C.referrals).doc(id).update({ decidedAt: Timestamp.fromMillis(Date.now() - 91 * 86_400_000) });
    await runRetention();
    const after = (await db.collection(C.referrals).doc(id).get()).data()!;
    for (const f of ["firstName", "lastName", "phone", "helpNeeded", "referrerName", "declineReason"]) expect(after[f]).toBeUndefined();
    expect(after).toMatchObject({ status: "declined", postcodeDistrict: "NG7", source: "Website" });
    expect(after.anonymisedAt).toBeDefined();

    const shown = await call(cw, "referrals.get", { id });
    expect(shown.referral.anonymisedAt).toBeDefined();
    expect((await call(cw, "referrals.list", { status: "all" })).items[0].displayName).toBe("Anonymised referral");
    await expectCode(call(cw, "referrals.update", { id, notes: "x" }), "failed-precondition");
  });

  it("anonymises linked referrals with the client and includes them in exports", async () => {
    const id = await intake();
    const admin = await userWith([SUPER_USER_ROLE_ID]);
    const { clientId } = await call(admin, "referrals.accept", { id });
    const exported = await call(admin, "clients.export", { id: clientId });
    expect(exported.referrals.map((r) => r.id)).toEqual([id]);

    await call(admin, "clients.anonymise", { id: clientId, basis: "erasure_request" });
    const after = (await db.collection(C.referrals).doc(id).get()).data()!;
    expect(after.firstName).toBeUndefined();
    expect(after.anonymisedAt).toBeDefined();
  });

  it("only lets people with integrations.manage handle keys, and never returns the key again", async () => {
    const { admin, summary } = await newKey();
    const list = await call(admin, "integrationKeys.list", {});
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("ccmk_");
    expect(list[0]).toMatchObject({ name: "Charity website", source: "Website", hourlyLimit: 20 });
    const manager = await userWith(["manager"]);
    expect(manager.can("integrations.manage")).toBe(true);
    await call(manager, "integrationKeys.revoke", { id: summary.id });
    expect((await call(admin, "integrationKeys.list", {}))[0].revokedAt).toBeDefined();
  });
});
