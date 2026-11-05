import type { AuditEntry } from "@ccm/shared";
import type { Ctx } from "../core/context.js";
import type { Query } from "firebase-admin/firestore";
import { openForClient, type Sealed } from "../core/crypto.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { C, db, fromIso, serialise } from "../core/firebase.js";
import { decodeCursor, encodeCursor } from "./common.js";

/**
 * Before and after values can hold sensitive answers or safeguarding detail,
 * so they're only shown to people who could see that data in the record.
 */
function maySeeDiff(ctx: Ctx, entity: string): boolean {
  if (!ctx.can("clients.view")) return false;
  if (entity === "answers" || entity === "outcome") return ctx.can("questionnaires.viewSensitive");
  if (entity === "safeguarding") return ctx.can("safeguarding.view");
  return true;
}

async function entryOut(doc: FirebaseFirestore.QueryDocumentSnapshot, ctx: Ctx): Promise<AuditEntry> {
  const d = doc.data();
  for (const id of (d.clientIds as string[] | undefined) ?? []) ctx.touched.add(id);
  const hasDiff = Boolean(d.diffSealed || d.diff);
  const hidden = hasDiff && !maySeeDiff(ctx, d.entity);
  let diff: AuditEntry["diff"] = hidden ? undefined : d.diff;
  if (!hidden && d.diffSealed && d.clientId) {
    diff = (await openForClient(d.clientId, d.diffSealed as Sealed)) as AuditEntry["diff"];
  }
  const out = serialise<AuditEntry>({
    id: doc.id,
    at: d.at,
    actorUid: d.actorUid,
    actorEmail: d.actorEmail,
    channel: d.channel,
    action: d.action,
    entity: d.entity,
    entityId: d.entityId,
    clientId: d.clientId ?? (d.clientIds?.length ? d.clientIds[0] : undefined),
    op: d.op,
    detail: d.detail,
  });
  // null means the values were sealed and the client's key has since been shredded.
  if (hidden) out.diffHidden = true;
  else if (hasDiff) out.diff = diff ?? null;
  return out;
}

export const auditHandlers: HandlerGroup = {
  async "audit.list"(input, ctx) {
    let q: Query = db.collection(C.audit);
    if (input.clientId) q = q.where("clientIds", "array-contains", input.clientId);
    if (input.actorUid) q = q.where("actorUid", "==", input.actorUid);
    if (input.entity) q = q.where("entity", "==", input.entity);
    if (input.from) q = q.where("at", ">=", fromIso(input.from));
    if (input.to) q = q.where("at", "<", fromIso(input.to));
    q = q.orderBy("at", "desc");
    const cursor = decodeCursor(input.cursor);
    if (cursor?.[0]) {
      const after = await db.collection(C.audit).doc(String(cursor[0])).get();
      if (after.exists) q = q.startAfter(after);
    }
    const snap = await q.limit(input.limit).get();
    const items = await Promise.all(snap.docs.map((doc) => entryOut(doc, ctx)));
    const last = snap.docs[snap.docs.length - 1];
    return { items, nextCursor: snap.size === input.limit && last ? encodeCursor([last.id]) : undefined };
  },

  async "audit.clientAccess"(input, ctx) {
    ctx.touched.add(input.clientId);
    let q: Query = db.collection(C.audit).where("clientIds", "array-contains", input.clientId);
    if (input.from) q = q.where("at", ">=", fromIso(input.from));
    if (input.to) q = q.where("at", "<", fromIso(input.to));
    const snap = await q.orderBy("at", "desc").limit(2000).get();
    const users = await db.collection(C.users).get();
    const names = new Map(users.docs.map((u) => [u.id, u.get("displayName") as string]));
    names.set("system", "System");
    const entries = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        actorUid: d.actorUid as string,
        actorName: names.get(d.actorUid) ?? d.actorEmail ?? d.actorUid,
        channel: d.channel,
        action: d.action,
        entity: d.entity,
        at: serialise<string>(d.at),
      };
    });
    const byUser = new Map<string, { actorUid: string; actorName: string; count: number; firstAt: string; lastAt: string }>();
    for (const e of entries) {
      const row = byUser.get(e.actorUid);
      if (!row) byUser.set(e.actorUid, { actorUid: e.actorUid, actorName: e.actorName, count: 1, firstAt: e.at, lastAt: e.at });
      else {
        row.count += 1;
        if (e.at < row.firstAt) row.firstAt = e.at;
        if (e.at > row.lastAt) row.lastAt = e.at;
      }
    }
    return { clientId: input.clientId, entries, byUser: [...byUser.values()].sort((a, b) => b.count - a.count) };
  },
};
