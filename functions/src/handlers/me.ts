import { londonDate, type Callback, type Notification, type Session } from "@ccm/shared";
import { Timestamp } from "firebase-admin/firestore";
import type { UserDoc } from "../core/context.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { C, db, docOut } from "../core/firebase.js";
import { userOut } from "./admin.js";
import { clientNames } from "./common.js";
import { retentionCutoff } from "../jobs/retention.js";

export const meHandlers: HandlerGroup = {
  async "me.get"(_input, ctx) {
    return {
      user: userOut(ctx.uid, ctx.user),
      permissions: [...ctx.permissions].sort(),
      org: ctx.org,
    };
  },

  async "dashboard.get"(_input, ctx) {
    const now = Timestamp.now();
    const weekAhead = Timestamp.fromMillis(now.toMillis() + 7 * 86_400_000);
    const canSee = ctx.can("clients.view");
    const [callbacks, sessions, notifications, safeguarding, retention, meetingActions] = await Promise.all([
      canSee
        ? db.collection(C.callbacks).where("assigneeUid", "==", ctx.uid).where("status", "==", "open").orderBy("dueAt").limit(100).get()
        : null,
      canSee
        ? db
            .collection(C.sessions)
            .where("staffUid", "==", ctx.uid)
            .where("startsAt", ">=", Timestamp.fromMillis(now.toMillis() - 3_600_000))
            .where("startsAt", "<", weekAhead)
            .orderBy("startsAt")
            .limit(50)
            .get()
        : null,
      db.collection(C.notifications).where("userUid", "==", ctx.uid).orderBy("createdAt", "desc").limit(20).get(),
      ctx.can("safeguarding.view") ? db.collection(C.safeguarding).where("status", "in", ["open", "under_review", "escalated"]).count().get() : null,
      ctx.can("retention.manage")
        ? db
            .collection(C.clients)
            .where("status", "in", ["active", "restricted"])
            .where("lastActivityAt", "<", retentionCutoff(ctx.org, ctx.org.retentionWarningDays))
            .count()
            .get()
        : null,
      ctx.can("meetings.view")
        ? db
            .collection(C.meetingActions)
            .where("status", "==", "open")
            .where("dueDate", "<", londonDate(now.toDate().toISOString()))
            .count()
            .get()
        : null,
    ]);

    const cbs = callbacks?.docs.map((d) => docOut<Callback>(d)) ?? [];
    const ses = (sessions?.docs.map((d) => docOut<Session>(d)) ?? []).filter((s) => s.status === "scheduled");
    const names = await clientNames(ctx, [...cbs.map((c) => c.clientId), ...ses.map((s) => s.clientId)]);
    const named = <T extends { clientId: string }>(x: T) => ({ ...x, clientName: names.get(x.clientId) ?? "Unknown client" });
    const nowIso = now.toDate().toISOString();
    return {
      overdueCallbacks: cbs.filter((c) => c.dueAt < nowIso).map(named),
      upcomingCallbacks: cbs.filter((c) => c.dueAt >= nowIso).map(named),
      upcomingSessions: ses.map(named),
      notifications: notifications.docs.map((d) => docOut<Notification>(d)),
      openSafeguarding: safeguarding?.data().count,
      retentionDue: retention?.data().count,
      overdueMeetingActions: meetingActions?.data().count,
    };
  },

  async "notifications.markRead"(input, ctx) {
    const refs = input.ids.map((id) => db.collection(C.notifications).doc(id));
    if (refs.length === 0) return { ok: true };
    const snaps = await db.getAll(...refs);
    const batch = db.batch();
    for (const s of snaps) if (s.exists && s.get("userUid") === ctx.uid && !s.get("readAt")) batch.update(s.ref, { readAt: Timestamp.now() });
    await batch.commit();
    return { ok: true };
  },

  async "users.directory"() {
    const snap = await db.collection(C.users).where("active", "==", true).get();
    return snap.docs
      .filter((d) => d.get("invited") !== true)
      .map((d) => ({ uid: d.id, displayName: (d.data() as UserDoc).displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
};

