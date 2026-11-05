import { RESTRICTION_FOR_PURPOSE, type ConsentPurpose, type ConsentRecord, type ConsentRestriction } from "@ccm/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { auditInBatch } from "../core/audit.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { fail } from "../core/errors.js";
import { C, db, docOut, fromIso, serialise } from "../core/firebase.js";
import { clientFor, strip } from "./common.js";

/**
 * A restriction applies when the most recent consent record for a purpose
 * has been withdrawn. A client with no record for a purpose has no
 * restriction, because consent is not always the lawful basis being used.
 */
export function restrictionsFrom(records: { purpose: ConsentPurpose; givenAt: Timestamp; withdrawnAt?: Timestamp }[]): ConsentRestriction[] {
  const latest = new Map<ConsentPurpose, (typeof records)[number]>();
  for (const r of records) {
    const current = latest.get(r.purpose);
    if (!current || r.givenAt.toMillis() > current.givenAt.toMillis()) latest.set(r.purpose, r);
  }
  return [...latest.values()].filter((r) => r.withdrawnAt).map((r) => RESTRICTION_FOR_PURPOSE[r.purpose]).sort();
}

async function recomputeRestrictions(clientId: string, change?: { id: string; data: Record<string, unknown> }) {
  const snap = await db.collection(C.consents).where("clientId", "==", clientId).get();
  const records = snap.docs.filter((d) => d.id !== change?.id).map((d) => d.data());
  if (change) records.push(change.data);
  return restrictionsFrom(records as Parameters<typeof restrictionsFrom>[0]);
}

export const consentHandlers: HandlerGroup = {
  async "consents.list"(input, ctx) {
    await clientFor(ctx, input.clientId, "read");
    const snap = await db.collection(C.consents).where("clientId", "==", input.clientId).orderBy("givenAt", "desc").get();
    return snap.docs.map((d) => docOut<ConsentRecord>(d));
  },

  async "consents.record"(input, ctx) {
    const { snap: clientSnap } = await clientFor(ctx, input.clientId, "edit");
    const ref = db.collection(C.consents).doc();
    const data = strip({
      clientId: input.clientId,
      purpose: input.purpose,
      method: input.method,
      givenAt: fromIso(input.givenAt),
      recordedBy: ctx.uid,
      notes: input.notes,
    });
    const restrictions = await recomputeRestrictions(input.clientId, { id: ref.id, data });
    const batch = db.batch();
    batch.create(ref, data);
    batch.update(clientSnap.ref, {
      restrictions,
      status: restrictions.includes("no_processing") ? "restricted" : "active",
      updatedAt: FieldValue.serverTimestamp(),
    });
    await auditInBatch(batch, ctx, {
      action: "create",
      entity: "consent",
      entityId: ref.id,
      clientIds: [input.clientId],
      op: "consents.record",
      after: { ...serialise<Record<string, unknown>>(data), restrictions },
    });
    await batch.commit();
    return serialise<ConsentRecord>({ id: ref.id, ...data });
  },

  async "consents.withdraw"(input, ctx) {
    const ref = db.collection(C.consents).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound("Consent record");
    if (snap.get("withdrawnAt")) throw fail.precondition("This consent has already been withdrawn.");
    const clientId = snap.get("clientId") as string;
    const { snap: clientSnap } = await clientFor(ctx, clientId, "edit");
    const patch = strip({ withdrawnAt: Timestamp.now(), withdrawnBy: ctx.uid, withdrawalNotes: input.notes });
    const restrictions = await recomputeRestrictions(clientId, { id: ref.id, data: { ...snap.data(), ...patch } });
    const batch = db.batch();
    batch.update(ref, patch);
    batch.update(clientSnap.ref, {
      restrictions,
      status: restrictions.includes("no_processing") ? "restricted" : "active",
      updatedAt: FieldValue.serverTimestamp(),
    });
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "consent",
      entityId: input.id,
      clientIds: [clientId],
      op: "consents.withdraw",
      after: { ...serialise<Record<string, unknown>>(patch), restrictions },
    });
    await batch.commit();
    return docOut<ConsentRecord>(await ref.get());
  },
};
