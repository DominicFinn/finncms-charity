import { clientDisplayName, type ClientStatus, type ConsentRestriction } from "@ccm/shared";
import { FieldValue, type DocumentSnapshot, type WriteBatch } from "firebase-admin/firestore";
import type { Ctx } from "../core/context.js";
import { fail } from "../core/errors.js";
import { C, db } from "../core/firebase.js";

export interface ClientDoc {
  status: ClientStatus;
  firstName: string;
  lastName: string;
  preferredName?: string;
  town?: string;
  postcode?: string;
  postcodeDistrict?: string;
  helpCategoryIds: string[];
  questionSetIds: string[];
  restrictions: ConsentRestriction[];
  openSafeguardingConcerns?: number;
  [key: string]: unknown;
}

export async function loadClient(id: string): Promise<{ snap: DocumentSnapshot; client: ClientDoc }> {
  const snap = await db.collection(C.clients).doc(id).get();
  if (!snap.exists) throw fail.notFound("Client");
  return { snap, client: snap.data() as ClientDoc };
}

export type ClientUse = "read" | "edit" | "activity" | "contact" | "sensitive";

/**
 * Loads a client and checks it can be used for the given purpose.
 * - anonymised clients are read only and hold nothing personal
 * - "no_processing" (consent withdrawn) blocks new activity
 * - "no_contact" blocks callbacks
 * - "no_sensitive_data" blocks new sensitive answers
 */
export async function clientFor(ctx: Ctx, id: string, use: ClientUse) {
  const loaded = await loadClient(id);
  const { client } = loaded;
  ctx.touched.add(id);
  if (use === "read") return loaded;
  if (client.status === "anonymised") throw fail.precondition("This client has been anonymised and can't be changed.");
  if (use === "edit") return loaded;
  const r = client.restrictions ?? [];
  if (r.includes("no_processing")) {
    throw fail.precondition("The client has withdrawn consent to processing, so new records can't be added.");
  }
  if (use === "contact" && r.includes("no_contact")) {
    throw fail.precondition("The client has withdrawn consent to be contacted.");
  }
  if (use === "sensitive" && r.includes("no_sensitive_data")) {
    throw fail.precondition("The client has withdrawn consent for health and financial information to be recorded.");
  }
  return loaded;
}

export function touchActivity(batch: WriteBatch, clientId: string) {
  batch.update(db.collection(C.clients).doc(clientId), { lastActivityAt: FieldValue.serverTimestamp() });
}

/** Names for a set of clients, for dashboards. Records the clients as viewed. */
export async function clientNames(ctx: Ctx, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const snaps = await db.getAll(...unique.map((id) => db.collection(C.clients).doc(id)));
  for (const s of snaps) {
    if (!s.exists) continue;
    ctx.touched.add(s.id);
    const d = s.data() as ClientDoc;
    out.set(s.id, d.status === "anonymised" ? "Anonymised client" : clientDisplayName(d));
  }
  return out;
}

export function strip<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** Resolves "me" to the caller's uid. */
export function who(ctx: Ctx, uid: string | undefined): string | undefined {
  return uid === "me" ? ctx.uid : uid;
}

export async function assertActiveUser(uid: string) {
  const snap = await db.collection(C.users).doc(uid).get();
  if (!snap.exists || snap.get("active") !== true || snap.get("invited") === true) {
    throw fail.invalid("That staff member doesn't exist or isn't active.");
  }
}

export function encodeCursor(values: unknown[]): string {
  return Buffer.from(JSON.stringify(values)).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): unknown[] | undefined {
  if (!cursor) return undefined;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Array.isArray(v) ? v : undefined;
  } catch {
    throw fail.invalid("Invalid cursor.");
  }
}

export function omitId<T extends { id?: string }>(value: T): Omit<T, "id"> {
  const { id: _id, ...rest } = value;
  return rest;
}
