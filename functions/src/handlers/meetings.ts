/**
 * Trust meetings: trustees, meetings with agendas and minutes, registers,
 * actions that carry forward until done, and meeting papers.
 *
 * None of this is client data, so audit diffs are stored unsealed and no
 * client ids are recorded. Approved minutes are locked; reopening them is a
 * deliberate, audited step.
 */
import {
  londonDate,
  quorumFor,
  servingOn,
  type AgendaItem,
  type Meeting,
  type MeetingAction,
  type MeetingAttendance,
  type MeetingPaper,
  type Trustee,
} from "@ccm/shared";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { auditInBatch, changedFields } from "../core/audit.js";
import type { Ctx } from "../core/context.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { fail } from "../core/errors.js";
import { bucket, C, db, docOut, fromIso, isEmulator, newId, serialise } from "../core/firebase.js";
import { assertActiveUser, strip } from "./common.js";
import { ALLOWED_TYPES, DOWNLOAD_MINUTES, MAX_UPLOAD_BYTES, signedDownloadUrl, signedUploadUrl } from "./files.js";

const today = () => londonDate(new Date().toISOString());

/** Optional fields where "" means clear. Returns the value to store on create. */
function blankToUndefined<T>(v: T | "" | undefined): T | undefined {
  return v === "" ? undefined : v;
}

/** Turns a patch into a Firestore update, deleting fields set to "". */
function toUpdate(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = v === "" ? FieldValue.delete() : v;
  }
  return out;
}

function normaliseAgenda(items: (Omit<AgendaItem, "id"> & { id?: string })[]): AgendaItem[] {
  const seen = new Set<string>();
  return items.map((item) => {
    let itemId = item.id;
    if (!itemId || seen.has(itemId)) itemId = newId(C.meetings);
    seen.add(itemId);
    return strip({ ...item, id: itemId }) as AgendaItem;
  });
}

async function loadMeeting(id: string): Promise<{ snap: DocumentSnapshot; meeting: Meeting }> {
  const snap = await db.collection(C.meetings).doc(id).get();
  if (!snap.exists) throw fail.notFound("Meeting");
  return { snap, meeting: docOut<Meeting>(snap) };
}

function assertDraft(meeting: Meeting) {
  if (meeting.status === "approved") {
    throw fail.precondition("These minutes have been approved and are locked. Reopen them to make a correction.");
  }
}

function assertTimes(startsAt: string, endsAt: string | undefined) {
  if (endsAt && new Date(endsAt) <= new Date(startsAt)) throw fail.invalid("The meeting must end after it starts.");
}

async function assertTrustees(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;
  const snaps = await db.getAll(...unique.map((t) => db.collection(C.trustees).doc(t)));
  if (snaps.some((s) => !s.exists)) throw fail.invalid("Unknown trustee.");
}

async function assertUsersExist(uids: string[]) {
  const unique = [...new Set(uids)];
  if (unique.length === 0) return;
  const snaps = await db.getAll(...unique.map((u) => db.collection(C.users).doc(u)));
  if (snaps.some((s) => !s.exists || s.get("invited") === true)) throw fail.invalid("Unknown staff member.");
}

async function allTrustees(): Promise<Trustee[]> {
  const snap = await db.collection(C.trustees).get();
  return snap.docs.map((d) => docOut<Trustee>(d)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Trustee ids linked to the caller's account, for "my actions". */
async function myTrusteeIds(ctx: Ctx): Promise<Set<string>> {
  const snap = await db.collection(C.trustees).where("userUid", "==", ctx.uid).get();
  return new Set(snap.docs.map((d) => d.id));
}

function sortActions(actions: MeetingAction[]): MeetingAction[] {
  return [...actions].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    const ad = a.dueDate ?? "9999-12-31";
    const bd = b.dueDate ?? "9999-12-31";
    if (ad !== bd) return ad.localeCompare(bd);
    return a.createdAt.localeCompare(b.createdAt);
  });
}

async function checkActionOwner(ownerTrusteeId: string | undefined, ownerUid: string | undefined) {
  if (ownerTrusteeId) await assertTrustees([ownerTrusteeId]);
  if (ownerUid) await assertActiveUser(ownerUid);
}

export const meetingHandlers: HandlerGroup = {
  // Trustees

  async "trustees.list"(input) {
    const day = today();
    const all = await allTrustees();
    return input.includeInactive ? all : all.filter((t) => servingOn(t, day) || (t.startDate && t.startDate > day && t.active));
  },

  async "trustees.upsert"(input, ctx) {
    const startDate = blankToUndefined(input.startDate);
    const endDate = blankToUndefined(input.endDate);
    if (startDate && endDate && endDate < startDate) throw fail.invalid("The end date must be after the start date.");
    const userUid = blankToUndefined(input.userUid);
    const now = Timestamp.now();
    const batch = db.batch();

    if (!input.id) {
      if (userUid) await assertActiveUser(userUid);
      const ref = db.collection(C.trustees).doc();
      const data = strip({
        name: input.name,
        role: input.role,
        email: blankToUndefined(input.email),
        startDate,
        endDate,
        active: input.active,
        userUid,
        createdAt: now,
      });
      batch.create(ref, data);
      await auditInBatch(batch, ctx, { action: "create", entity: "trustee", entityId: ref.id, op: "trustees.upsert", after: serialise(data) });
      await batch.commit();
      return serialise<Trustee>({ id: ref.id, ...data });
    }

    const ref = db.collection(C.trustees).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound("Trustee");
    if (userUid && userUid !== snap.get("userUid")) await assertActiveUser(userUid);
    const patch = {
      name: input.name,
      role: input.role,
      email: input.email ?? "",
      startDate: input.startDate ?? "",
      endDate: input.endDate ?? "",
      active: input.active,
      userUid: input.userUid ?? "",
    };
    const before = serialise<Record<string, unknown>>(snap.data());
    batch.update(ref, { ...toUpdate(patch), updatedAt: now });
    const after = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === "" ? undefined : v]));
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "trustee",
      entityId: input.id,
      op: "trustees.upsert",
      ...changedFields(Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])), after),
    });
    await batch.commit();
    return docOut<Trustee>(await ref.get());
  },

  // Meetings

  async "meetings.list"(input) {
    let q = db.collection(C.meetings).orderBy("startsAt", "asc");
    if (input.from) q = q.where("startsAt", ">=", fromIso(input.from));
    if (input.to) q = q.where("startsAt", "<", fromIso(input.to));
    const snap = await q.limit(input.limit).get();
    return snap.docs.map((d) => docOut<Meeting>(d));
  },

  async "meetings.get"(input, ctx) {
    const { meeting } = await loadMeeting(input.id);
    const [trustees, raisedHere, open, doneHere, papers, approvedAt] = await Promise.all([
      allTrustees(),
      db.collection(C.meetingActions).where("meetingId", "==", input.id).get(),
      db.collection(C.meetingActions).where("status", "==", "open").get(),
      db.collection(C.meetingActions).where("completedAtMeetingId", "==", input.id).get(),
      db.collection(C.meetingPapers).where("meetingId", "==", input.id).get(),
      meeting.approvedAtMeetingId ? db.collection(C.meetings).doc(meeting.approvedAtMeetingId).get() : null,
    ]);
    const day = londonDate(meeting.startsAt);
    const recorded = new Set(meeting.attendance.map((a) => a.trusteeId));
    const startsAt = new Date(meeting.startsAt).getTime();
    const actions = raisedHere.docs.map((d) => docOut<MeetingAction>(d));
    const carriedForward = open.docs
      .map((d) => docOut<MeetingAction>(d))
      .filter((a) => a.meetingId !== input.id && new Date(a.raisedAt).getTime() < startsAt);
    const completedHere = doneHere.docs.map((d) => docOut<MeetingAction>(d)).filter((a) => a.meetingId !== input.id);
    return {
      meeting,
      quorum: quorumFor(trustees, meeting.attendance, day, ctx.org),
      trustees: trustees.filter((t) => servingOn(t, day) || recorded.has(t.id)),
      actions: sortActions(actions),
      carriedForward: sortActions(carriedForward),
      completedHere: sortActions(completedHere),
      papers: papers.docs
        .filter((d) => d.get("status") === "ready")
        .map((d) => docOut<MeetingPaper>(d, ["storagePath"]))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      approvedAtMeeting: approvedAt?.exists
        ? { id: approvedAt.id, title: approvedAt.get("title") as string, startsAt: serialise<string>(approvedAt.get("startsAt")) }
        : undefined,
    };
  },

  async "meetings.create"(input, ctx) {
    const endsAt = blankToUndefined(input.endsAt);
    assertTimes(input.startsAt, endsAt);
    const ref = db.collection(C.meetings).doc();
    const data = strip({
      title: input.title,
      type: input.type,
      startsAt: fromIso(input.startsAt),
      endsAt: fromIso(endsAt),
      location: input.location || undefined,
      onlineLink: blankToUndefined(input.onlineLink),
      agenda: normaliseAgenda(input.agenda),
      generalMinutes: input.generalMinutes || undefined,
      attendance: [] as MeetingAttendance[],
      guests: [],
      staffUids: [],
      status: "draft" as const,
      createdAt: Timestamp.now(),
      createdBy: ctx.uid,
    });
    const batch = db.batch();
    batch.create(ref, data);
    await auditInBatch(batch, ctx, { action: "create", entity: "meeting", entityId: ref.id, op: "meetings.create", after: serialise(data) });
    await batch.commit();
    return serialise<Meeting>({ id: ref.id, ...data });
  },

  async "meetings.update"(input, ctx) {
    const { snap, meeting } = await loadMeeting(input.id);
    assertDraft(meeting);
    const p = input.patch;
    const startsAt = p.startsAt ?? meeting.startsAt;
    const endsAt = p.endsAt === undefined ? meeting.endsAt : blankToUndefined(p.endsAt);
    assertTimes(startsAt, endsAt);

    const update: Record<string, unknown> = toUpdate({
      title: p.title,
      type: p.type,
      location: p.location,
      onlineLink: p.onlineLink,
      generalMinutes: p.generalMinutes,
    });
    if (p.startsAt) update.startsAt = fromIso(p.startsAt);
    if (p.endsAt !== undefined) update.endsAt = p.endsAt === "" ? FieldValue.delete() : fromIso(p.endsAt);
    if (p.agenda) update.agenda = normaliseAgenda(p.agenda);
    update.updatedAt = Timestamp.now();

    const batch = db.batch();
    batch.update(snap.ref, update);
    // Actions remember when they were raised, so keep that in step with the meeting.
    if (p.startsAt && p.startsAt !== meeting.startsAt) {
      const raised = await db.collection(C.meetingActions).where("meetingId", "==", input.id).get();
      for (const d of raised.docs) batch.update(d.ref, { raisedAt: fromIso(p.startsAt) });
    }
    const before = serialise<Record<string, unknown>>(snap.data());
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "meeting",
      entityId: input.id,
      op: "meetings.update",
      ...changedFields(Object.fromEntries(Object.keys(p).map((k) => [k, before[k]])), serialise(p)),
    });
    await batch.commit();
    return docOut<Meeting>(await snap.ref.get());
  },

  async "meetings.setRegister"(input, ctx) {
    const { snap, meeting } = await loadMeeting(input.id);
    assertDraft(meeting);
    // One entry per trustee; the last one given wins.
    const byTrustee = new Map(input.attendance.map((a) => [a.trusteeId, a.status]));
    const attendance = [...byTrustee].map(([trusteeId, status]) => ({ trusteeId, status }));
    const staffUids = [...new Set(input.staffUids)];
    await assertTrustees(attendance.map((a) => a.trusteeId));
    await assertUsersExist(staffUids);
    const guests = input.guests.map((g) => strip({ name: g.name, organisation: g.organisation || undefined }));

    const batch = db.batch();
    batch.update(snap.ref, { attendance, guests, staffUids, updatedAt: Timestamp.now() });
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "meeting",
      entityId: input.id,
      op: "meetings.setRegister",
      ...changedFields(
        { attendance: meeting.attendance, guests: meeting.guests, staffUids: meeting.staffUids },
        { attendance, guests, staffUids },
      ),
    });
    await batch.commit();
    return docOut<Meeting>(await snap.ref.get());
  },

  async "meetings.approveMinutes"(input, ctx) {
    const { snap, meeting } = await loadMeeting(input.id);
    if (meeting.status === "approved") throw fail.precondition("These minutes are already approved.");
    if (input.atMeetingId) {
      if (input.atMeetingId === input.id) throw fail.invalid("Minutes are approved at a later meeting, not the same one.");
      const { meeting: later } = await loadMeeting(input.atMeetingId);
      if (new Date(later.startsAt) <= new Date(meeting.startsAt)) throw fail.invalid("Choose a meeting after this one.");
    }
    const update = strip({ status: "approved" as const, approvedAt: Timestamp.now(), approvedBy: ctx.uid, approvedAtMeetingId: input.atMeetingId });
    const batch = db.batch();
    batch.update(snap.ref, update);
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "meeting",
      entityId: input.id,
      op: "meetings.approveMinutes",
      before: { status: "draft" },
      after: serialise(update),
    });
    await batch.commit();
    return docOut<Meeting>(await snap.ref.get());
  },

  async "meetings.reopenMinutes"(input, ctx) {
    const { snap, meeting } = await loadMeeting(input.id);
    if (meeting.status !== "approved") throw fail.precondition("These minutes are still in draft.");
    const batch = db.batch();
    batch.update(snap.ref, {
      status: "draft",
      approvedAt: FieldValue.delete(),
      approvedBy: FieldValue.delete(),
      approvedAtMeetingId: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    });
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "meeting",
      entityId: input.id,
      op: "meetings.reopenMinutes",
      before: { status: "approved", approvedAt: meeting.approvedAt, approvedBy: meeting.approvedBy, approvedAtMeetingId: meeting.approvedAtMeetingId ?? null },
      after: { status: "draft", reason: input.reason },
    });
    await batch.commit();
    return docOut<Meeting>(await snap.ref.get());
  },

  // Actions

  async "meetingActions.list"(input, ctx) {
    // Trust actions number in the hundreds at most, so filter in memory
    // rather than keep a composite index for every combination.
    let q: FirebaseFirestore.Query = db.collection(C.meetingActions);
    if (input.meetingId) q = q.where("meetingId", "==", input.meetingId);
    else if (input.status) q = q.where("status", "==", input.status);
    const snap = await q.limit(2000).get();
    let actions = snap.docs.map((d) => docOut<MeetingAction>(d));
    if (input.status) actions = actions.filter((a) => a.status === input.status);
    if (input.mine) {
      const mine = await myTrusteeIds(ctx);
      actions = actions.filter((a) => a.ownerUid === ctx.uid || (a.ownerTrusteeId && mine.has(a.ownerTrusteeId)));
    }
    if (input.overdue) {
      const day = today();
      actions = actions.filter((a) => a.status === "open" && a.dueDate && a.dueDate < day);
    }
    actions = sortActions(actions).slice(0, input.limit);
    const meetingIds = [...new Set(actions.map((a) => a.meetingId))];
    const titles = new Map<string, string>();
    if (meetingIds.length) {
      const snaps = await db.getAll(...meetingIds.map((m) => db.collection(C.meetings).doc(m)));
      for (const s of snaps) if (s.exists) titles.set(s.id, s.get("title") as string);
    }
    return actions.map((a) => ({ ...a, meetingTitle: titles.get(a.meetingId) }));
  },

  async "meetingActions.create"(input, ctx) {
    const { meeting } = await loadMeeting(input.meetingId);
    assertDraft(meeting);
    const ownerTrusteeId = blankToUndefined(input.ownerTrusteeId);
    const ownerUid = blankToUndefined(input.ownerUid);
    await checkActionOwner(ownerTrusteeId, ownerUid);
    const ref = db.collection(C.meetingActions).doc();
    const data = strip({
      meetingId: input.meetingId,
      raisedAt: fromIso(meeting.startsAt),
      description: input.description,
      ownerTrusteeId,
      ownerUid,
      dueDate: blankToUndefined(input.dueDate),
      status: "open" as const,
      createdAt: Timestamp.now(),
      createdBy: ctx.uid,
    });
    const batch = db.batch();
    batch.create(ref, data);
    await auditInBatch(batch, ctx, { action: "create", entity: "meetingAction", entityId: ref.id, op: "meetingActions.create", after: serialise(data) });
    await batch.commit();
    return serialise<MeetingAction>({ id: ref.id, ...data });
  },

  async "meetingActions.update"(input, ctx) {
    const ref = db.collection(C.meetingActions).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound("Action");
    const p = input.patch;
    const ownerTrusteeId = p.ownerTrusteeId && p.ownerTrusteeId !== snap.get("ownerTrusteeId") ? p.ownerTrusteeId : undefined;
    const ownerUid = p.ownerUid && p.ownerUid !== snap.get("ownerUid") ? p.ownerUid : undefined;
    await checkActionOwner(ownerTrusteeId, ownerUid);

    const update = toUpdate({ description: p.description, ownerTrusteeId: p.ownerTrusteeId, ownerUid: p.ownerUid, dueDate: p.dueDate, status: p.status });
    if (p.status === "done" && snap.get("status") !== "done") {
      update.completedAt = Timestamp.now();
      if (input.atMeetingId) {
        await loadMeeting(input.atMeetingId);
        update.completedAtMeetingId = input.atMeetingId;
      }
    }
    if (p.status === "open") {
      update.completedAt = FieldValue.delete();
      update.completedAtMeetingId = FieldValue.delete();
    }
    update.updatedAt = Timestamp.now();

    const before = serialise<Record<string, unknown>>(snap.data());
    const batch = db.batch();
    batch.update(ref, update);
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "meetingAction",
      entityId: input.id,
      op: "meetingActions.update",
      ...changedFields(Object.fromEntries(Object.keys(p).map((k) => [k, before[k]])), serialise(p)),
    });
    await batch.commit();
    return docOut<MeetingAction>(await ref.get());
  },

  // Papers

  async "meetingPapers.createUpload"(input, ctx) {
    await loadMeeting(input.meetingId);
    if (!ALLOWED_TYPES.has(input.contentType)) throw fail.invalid("That type of file can't be uploaded.");
    const ref = db.collection(C.meetingPapers).doc();
    const storagePath = `meetings/${input.meetingId}/${ref.id}`;
    const data = {
      meetingId: input.meetingId,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      description: input.description,
      status: "pending" as const,
      storagePath,
      createdAt: Timestamp.now(),
      createdBy: ctx.uid,
    };
    const upload = await signedUploadUrl(storagePath, input.contentType);
    const batch = db.batch();
    batch.create(ref, data);
    await auditInBatch(batch, ctx, {
      action: "create",
      entity: "meetingPaper",
      entityId: ref.id,
      op: "meetingPapers.createUpload",
      after: { meetingId: input.meetingId, fileName: input.fileName, description: input.description, sizeBytes: input.sizeBytes },
    });
    await batch.commit();
    return {
      paper: docOut<MeetingPaper>(await ref.get(), ["storagePath"]),
      uploadUrl: upload.url,
      uploadMethod: upload.method,
      uploadHeaders: upload.headers,
    };
  },

  async "meetingPapers.completeUpload"(input, ctx) {
    const ref = db.collection(C.meetingPapers).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists || snap.get("createdBy") !== ctx.uid) throw fail.notFound("Paper");
    if (snap.get("status") === "ready") return docOut<MeetingPaper>(snap, ["storagePath"]);
    const file = bucket().file(snap.get("storagePath"));
    const [exists] = await file.exists();
    if (!exists) throw fail.precondition("The upload hasn't finished yet.");
    let [meta] = await file.getMetadata();
    // The storage emulator ignores Content-Type on media uploads; see files.ts.
    if (isEmulator() && meta.contentType === "application/octet-stream") {
      [meta] = await file.setMetadata({ contentType: snap.get("contentType") });
    }
    const size = Number(meta.size ?? 0);
    if (size > MAX_UPLOAD_BYTES || meta.contentType !== snap.get("contentType")) {
      await file.delete({ ignoreNotFound: true });
      await ref.delete();
      throw fail.invalid("The uploaded file didn't match what was expected and has been removed.");
    }
    const batch = db.batch();
    batch.update(ref, { status: "ready", sizeBytes: size });
    await auditInBatch(batch, ctx, { action: "update", entity: "meetingPaper", entityId: input.id, op: "meetingPapers.completeUpload", detail: "Upload completed" });
    await batch.commit();
    return docOut<MeetingPaper>(await ref.get(), ["storagePath"]);
  },

  async "meetingPapers.getDownloadUrl"(input) {
    const snap = await db.collection(C.meetingPapers).doc(input.id).get();
    if (!snap.exists || snap.get("status") !== "ready") throw fail.notFound("Paper");
    const url = await signedDownloadUrl(snap.get("storagePath"), snap.get("fileName"));
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_MINUTES * 60_000).toISOString() };
  },
};
