/**
 * Per-client data keys for crypto-shredding.
 *
 * Audit entries are append only, but they hold before and after values that
 * include personal data. To honour anonymisation without editing the audit
 * log, those values are encrypted with a key held per client. Anonymising a
 * client deletes the key, which makes the old values unreadable while the
 * audit entries themselves (who, what, when) stay intact.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { C, db } from "./firebase.js";

export interface Sealed {
  iv: string;
  tag: string;
  data: string;
}

const cache = new Map<string, Buffer | null>();

async function loadKey(clientId: string, create: boolean): Promise<Buffer | null> {
  if (cache.has(clientId)) {
    const hit = cache.get(clientId)!;
    if (hit || !create) return hit;
  }
  const ref = db.collection(C.clientKeys).doc(clientId);
  const key = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return Buffer.from(snap.get("key") as string, "base64");
    if (!create) return null;
    const fresh = randomBytes(32);
    tx.create(ref, { key: fresh.toString("base64") });
    return fresh;
  });
  cache.set(clientId, key);
  return key;
}

export async function sealForClient(clientId: string, value: unknown): Promise<Sealed> {
  const key = (await loadKey(clientId, true))!;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

/**
 * Returns null when the client's key has been shredded. Always reads the key
 * fresh, so a shred done by another instance takes effect at once.
 */
export async function openForClient(clientId: string, sealed: Sealed): Promise<unknown | null> {
  cache.delete(clientId);
  const key = await loadKey(clientId, false);
  if (!key) return null;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  const out = Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]);
  return JSON.parse(out.toString("utf8"));
}

export async function shredClientKey(clientId: string): Promise<void> {
  await db.collection(C.clientKeys).doc(clientId).delete();
  cache.set(clientId, null);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
