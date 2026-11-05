/**
 * Referral triage. Referrals arrive through the intake endpoint (see
 * intake.ts) and wait here until someone accepts them, which creates or links
 * a client, or declines them. Audit entries for referrals never hold the
 * referral's personal details, only statuses and who did what, because a
 * referral isn't a client yet and has no data key to seal them with.
 */
import {
  clientDisplayName,
  normalisePostcode,
  type IntegrationKeySummary,
  type PossibleDuplicate,
  type Referral,
  type ReferralStatus,
  type ReferralSummary,
} from "@ccm/shared";
import { FieldValue, Timestamp, type DocumentSnapshot, type Query } from "firebase-admin/firestore";
import { auditInBatch } from "../core/audit.js";
import type { Ctx } from "../core/context.js";
import { randomToken, sha256 } from "../core/crypto.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { fail } from "../core/errors.js";
import { C, db, serialise } from "../core/firebase.js";
import { activityHandlers } from "./activity.js";
import { clientHandlers } from "./clients.js";
import { clientFor } from "./common.js";
import { REFERRAL_PERSONAL_FIELDS } from "../jobs/referrals.js";

export { REFERRAL_PERSONAL_FIELDS };

export const INTEGRATION_KEY_PREFIX = "ccmk_";

const OPEN: ReferralStatus[] = ["new", "contacted"];

export function referralOut(snap: DocumentSnapshot): Referral {
  const data = { ...(snap.data() ?? {}) };
  for (const key of ["pendingPurge", "keyId", "submissionId"]) delete data[key];
  const out = serialise<Referral>({ id: snap.id, ...data });
  out.helpCategoryHints ??= [];
  out.firstName ??= "";
  out.lastName ??= "";
  out.helpNeeded ??= "";
  return out;
}

export function referralDisplayName(r: { firstName?: string; lastName?: string; anonymisedAt?: unknown }): string {
  if (r.anonymisedAt || !(r.firstName || r.lastName)) return "Anonymised referral";
  return `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim();
}

function summaryOut(snap: DocumentSnapshot): ReferralSummary {
  const r = referralOut(snap);
  return {
    id: r.id,
    reference: r.reference,
    status: r.status,
    source: r.source,
    referrerType: r.referrerType,
    displayName: referralDisplayName(r),
    town: r.town,
    postcodeDistrict: r.postcodeDistrict,
    helpCategoryHints: r.helpCategoryHints,
    assigneeUid: r.assigneeUid,
    createdAt: r.createdAt,
    anonymisedAt: r.anonymisedAt,
  };
}

function keyOut(id: string, d: FirebaseFirestore.DocumentData): IntegrationKeySummary {
  return serialise<IntegrationKeySummary>({
    id,
    name: d.name,
    source: d.source,
    hourlyLimit: d.hourlyLimit,
    createdAt: d.createdAt,
    createdBy: d.createdBy,
    lastUsedAt: d.lastUsedAt,
    revokedAt: d.revokedAt,
  });
}

async function loadReferral(id: string) {
  const snap = await db.collection(C.referrals).doc(id).get();
  if (!snap.exists) throw fail.notFound("Referral");
  return snap;
}

function assertOpen(snap: DocumentSnapshot) {
  if (snap.get("anonymisedAt")) throw fail.precondition("This referral's details have been removed under the retention policy.");
  if (!OPEN.includes(snap.get("status"))) throw fail.precondition("This referral has already been accepted or declined.");
}

const digits = (v?: string) => (v ?? "").replace(/\D/g, "");
const lower = (v?: string) => (v ?? "").trim().toLowerCase();

/** The token clients are indexed under for a surname, as in clients.ts. */
function surnameToken(lastName: string): string {
  return (lastName.toLowerCase().split(/[\s-]+/)[0] ?? "").replace(/[^a-z0-9'-]/g, "");
}

/**
 * Existing clients who might be the person referred: same first and last
 * name, with the reason strengthened when the postcode or a phone number
 * also matches. Anonymised clients are never matched.
 */
export async function findPossibleDuplicates(ctx: Ctx, r: Referral): Promise<PossibleDuplicate[]> {
  const token = surnameToken(r.lastName);
  if (!token || r.anonymisedAt) return [];
  const snap = await db.collection(C.clients).where("searchTokens", "array-contains", token).limit(50).get();
  const out: PossibleDuplicate[] = [];
  const postcode = normalisePostcode(r.postcode);
  const phone = digits(r.phone);
  for (const doc of snap.docs) {
    const c = doc.data();
    if (c.status === "anonymised") continue;
    if (lower(c.lastName) !== lower(r.lastName)) continue;
    const first = lower(r.firstName);
    if (lower(c.firstName) !== first && lower(c.preferredName) !== first) continue;
    const reasons = ["name"];
    if (postcode && c.postcode && normalisePostcode(c.postcode) === postcode) reasons.push("postcode");
    const phones = ((c.phones as { number: string }[] | undefined) ?? []).map((p) => digits(p.number));
    if (phone.length >= 6 && phones.includes(phone)) reasons.push("phone number");
    ctx.touched.add(doc.id);
    out.push({
      clientId: doc.id,
      displayName: clientDisplayName(c as { firstName: string; lastName: string; preferredName?: string }),
      town: c.town,
      postcodeDistrict: c.postcodeDistrict,
      reason: reasons.length === 1 ? "same name" : `same ${reasons.slice(0, -1).join(", ")} and ${reasons.at(-1)}`,
    });
  }
  // Strongest matches first.
  return out.sort((a, b) => b.reason.length - a.reason.length);
}

function referralNote(r: Referral): string {
  const lines = [`Referral ${r.reference} received ${r.createdAt.slice(0, 10)} from ${r.source}.`];
  if (r.referrerType === "self") lines.push("Self referral.");
  else {
    const who = [r.referrerName, r.referrerRelationship && `(${r.referrerRelationship})`, r.referrerOrganisation && `at ${r.referrerOrganisation}`]
      .filter(Boolean)
      .join(" ");
    const contact = [r.referrerPhone, r.referrerEmail].filter(Boolean).join(", ");
    lines.push(`Referred by ${who}${contact ? `, ${contact}` : ""}.`);
    lines.push(r.personAware ? "The referrer says the person knows about this referral." : "The referrer didn't confirm the person knows about this referral.");
  }
  lines.push("", "Help needed:", r.helpNeeded);
  if (r.helpCategoryHints.length) lines.push("", `Areas mentioned: ${r.helpCategoryHints.join(", ")}`);
  if (r.heardAbout) lines.push(`Heard about us: ${r.heardAbout}`);
  if (r.notes) lines.push("", "Triage notes:", r.notes);
  return lines.join("\n");
}

export const referralHandlers: HandlerGroup = {
  async "referrals.list"(input) {
    let q: Query = db.collection(C.referrals);
    if (input.assigneeUid) q = q.where("assigneeUid", "==", input.assigneeUid);
    if (input.status === "open") q = q.where("status", "in", OPEN);
    else if (input.status !== "all") q = q.where("status", "==", input.status);
    const snap = await q.orderBy("createdAt", "desc").limit(input.limit).get();
    return { items: snap.docs.map(summaryOut) };
  },

  async "referrals.get"(input, ctx) {
    const referral = referralOut(await loadReferral(input.id));
    const open = OPEN.includes(referral.status);
    const possibleDuplicates = open && ctx.can("clients.view") ? await findPossibleDuplicates(ctx, referral) : [];
    return { referral, possibleDuplicates };
  },

  async "referrals.update"(input, ctx) {
    const snap = await loadReferral(input.id);
    if (snap.get("anonymisedAt")) throw fail.precondition("This referral's details have been removed under the retention policy.");
    const status = snap.get("status") as ReferralStatus;
    if (input.status && !OPEN.includes(status)) throw fail.precondition("This referral has already been accepted or declined.");

    const update: Record<string, unknown> = { updatedAt: Timestamp.now() };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (input.status && input.status !== status) {
      update.status = input.status;
      before.status = status;
      after.status = input.status;
    }
    let notify: string | null = null;
    if (input.assigneeUid !== undefined && input.assigneeUid !== (snap.get("assigneeUid") ?? "")) {
      if (input.assigneeUid) {
        const user = await db.collection(C.users).doc(input.assigneeUid).get();
        if (!user.exists || user.get("active") === false || user.get("invited")) throw fail.invalid("That person can't be assigned.");
        update.assigneeUid = input.assigneeUid;
        if (input.assigneeUid !== ctx.uid) notify = input.assigneeUid;
      } else update.assigneeUid = FieldValue.delete();
      before.assigneeUid = snap.get("assigneeUid") ?? null;
      after.assigneeUid = input.assigneeUid || null;
    }
    const notesChanged = input.notes !== undefined && input.notes !== (snap.get("notes") ?? "");
    if (notesChanged) update.notes = input.notes || FieldValue.delete();

    const batch = db.batch();
    batch.update(snap.ref, update);
    if (notify) {
      batch.create(db.collection(C.notifications).doc(), {
        userUid: notify,
        kind: "referral_assigned",
        message: `Referral ${snap.get("reference")} has been assigned to you.`,
        link: `/referrals/${snap.id}`,
        createdAt: Timestamp.now(),
      });
    }
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "referral",
      entityId: snap.id,
      op: "referrals.update",
      before: Object.keys(before).length ? before : undefined,
      after: Object.keys(after).length ? after : undefined,
      detail: notesChanged ? "Triage notes changed" : undefined,
    });
    await batch.commit();
    return referralOut(await snap.ref.get());
  },

  async "referrals.accept"(input, ctx) {
    const snap = await loadReferral(input.id);
    assertOpen(snap);
    const r = referralOut(snap);

    let clientId: string;
    let createdClient = false;
    if (input.existingClientId) {
      await clientFor(ctx, input.existingClientId, "activity");
      clientId = input.existingClientId;
    } else {
      if (!ctx.can("clients.create")) throw fail.denied("Accepting a referral as a new client needs permission to create clients.");
      const client = await clientHandlers["clients.create"]!(
        {
          firstName: r.firstName,
          lastName: r.lastName,
          addressLines: r.addressLine ? [r.addressLine] : [],
          town: r.town,
          postcode: r.postcode,
          phones: r.phone ? [{ label: "Main", number: r.phone }] : [],
          email: r.email,
          preferredContactMethod: r.preferredContactMethod,
          contacts:
            r.referrerType === "family_or_friend" && r.referrerName
              ? [
                  {
                    name: r.referrerName,
                    relationship: r.referrerRelationship || "Referrer",
                    phone: r.referrerPhone,
                    email: r.referrerEmail,
                    isNextOfKin: false,
                  },
                ]
              : [],
          helpCategoryIds: input.helpCategoryIds,
        },
        ctx,
      );
      clientId = client.id;
      createdClient = true;
    }
    await activityHandlers["notes.create"]!({ clientId, body: referralNote(r) }, ctx);

    const now = Timestamp.now();
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(snap.ref);
      assertOpen(fresh);
      tx.update(snap.ref, { status: "accepted", clientId, decidedAt: now, decidedBy: ctx.uid, pendingPurge: true, updatedAt: now });
    });
    const batch = db.batch();
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "referral",
      entityId: snap.id,
      clientIds: [clientId],
      op: "referrals.accept",
      before: { status: r.status },
      after: { status: "accepted", clientId },
      detail: createdClient ? "Accepted as a new client" : "Linked to an existing client",
    });
    await batch.commit();
    return { referral: referralOut(await snap.ref.get()), clientId, createdClient };
  },

  async "referrals.decline"(input, ctx) {
    const snap = await loadReferral(input.id);
    assertOpen(snap);
    const now = Timestamp.now();
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(snap.ref);
      assertOpen(fresh);
      tx.update(snap.ref, { status: "declined", declineReason: input.reason, decidedAt: now, decidedBy: ctx.uid, pendingPurge: true, updatedAt: now });
    });
    const batch = db.batch();
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "referral",
      entityId: snap.id,
      op: "referrals.decline",
      before: { status: snap.get("status") },
      after: { status: "declined" },
    });
    await batch.commit();
    return referralOut(await snap.ref.get());
  },

  async "integrationKeys.list"() {
    const snap = await db.collection(C.integrationKeys).get();
    return snap.docs.map((d) => keyOut(d.id, d.data())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async "integrationKeys.create"(input, ctx) {
    const secret = `${INTEGRATION_KEY_PREFIX}${randomToken(32)}`;
    const ref = db.collection(C.integrationKeys).doc(sha256(secret));
    const data = { name: input.name, source: input.source, hourlyLimit: input.hourlyLimit, createdAt: Timestamp.now(), createdBy: ctx.uid };
    const batch = db.batch();
    batch.create(ref, data);
    await auditInBatch(batch, ctx, { action: "token_created", entity: "integrationKey", entityId: ref.id.slice(0, 12), op: "integrationKeys.create", detail: input.name });
    await batch.commit();
    return { key: secret, summary: keyOut(ref.id, data) };
  },

  async "integrationKeys.revoke"(input, ctx) {
    const ref = db.collection(C.integrationKeys).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound("Key");
    if (snap.get("revokedAt")) return { ok: true };
    const batch = db.batch();
    batch.update(ref, { revokedAt: Timestamp.now() });
    await auditInBatch(batch, ctx, { action: "token_revoked", entity: "integrationKey", entityId: input.id.slice(0, 12), op: "integrationKeys.revoke", detail: snap.get("name") });
    await batch.commit();
    return { ok: true };
  },
};
