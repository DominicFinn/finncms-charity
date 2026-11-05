/**
 * Retention for referrals. A referral's personal details are removed a set
 * number of days (an organisation setting, 90 by default) after it is
 * accepted or declined. Accepted referrals have already been copied into the
 * client record by then. What stays is enough to count referrals: status,
 * source, referrer type, town, postcode district, help areas and dates.
 *
 * Referrals still waiting for a decision are never removed automatically, so
 * nobody is lost from the queue. When a client is anonymised, any referral
 * linked to them is anonymised at once.
 */
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { auditNow, SYSTEM_ACTOR, type Actor } from "../core/audit.js";
import { C, db } from "../core/firebase.js";

/** Fields that identify someone. Removed when a referral is anonymised. */
export const REFERRAL_PERSONAL_FIELDS = [
  "referrerName",
  "referrerRelationship",
  "referrerOrganisation",
  "referrerPhone",
  "referrerEmail",
  "firstName",
  "lastName",
  "addressLine",
  "postcode",
  "phone",
  "email",
  "helpNeeded",
  "heardAbout",
  "sourceUrl",
  "notes",
  "declineReason",
] as const;

/** Update that strips a referral's personal details, keeping what's needed for counts. */
export function referralAnonymisation(): Record<string, unknown> {
  const update: Record<string, unknown> = { anonymisedAt: Timestamp.now(), pendingPurge: false, updatedAt: Timestamp.now() };
  for (const f of REFERRAL_PERSONAL_FIELDS) update[f] = FieldValue.delete();
  return update;
}

/** Most referrals one run will anonymise. */
const MAX_PER_RUN = 500;

export async function purgeDecidedReferrals(retentionDays: number, now = new Date()): Promise<number> {
  const cutoff = Timestamp.fromMillis(now.getTime() - retentionDays * 86_400_000);
  const due = await db.collection(C.referrals).where("pendingPurge", "==", true).where("decidedAt", "<", cutoff).limit(MAX_PER_RUN).get();
  for (const d of due.docs) {
    await d.ref.update(referralAnonymisation());
    await auditNow(SYSTEM_ACTOR, { action: "anonymise", entity: "referral", entityId: d.id, op: "referrals.retention", detail: "Retention period passed" });
  }
  // Rate limit counters are only needed for the current hour.
  const oldUsage = await db
    .collection(C.integrationUsage)
    .where("hourStart", "<", Timestamp.fromMillis(now.getTime() - 2 * 86_400_000))
    .limit(500)
    .get();
  await Promise.all(oldUsage.docs.map((d) => d.ref.delete()));
  if (due.size) logger.info("Referral retention run complete", { anonymised: due.size });
  return due.size;
}

/** Anonymises referrals linked to a client that is being anonymised. */
export async function anonymiseReferralsForClient(clientId: string, actor: Actor): Promise<void> {
  const linked = await db.collection(C.referrals).where("clientId", "==", clientId).get();
  for (const d of linked.docs) {
    if (d.get("anonymisedAt")) continue;
    await d.ref.update(referralAnonymisation());
    await auditNow(actor, { action: "anonymise", entity: "referral", entityId: d.id, op: "clients.anonymise", detail: "Linked client anonymised" });
  }
}
