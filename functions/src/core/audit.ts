/**
 * The audit log. Entries are written only by server code with the Admin SDK;
 * Firestore rules deny all client access, and no operation updates or deletes
 * an audit document. Writes that change data add their audit entry to the
 * same batch, so the change and its audit record land together or not at all.
 * Reads are audited before the data is returned: no audit entry, no data.
 */
import type { AuditAction, Channel } from "@ccm/shared";
import { FieldValue, type WriteBatch, type Transaction } from "firebase-admin/firestore";
import { sealForClient } from "./crypto.js";
import { C, db } from "./firebase.js";

export interface Actor {
  uid: string;
  email?: string;
  channel: Channel;
}

export const SYSTEM_ACTOR: Actor = { uid: "system", channel: "system" };

export interface AuditInput {
  action: AuditAction;
  entity: string;
  entityId?: string;
  /** Clients whose data this touched. Used for the client access report. */
  clientIds?: string[];
  op?: string;
  before?: unknown;
  after?: unknown;
  /** Must never contain personal data. */
  detail?: string;
}

async function buildEntry(actor: Actor, input: AuditInput): Promise<Record<string, unknown>> {
  const clientIds = [...new Set(input.clientIds ?? [])];
  const entry: Record<string, unknown> = {
    at: FieldValue.serverTimestamp(),
    actorUid: actor.uid,
    actorEmail: actor.email ?? null,
    channel: actor.channel,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    clientIds,
    clientId: clientIds.length === 1 ? clientIds[0] : null,
    op: input.op ?? null,
    detail: input.detail ?? null,
  };
  if (input.before !== undefined || input.after !== undefined) {
    const diff = { before: input.before ?? null, after: input.after ?? null };
    // Diffs about a single client are sealed with that client's key so they
    // can be shredded on anonymisation. Anything else is stored as is.
    if (clientIds.length === 1) entry.diffSealed = await sealForClient(clientIds[0], diff);
    else entry.diff = JSON.parse(JSON.stringify(diff));
  }
  return entry;
}

export async function auditNow(actor: Actor, input: AuditInput): Promise<void> {
  const entry = await buildEntry(actor, input);
  await db.collection(C.audit).add(entry);
}

export async function auditInBatch(batch: WriteBatch | Transaction, actor: Actor, input: AuditInput): Promise<void> {
  const entry = await buildEntry(actor, input);
  const ref = db.collection(C.audit).doc();
  (batch as WriteBatch).create(ref, entry);
}

/** Prepares an entry for use inside a transaction, where awaits after reads are not allowed to hit Firestore. */
export async function prepareAudit(actor: Actor, input: AuditInput) {
  const entry = await buildEntry(actor, input);
  const ref = db.collection(C.audit).doc();
  return (tx: Transaction | WriteBatch) => {
    (tx as WriteBatch).create(ref, entry);
  };
}

/** Values that change between two versions of a record, for compact diffs. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key] ?? null;
      a[key] = after[key] ?? null;
    }
  }
  return { before: b, after: a };
}
