/**
 * Anonymises a client. Used for right to erasure requests and by the daily
 * retention job.
 *
 * Removed: all personal details, contacts, questionnaire answers, notes,
 * files, consent records, free text outcome answers, session notes and
 * "Other" location descriptions, callback reasons and safeguarding
 * descriptions.
 *
 * Kept for impact reporting: outcome results (non free text), help
 * categories, session and callback counts, types, statuses and managed
 * locations, dates at month level, and postcode district.
 *
 * The client's data key is deleted, which makes the before and after values
 * in earlier audit entries unreadable. The audit entries themselves stay.
 */
import type { Channel } from "@ccm/shared";
import { FieldValue, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { auditNow, type Actor } from "../core/audit.js";
import { shredClientKey } from "../core/crypto.js";
import { fail } from "../core/errors.js";
import { bucket, C, db } from "../core/firebase.js";

export type AnonymiseBasis = "erasure_request" | "no_longer_needed" | "retention_period";

const BASIS_TEXT: Record<AnonymiseBasis, string> = {
  erasure_request: "Right to erasure request",
  no_longer_needed: "Data no longer needed",
  retention_period: "Retention period passed",
};

export function monthStart(v: unknown): Timestamp | null {
  if (!(v instanceof Timestamp)) return null;
  const d = v.toDate();
  return Timestamp.fromDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

/** Question ids whose answers could identify someone: free text and dates. */
async function freeTextQuestionIds(): Promise<Set<string>> {
  const q = await db.collection(C.questions).where("type", "in", ["text", "date"]).get();
  return new Set(q.docs.map((d) => d.id));
}

export async function anonymiseClient(clientId: string, actor: Actor & { channel: Channel }, basis: AnonymiseBasis): Promise<void> {
  const clientRef = db.collection(C.clients).doc(clientId);
  const snap = await clientRef.get();
  if (!snap.exists) throw fail.notFound("Client");
  if (snap.get("status") === "anonymised") return;

  const openConcerns = await db
    .collection(C.safeguarding)
    .where("clientId", "==", clientId)
    .where("status", "in", ["open", "under_review", "escalated"])
    .limit(1)
    .get();
  if (!openConcerns.empty) {
    throw fail.precondition("This client has an open safeguarding concern. Close it before anonymising.");
  }

  const byClient = (col: string) => db.collection(col).where("clientId", "==", clientId).get();
  const [answers, sessions, callbacks, notes, files, outcomes, consents, concerns, freeText] = await Promise.all([
    byClient(C.answers),
    byClient(C.sessions),
    byClient(C.callbacks),
    byClient(C.notes),
    byClient(C.files),
    byClient(C.outcomes),
    byClient(C.consents),
    byClient(C.safeguarding),
    freeTextQuestionIds(),
  ]);

  // Every write is awaited, and the client record is marked anonymised only
  // after everything else has succeeded. If anything fails, the client keeps
  // its old status and the next attempt (or the next retention run) redoes
  // the whole thing, which is safe to repeat.
  const writer = db.bulkWriter();
  const errors: unknown[] = [];
  const track = (p: Promise<unknown>) => void p.catch((err) => errors.push(err));
  const del = (ref: DocumentReference) => track(writer.delete(ref));
  const put = (ref: DocumentReference, data: Record<string, unknown>) => track(writer.set(ref, data));

  answers.docs.forEach((d) => del(d.ref));
  notes.docs.forEach((d) => del(d.ref));
  consents.docs.forEach((d) => del(d.ref));

  // Removes every stored file for the client, including any upload that
  // finished without a file record.
  await bucket().deleteFiles({ prefix: `clients/${clientId}/` });
  files.docs.forEach((d) => del(d.ref));

  for (const d of sessions.docs) {
    put(d.ref, {
      clientId,
      typeId: d.get("typeId"),
      status: d.get("status") === "scheduled" ? "cancelled" : d.get("status"),
      durationMinutes: d.get("durationMinutes"),
      helpCategoryIds: d.get("helpCategoryIds") ?? [],
      staffUid: d.get("staffUid"),
      locationId: d.get("locationId") ?? null,
      startsAt: monthStart(d.get("startsAt")),
      createdAt: monthStart(d.get("createdAt")),
      dims: { postcodeDistrict: d.get("dims.postcodeDistrict") ?? null, locationId: d.get("locationId") ?? null },
      calendarSync: d.get("calendarSync") ?? null,
      anonymised: true,
    });
  }

  for (const d of callbacks.docs) {
    put(d.ref, {
      clientId,
      assigneeUid: d.get("assigneeUid"),
      status: d.get("status") === "open" ? "cancelled" : d.get("status"),
      dueAt: monthStart(d.get("dueAt")),
      completedAt: monthStart(d.get("completedAt")),
      createdAt: monthStart(d.get("createdAt")),
      reason: "",
      calendarSync: d.get("calendarSync") ?? null,
      anonymised: true,
    });
  }

  for (const d of outcomes.docs) {
    const kept: Record<string, unknown> = {};
    for (const [qid, value] of Object.entries((d.get("answers") as Record<string, unknown>) ?? {})) {
      if (!freeText.has(qid)) kept[qid] = value;
    }
    put(d.ref, {
      clientId,
      setId: d.get("setId"),
      helpCategoryId: d.get("helpCategoryId"),
      sessionId: d.get("sessionId") ?? null,
      perspective: d.get("perspective"),
      answers: kept,
      recordedAt: monthStart(d.get("recordedAt")),
      dims: {
        postcodeDistrict: d.get("dims.postcodeDistrict") ?? null,
        locationId: d.get("dims.locationId") ?? null,
        sessionTypeId: d.get("dims.sessionTypeId") ?? null,
        staffUid: d.get("dims.staffUid") ?? null,
      },
      anonymised: true,
    });
  }

  for (const d of concerns.docs) {
    put(d.ref, {
      clientId,
      severity: d.get("severity"),
      status: d.get("status"),
      raisedAt: monthStart(d.get("raisedAt")),
      description: "",
      history: [],
      anonymised: true,
    });
  }

  await writer.close();
  if (errors.length) throw new Error(`Anonymisation of ${clientId} incomplete: ${errors.length} writes failed`);
  await shredClientKey(clientId);
  await clientRef.set({
    status: "anonymised",
    anonymisedAt: monthStart(Timestamp.now()),
    firstName: "",
    lastName: "",
    sortName: "~",
    searchTokens: [],
    postcodeDistrict: snap.get("postcodeDistrict") ?? null,
    helpCategoryIds: snap.get("helpCategoryIds") ?? [],
    questionSetIds: [],
    restrictions: [],
    openSafeguardingConcerns: 0,
    flagged: false,
    createdAt: monthStart(snap.get("createdAt")),
    lastActivityAt: monthStart(snap.get("lastActivityAt")),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await auditNow(actor, {
    action: "anonymise",
    entity: "client",
    entityId: clientId,
    clientIds: [clientId],
    op: "clients.anonymise",
    detail: BASIS_TEXT[basis],
  });
}
