/**
 * Referral intake: the one public endpoint that writes data without a signed
 * in user. It is meant to be called server to server, by the charity's
 * website after it has checked its own form (Turnstile, honeypot, timing).
 *
 * What this endpoint does on its own:
 * - accepts only POST with a JSON body under MAX_BODY_BYTES
 * - needs an integration key (stored here only as a SHA-256 hash), and
 *   refuses revoked keys
 * - rate limits each key per clock hour, counting every authenticated
 *   request, valid or not
 * - validates against a strict schema that rejects unknown fields
 * - never echoes submitted data back: success returns only a reference
 * - sends no CORS headers, so browsers can't call it from other sites
 *
 * Referrals land in a triage queue. Nothing here creates a client.
 */
import { normalisePostcode, postcodeDistrict, referralSubmissionSchema, type Permission } from "@ccm/shared";
import { randomInt } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { auditNow } from "./core/audit.js";
import { permissionsFor } from "./core/context.js";
import { sha256 } from "./core/crypto.js";
import { C, db, REGION } from "./core/firebase.js";
import { INTEGRATION_KEY_PREFIX } from "./handlers/referrals.js";

export const MAX_BODY_BYTES = 16 * 1024;

export interface IntakeRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  /** The raw body, used to enforce the size limit. */
  rawBody?: Buffer;
  /** The parsed JSON body. */
  body: unknown;
}

export interface IntakeResponse {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newReference(): string {
  let out = "R-";
  for (let i = 0; i < 6; i++) out += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return out;
}

/** The clock hour a request falls in, as a sortable string such as 2026110514. */
export function hourBucket(now: Date): string {
  return now.toISOString().slice(0, 13).replace(/\D/g, "");
}

function header(req: IntakeRequest, name: string): string {
  const v = req.headers[name.toLowerCase()];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

const unauthorised = (): IntakeResponse => ({
  status: 401,
  body: { error: "unauthorised" },
  headers: { "WWW-Authenticate": 'Bearer realm="referrals"' },
});

/** Counts this request against the key's hourly limit. Returns false when the limit is reached. */
async function withinLimit(keyId: string, limit: number, now: Date): Promise<boolean> {
  const bucket = hourBucket(now);
  const ref = db.collection(C.integrationUsage).doc(`${keyId.slice(0, 24)}_${bucket}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = (snap.get("count") as number | undefined) ?? 0;
    if (count >= limit) return false;
    if (snap.exists) tx.update(ref, { count: count + 1 });
    else {
      const hourStart = new Date(now);
      hourStart.setUTCMinutes(0, 0, 0);
      tx.create(ref, { keyId, count: 1, hourStart: Timestamp.fromDate(hourStart) });
    }
    return true;
  });
}

async function notifyTriagers(reference: string, referralId: string) {
  const users = await db.collection(C.users).where("active", "==", true).get();
  const batch = db.batch();
  let n = 0;
  for (const u of users.docs) {
    if (u.get("invited")) continue;
    const perms = await permissionsFor(u.get("roleIds") ?? []);
    if (!perms.has("referrals.manage" as Permission)) continue;
    batch.create(db.collection(C.notifications).doc(), {
      userUid: u.id,
      kind: "referral_assigned",
      message: `New referral ${reference} is waiting to be looked at.`,
      link: `/referrals/${referralId}`,
      createdAt: Timestamp.now(),
    });
    if (++n >= 50) break;
  }
  if (n) await batch.commit();
}

export async function handleIntake(req: IntakeRequest, now = new Date()): Promise<IntakeResponse> {
  if (req.method !== "POST") return { status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "POST" } };
  if (!header(req, "content-type").toLowerCase().startsWith("application/json")) {
    return { status: 415, body: { error: "unsupported_media_type" } };
  }
  const size = req.rawBody?.length ?? Buffer.byteLength(JSON.stringify(req.body ?? null));
  if (size > MAX_BODY_BYTES) return { status: 413, body: { error: "too_large" } };

  const auth = header(req, "authorization");
  const secret = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!secret.startsWith(INTEGRATION_KEY_PREFIX) || secret.length > 200) return unauthorised();
  const keyRef = db.collection(C.integrationKeys).doc(sha256(secret));
  const key = await keyRef.get();
  if (!key.exists || key.get("revokedAt")) return unauthorised();

  const hourlyLimit = (key.get("hourlyLimit") as number | undefined) ?? 20;
  if (!(await withinLimit(key.id, hourlyLimit, now))) {
    const retryAfter = 3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds());
    logger.warn("Referral intake: rate limit reached", { key: key.id.slice(0, 12) });
    return { status: 429, body: { error: "rate_limited" }, headers: { "Retry-After": String(retryAfter) } };
  }

  const parsed = referralSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    // Field paths and fixed messages only, never the submitted values.
    const fields = parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(body)", message: i.code === "unrecognized_keys" ? "Unknown fields." : i.message }));
    return { status: 400, body: { error: "invalid", fields } };
  }
  const s = parsed.data;

  const ref = s.submissionId
    ? db.collection(C.referrals).doc(sha256(`${key.id}:${s.submissionId}`).slice(0, 24))
    : db.collection(C.referrals).doc();
  const postcode = normalisePostcode(s.postcode);
  const ts = Timestamp.fromDate(now);
  const data = {
    reference: newReference(),
    status: "new",
    source: key.get("source") as string,
    keyId: key.id,
    submissionId: s.submissionId,
    referrerType: s.referrerType,
    referrerName: s.referrerType === "self" ? undefined : s.referrerName,
    referrerRelationship: s.referrerType === "self" ? undefined : s.referrerRelationship,
    referrerOrganisation: s.referrerType === "self" ? undefined : s.referrerOrganisation,
    referrerPhone: s.referrerType === "self" ? undefined : s.referrerPhone,
    referrerEmail: s.referrerType === "self" ? undefined : s.referrerEmail,
    firstName: s.firstName,
    lastName: s.lastName,
    addressLine: s.addressLine,
    town: s.town,
    postcode,
    postcodeDistrict: postcodeDistrict(postcode) ?? undefined,
    phone: s.phone,
    email: s.email,
    preferredContactMethod: s.preferredContactMethod,
    helpNeeded: s.helpNeeded,
    helpCategoryHints: s.helpCategoryHints,
    personAware: s.referrerType === "self" ? true : s.personAware,
    consentToContact: s.consentToContact,
    heardAbout: s.heardAbout,
    sourceUrl: s.sourceUrl,
    pendingPurge: false,
    createdAt: ts,
    updatedAt: ts,
  };

  const existing = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return snap.get("reference") as string;
    tx.create(ref, data);
    return null;
  });
  if (existing) return { status: 200, body: { reference: existing, duplicate: true } };

  await auditNow(
    { uid: `integration:${key.id.slice(0, 12)}`, channel: "integration" },
    { action: "create", entity: "referral", entityId: ref.id, op: "referrals.intake", detail: `Received from ${key.get("name")}` },
  );
  const lastUsed = (key.get("lastUsedAt") as Timestamp | undefined)?.toMillis() ?? 0;
  if (now.getTime() - lastUsed > 60_000) await keyRef.update({ lastUsedAt: ts }).catch(() => undefined);
  await notifyTriagers(data.reference, ref.id).catch((err) => logger.warn("Referral intake: notification failed", { err: String(err) }));

  return { status: 201, body: { reference: data.reference } };
}

export const referralsIntake = onRequest({ region: REGION, maxInstances: 3, concurrency: 20, timeoutSeconds: 30, memory: "256MiB" }, async (req, res) => {
  try {
    const out = await handleIntake({ method: req.method, headers: req.headers, rawBody: req.rawBody, body: req.body });
    res.status(out.status).set({ "Cache-Control": "no-store", ...(out.headers ?? {}) }).json(out.body);
  } catch (err) {
    logger.error("Referral intake failed", err);
    res.status(500).set("Cache-Control", "no-store").json({ error: "server_error" });
  }
});
