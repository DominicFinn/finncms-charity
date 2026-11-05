import type { Callback, Note, Outcome, Session } from "@ccm/shared";
import { FieldValue, Timestamp, type Query } from "firebase-admin/firestore";
import { auditInBatch, changedFields } from "../core/audit.js";
import type { Ctx } from "../core/context.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { fail } from "../core/errors.js";
import { C, db, docOut, fromIso, serialise } from "../core/firebase.js";
import { assertActiveUser, clientFor, clientNames, strip, touchActivity, who, type ClientDoc } from "./common.js";
import { assertCanSeeSet, loadQuestions, loadSet, validateAnswers } from "./questionnaires.js";

async function assertExists(collection: string, ids: string[], what: string) {
  if (ids.length === 0) return;
  const snaps = await db.getAll(...ids.map((id) => db.collection(collection).doc(id)));
  const missing = snaps.filter((s) => !s.exists).map((s) => s.id);
  if (missing.length) throw fail.invalid(`Unknown ${what}: ${missing.join(", ")}`);
}

/**
 * Checks a location choice. Returns the fields to store: the managed
 * location, plus the description only when it's the "Other" entry.
 */
async function resolveLocation(locationId: string | undefined, other: string | undefined, isNew: boolean) {
  if (!locationId) return { locationId: undefined, locationOther: undefined };
  const snap = await db.collection(C.sessionLocations).doc(locationId).get();
  if (!snap.exists || (isNew && snap.get("archived"))) throw fail.invalid("Unknown session location.");
  if (snap.get("isOther")) {
    if (!other?.trim()) throw fail.invalid("Describe the location when choosing Other.");
    return { locationId, locationOther: other.trim() };
  }
  return { locationId, locationOther: undefined };
}

async function sessionType(id: string) {
  const snap = await db.collection(C.sessionTypes).doc(id).get();
  if (!snap.exists) throw fail.invalid("Unknown session type.");
  return { inPerson: snap.get("inPerson") === true };
}

/** Reporting dimensions copied onto records when written, so reports don't need joins. */
function clientDims(client: ClientDoc) {
  return { town: client.town ?? null, postcodeDistrict: client.postcodeDistrict ?? null };
}

function sessionOut(ctx: Ctx, d: FirebaseFirestore.DocumentSnapshot): Session {
  ctx.touched.add(d.get("clientId"));
  return docOut<Session>(d);
}

async function belongsToClient(collection: string, id: string, clientId: string, what: string) {
  const snap = await db.collection(collection).doc(id).get();
  if (!snap.exists || snap.get("clientId") !== clientId) throw fail.invalid(`That ${what} doesn't belong to this client.`);
  return snap;
}

export const activityHandlers: HandlerGroup = {
  // Sessions

  async "sessions.list"(input, ctx) {
    if (!input.clientId && !input.staffUid) throw fail.invalid("Give a client or a staff member.");
    let q: Query = db.collection(C.sessions);
    if (input.clientId) q = q.where("clientId", "==", input.clientId);
    if (input.staffUid) q = q.where("staffUid", "==", who(ctx, input.staffUid));
    if (input.status) q = q.where("status", "==", input.status);
    if (input.from) q = q.where("startsAt", ">=", fromIso(input.from));
    if (input.to) q = q.where("startsAt", "<", fromIso(input.to));
    q = q.orderBy("startsAt", input.clientId ? "desc" : "asc").limit(input.limit);
    const snap = await q.get();
    const sessions = snap.docs.map((d) => sessionOut(ctx, d));
    if (input.clientId) return sessions;
    const names = await clientNames(ctx, sessions.map((s) => s.clientId));
    return sessions.map((s) => ({ ...s, clientName: names.get(s.clientId) }));
  },

  async "sessions.create"(input, ctx) {
    const { client } = await clientFor(ctx, input.clientId, "activity");
    const type = await sessionType(input.typeId);
    const staffUid = input.staffUid ?? ctx.uid;
    if (staffUid !== ctx.uid) await assertActiveUser(staffUid);
    await assertExists(C.helpCategories, input.helpCategoryIds, "help categories");
    const ref = db.collection(C.sessions).doc();
    const location = type.inPerson ? await resolveLocation(input.locationId, input.locationOther, true) : { locationId: undefined, locationOther: undefined };
    const data = strip({
      clientId: input.clientId,
      typeId: input.typeId,
      startsAt: fromIso(input.startsAt),
      durationMinutes: input.durationMinutes,
      staffUid,
      helpCategoryIds: input.helpCategoryIds,
      notes: input.notes,
      locationId: location.locationId,
      locationOther: location.locationOther,
      status: input.status,
      createdAt: Timestamp.now(),
      createdBy: ctx.uid,
      dims: { ...clientDims(client), locationId: location.locationId ?? null },
    });
    const batch = db.batch();
    batch.create(ref, data);
    touchActivity(batch, input.clientId);
    await auditInBatch(batch, ctx, {
      action: "create",
      entity: "session",
      entityId: ref.id,
      clientIds: [input.clientId],
      op: "sessions.create",
      after: serialise({ ...data, dims: undefined }),
    });
    await batch.commit();
    return serialise<Session>({ id: ref.id, ...data, dims: undefined });
  },

  async "sessions.update"(input, ctx) {
    const ref = db.collection(C.sessions).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound("Session");
    const clientId = snap.get("clientId") as string;
    await clientFor(ctx, clientId, "activity");
    const p = input.patch;
    const typeId = p.typeId ?? (snap.get("typeId") as string);
    const type = await sessionType(typeId);
    if (p.staffUid && p.staffUid !== snap.get("staffUid")) await assertActiveUser(p.staffUid);
    if (p.helpCategoryIds) await assertExists(C.helpCategories, p.helpCategoryIds, "help categories");
    const update: Record<string, unknown> = strip({
      ...p,
      startsAt: p.startsAt ? fromIso(p.startsAt) : undefined,
      locationId: undefined,
      locationOther: undefined,
    });
    // An empty string clears notes. Location is worked out again whenever the
    // type or the location changes, and cleared for sessions not in person.
    if (p.notes === "") update.notes = FieldValue.delete();
    if ("locationId" in p || "locationOther" in p || "typeId" in p) {
      const wantedId = "locationId" in p ? p.locationId || undefined : (snap.get("locationId") as string | undefined);
      const wantedOther = "locationOther" in p ? p.locationOther || undefined : (snap.get("locationOther") as string | undefined);
      const loc = type.inPerson ? await resolveLocation(wantedId, wantedOther, wantedId !== snap.get("locationId")) : { locationId: undefined, locationOther: undefined };
      update.locationId = loc.locationId ?? FieldValue.delete();
      update.locationOther = loc.locationOther ?? FieldValue.delete();
      update["dims.locationId"] = loc.locationId ?? null;
    }
    const before = serialise<Record<string, unknown>>(snap.data());
    const batch = db.batch();
    batch.update(ref, update);
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "session",
      entityId: input.id,
      clientIds: [clientId],
      op: "sessions.update",
      ...changedFields(
        Object.fromEntries(Object.keys(p).map((k) => [k, before[k]])),
        serialise(p),
      ),
    });
    await batch.commit();
    return sessionOut(ctx, await ref.get());
  },

  // Callbacks

  async "callbacks.list"(input, ctx) {
    if (!input.clientId && !input.assigneeUid) throw fail.invalid("Give a client or an assignee.");
    let q: Query = db.collection(C.callbacks);
    if (input.clientId) q = q.where("clientId", "==", input.clientId);
    if (input.assigneeUid) q = q.where("assigneeUid", "==", who(ctx, input.assigneeUid));
    if (input.status) q = q.where("status", "==", input.status);
    if (input.dueBefore) q = q.where("dueAt", "<", fromIso(input.dueBefore));
    const snap = await q.orderBy("dueAt", "asc").limit(input.limit).get();
    const callbacks = snap.docs.map((d) => {
      ctx.touched.add(d.get("clientId"));
      return docOut<Callback>(d);
    });
    if (input.clientId) return callbacks;
    const names = await clientNames(ctx, callbacks.map((c) => c.clientId));
    return callbacks.map((c) => ({ ...c, clientName: names.get(c.clientId) }));
  },

  async "callbacks.create"(input, ctx) {
    await clientFor(ctx, input.clientId, "contact");
    const assigneeUid = input.assigneeUid ?? ctx.uid;
    if (assigneeUid !== ctx.uid) await assertActiveUser(assigneeUid);
    const ref = db.collection(C.callbacks).doc();
    const data = {
      clientId: input.clientId,
      assigneeUid,
      dueAt: fromIso(input.dueAt),
      reason: input.reason,
      status: "open" as const,
      createdAt: Timestamp.now(),
      createdBy: ctx.uid,
    };
    const batch = db.batch();
    batch.create(ref, data);
    touchActivity(batch, input.clientId);
    await auditInBatch(batch, ctx, {
      action: "create",
      entity: "callback",
      entityId: ref.id,
      clientIds: [input.clientId],
      op: "callbacks.create",
      after: serialise(data),
    });
    await batch.commit();
    return serialise<Callback>({ id: ref.id, ...data });
  },

  async "callbacks.update"(input, ctx) {
    const ref = db.collection(C.callbacks).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound("Callback");
    const clientId = snap.get("clientId") as string;
    const p = input.patch;
    // Closing a callback is always allowed; anything that keeps it live needs consent to contact.
    const closing = p.status === "done" || p.status === "cancelled";
    await clientFor(ctx, clientId, closing && Object.keys(p).length === 1 ? "edit" : "contact");
    if (p.assigneeUid && p.assigneeUid !== snap.get("assigneeUid")) await assertActiveUser(p.assigneeUid);
    const update: Record<string, unknown> = strip({ ...p, dueAt: p.dueAt ? fromIso(p.dueAt) : undefined });
    if (p.status === "done") update.completedAt = Timestamp.now();
    if (p.status === "open") update.completedAt = FieldValue.delete();
    if (p.dueAt) {
      update.reminderSentAt = FieldValue.delete();
      update.overdueNotifiedAt = FieldValue.delete();
    }
    const before = serialise<Record<string, unknown>>(snap.data());
    const batch = db.batch();
    batch.update(ref, update);
    if (p.status === "done") touchActivity(batch, clientId);
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "callback",
      entityId: input.id,
      clientIds: [clientId],
      op: "callbacks.update",
      ...changedFields(Object.fromEntries(Object.keys(p).map((k) => [k, before[k]])), serialise(p)),
    });
    await batch.commit();
    const after = await ref.get();
    ctx.touched.add(clientId);
    return docOut<Callback>(after);
  },

  // Notes

  async "notes.list"(input, ctx) {
    await clientFor(ctx, input.clientId, "read");
    const snap = await db
      .collection(C.notes)
      .where("clientId", "==", input.clientId)
      .orderBy("createdAt", "desc")
      .limit(input.limit)
      .get();
    return snap.docs.map((d) => docOut<Note>(d));
  },

  async "notes.create"(input, ctx) {
    await clientFor(ctx, input.clientId, "activity");
    if (input.linkedTo) {
      const col = { session: C.sessions, callback: C.callbacks, outcome: C.outcomes }[input.linkedTo.kind];
      await belongsToClient(col, input.linkedTo.id, input.clientId, input.linkedTo.kind);
    }
    const ref = db.collection(C.notes).doc();
    const data = strip({ clientId: input.clientId, body: input.body, linkedTo: input.linkedTo, createdAt: Timestamp.now(), createdBy: ctx.uid });
    const batch = db.batch();
    batch.create(ref, data);
    touchActivity(batch, input.clientId);
    await auditInBatch(batch, ctx, { action: "create", entity: "note", entityId: ref.id, clientIds: [input.clientId], op: "notes.create", after: serialise(data) });
    await batch.commit();
    return serialise<Note>({ id: ref.id, ...data });
  },

  async "notes.update"(input, ctx) {
    const ref = db.collection(C.notes).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound("Note");
    const clientId = snap.get("clientId") as string;
    await clientFor(ctx, clientId, "edit");
    const batch = db.batch();
    batch.update(ref, { body: input.body, updatedAt: Timestamp.now() });
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "note",
      entityId: input.id,
      clientIds: [clientId],
      op: "notes.update",
      before: { body: snap.get("body") },
      after: { body: input.body },
    });
    await batch.commit();
    return docOut<Note>(await ref.get());
  },

  // Outcomes

  async "outcomes.list"(input, ctx) {
    await clientFor(ctx, input.clientId, "read");
    const snap = await db.collection(C.outcomes).where("clientId", "==", input.clientId).orderBy("recordedAt", "desc").get();
    const outcomes = snap.docs.map((d) => docOut<Outcome>(d));
    if (ctx.can("questionnaires.viewSensitive")) return outcomes;
    const sets = await db.collection(C.questionSets).where("sensitive", "==", true).get();
    const hidden = new Set(sets.docs.map((d) => d.id));
    return outcomes.filter((o) => !hidden.has(o.setId));
  },

  async "outcomes.record"(input, ctx) {
    const set = await loadSet(input.setId);
    if (set.kind !== "outcome") throw fail.invalid("That question set is not an outcome measure.");
    assertCanSeeSet(ctx, set);
    const { client } = await clientFor(ctx, input.clientId, set.sensitive ? "sensitive" : "activity");
    await assertExists(C.helpCategories, [input.helpCategoryId], "help category");
    let sessionDims: Record<string, unknown> = { locationId: null, sessionTypeId: null, staffUid: ctx.uid };
    if (input.sessionId) {
      const s = await belongsToClient(C.sessions, input.sessionId, input.clientId, "session");
      sessionDims = { locationId: s.get("locationId") ?? null, sessionTypeId: s.get("typeId"), staffUid: s.get("staffUid") };
    }
    const answers = validateAnswers(set, await loadQuestions(set.questionIds), input.answers);
    const ref = db.collection(C.outcomes).doc();
    const data = strip({
      clientId: input.clientId,
      setId: input.setId,
      helpCategoryId: input.helpCategoryId,
      sessionId: input.sessionId,
      perspective: input.perspective,
      answers,
      recordedAt: Timestamp.now(),
      recordedBy: ctx.uid,
      dims: { ...clientDims(client), ...sessionDims },
    });
    const batch = db.batch();
    batch.create(ref, data);
    touchActivity(batch, input.clientId);
    await auditInBatch(batch, ctx, {
      action: "create",
      entity: "outcome",
      entityId: ref.id,
      clientIds: [input.clientId],
      op: "outcomes.record",
      after: serialise({ ...data, dims: undefined }),
    });
    await batch.commit();
    return serialise<Outcome>({ id: ref.id, ...data, dims: undefined });
  },
};
