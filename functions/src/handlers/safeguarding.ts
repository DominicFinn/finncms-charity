import type { SafeguardingAction, SafeguardingConcern } from "@ccm/shared";
import { FieldValue, Timestamp, type Query } from "firebase-admin/firestore";
import { auditInBatch } from "../core/audit.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { fail } from "../core/errors.js";
import { C, db, docOut, serialise } from "../core/firebase.js";
import { assertActiveUser, clientFor } from "./common.js";
import { permissionsFor } from "../core/context.js";

const OPEN = ["open", "under_review", "escalated"];

async function openCount(clientId: string, excludingId?: string, includeSelf = false): Promise<number> {
  const q = await db.collection(C.safeguarding).where("clientId", "==", clientId).where("status", "in", OPEN).get();
  return q.docs.filter((d) => d.id !== excludingId).length + (includeSelf ? 1 : 0);
}

export const safeguardingHandlers: HandlerGroup = {
  async "safeguarding.list"(input, ctx) {
    let q: Query = db.collection(C.safeguarding);
    if (input.clientId) q = q.where("clientId", "==", input.clientId);
    if (input.status) q = q.where("status", "==", input.status);
    else if (input.openOnly) q = q.where("status", "in", OPEN);
    const snap = await q.orderBy("raisedAt", "desc").limit(200).get();
    return snap.docs.map((d) => {
      ctx.touched.add(d.get("clientId"));
      return docOut<SafeguardingConcern>(d);
    });
  },

  async "safeguarding.raise"(input, ctx) {
    // Concerns can be raised against restricted clients: safeguarding duties
    // don't depend on consent.
    const { snap: clientSnap, client } = await clientFor(ctx, input.clientId, "read");
    if (client.status === "anonymised") throw fail.precondition("This client has been anonymised.");
    const ref = db.collection(C.safeguarding).doc();
    const now = Timestamp.now();
    const action: SafeguardingAction = { at: now.toDate().toISOString(), by: ctx.uid, kind: "raised", status: "open" };
    const data = {
      clientId: input.clientId,
      description: input.description,
      severity: input.severity,
      status: "open" as const,
      raisedBy: ctx.uid,
      raisedAt: now,
      history: [action],
    };
    const count = await openCount(input.clientId, undefined, true);
    const batch = db.batch();
    batch.create(ref, data);
    batch.update(clientSnap.ref, { openSafeguardingConcerns: count, flagged: true, lastActivityAt: FieldValue.serverTimestamp() });
    await auditInBatch(batch, ctx, {
      action: "create",
      entity: "safeguarding",
      entityId: ref.id,
      clientIds: [input.clientId],
      op: "safeguarding.raise",
      after: serialise(data),
    });
    await batch.commit();
    return serialise<SafeguardingConcern>({ id: ref.id, ...data });
  },

  async "safeguarding.update"(input, ctx) {
    const ref = db.collection(C.safeguarding).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound("Concern");
    const clientId = snap.get("clientId") as string;
    ctx.touched.add(clientId);
    if (snap.get("anonymised")) throw fail.precondition("This client has been anonymised.");
    if (input.leadUid) {
      await assertActiveUser(input.leadUid);
      const lead = await db.collection(C.users).doc(input.leadUid).get();
      if (!(await permissionsFor(lead.get("roleIds") ?? [])).has("safeguarding.view")) {
        throw fail.invalid("The safeguarding lead must be someone who can see safeguarding concerns.");
      }
    }
    const at = new Date().toISOString();
    const history: SafeguardingAction[] = [];
    const update: Record<string, unknown> = {};
    if (input.status && input.status !== snap.get("status")) {
      update.status = input.status;
      history.push({ at, by: ctx.uid, kind: "status_changed", status: input.status });
    }
    if (input.leadUid && input.leadUid !== snap.get("leadUid")) {
      update.leadUid = input.leadUid;
      history.push({ at, by: ctx.uid, kind: "assigned", leadUid: input.leadUid });
    }
    if (input.severity && input.severity !== snap.get("severity")) update.severity = input.severity;
    if (input.comment) history.push({ at, by: ctx.uid, kind: "comment", comment: input.comment });
    if (Object.keys(update).length === 0 && history.length === 0) throw fail.invalid("Nothing to change.");
    if (history.length) update.history = FieldValue.arrayUnion(...history);

    const batch = db.batch();
    batch.update(ref, update);
    if (update.status) {
      const nowOpen = OPEN.includes(update.status as string);
      const count = await openCount(clientId, input.id, nowOpen);
      batch.update(db.collection(C.clients).doc(clientId), { openSafeguardingConcerns: count, flagged: count > 0 });
    }
    if (update.leadUid && update.leadUid !== ctx.uid) {
      batch.create(db.collection(C.notifications).doc(), {
        userUid: update.leadUid,
        kind: "safeguarding_assigned",
        message: "You have been assigned a safeguarding concern.",
        link: `/safeguarding?concern=${input.id}`,
        createdAt: Timestamp.now(),
      });
    }
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "safeguarding",
      entityId: input.id,
      clientIds: [clientId],
      op: "safeguarding.update",
      before: { status: snap.get("status"), leadUid: snap.get("leadUid") ?? null, severity: snap.get("severity") },
      after: { ...update, history },
    });
    await batch.commit();
    return docOut<SafeguardingConcern>(await ref.get());
  },
};
