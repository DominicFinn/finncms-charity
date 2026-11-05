import type { FileRecord } from "@ccm/shared";
import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { auditInBatch } from "../core/audit.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { fail } from "../core/errors.js";
import { bucket, C, db, docOut, isEmulator } from "../core/firebase.js";
import { clientFor } from "./common.js";

const UPLOAD_MINUTES = 15;
export const DOWNLOAD_MINUTES = 5;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Types staff are likely to need. Anything else is refused. */
export const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.text",
]);

function emulatorBase() {
  return `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "127.0.0.1:9199"}`;
}

/**
 * Short lived download link. In production this is a V4 signed URL, which
 * needs the functions service account to hold "Service Account Token
 * Creator" on itself. The storage emulator doesn't sign URLs, so there a
 * per-file download token is used instead.
 */
export async function signedDownloadUrl(path: string, fileName: string): Promise<string> {
  const file = bucket().file(path);
  if (isEmulator()) {
    const [meta] = await file.getMetadata();
    let token = (meta.metadata?.firebaseStorageDownloadTokens as string | undefined)?.split(",")[0];
    if (!token) {
      token = randomUUID();
      await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
    }
    return `${emulatorBase()}/v0/b/${bucket().name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  }
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + DOWNLOAD_MINUTES * 60_000,
    responseDisposition: `attachment; filename="${fileName.replace(/["\\\r\n]/g, "_")}"`,
  });
  return url;
}

export async function signedUploadUrl(path: string, contentType: string): Promise<{ url: string; method: "PUT" | "POST"; headers: Record<string, string> }> {
  if (isEmulator()) {
    return {
      url: `${emulatorBase()}/upload/storage/v1/b/${bucket().name}/o?uploadType=media&name=${encodeURIComponent(path)}`,
      method: "POST",
      // The storage emulator treats "owner" as an admin credential. Emulator only.
      headers: { "Content-Type": contentType, Authorization: "Bearer owner" },
    };
  }
  const [url] = await bucket()
    .file(path)
    .getSignedUrl({ version: "v4", action: "write", expires: Date.now() + UPLOAD_MINUTES * 60_000, contentType });
  return { url, method: "PUT", headers: { "Content-Type": contentType } };
}

export const fileHandlers: HandlerGroup = {
  async "files.list"(input, ctx) {
    await clientFor(ctx, input.clientId, "read");
    const snap = await db.collection(C.files).where("clientId", "==", input.clientId).orderBy("createdAt", "desc").get();
    return snap.docs.filter((d) => d.get("status") === "ready").map((d) => docOut<FileRecord>(d, ["storagePath"]));
  },

  async "files.createUpload"(input, ctx) {
    await clientFor(ctx, input.clientId, "activity");
    if (!ALLOWED_TYPES.has(input.contentType)) throw fail.invalid("That type of file can't be uploaded.");
    if (input.parent.kind !== "client") {
      const col = { note: C.notes, session: C.sessions, callback: C.callbacks }[input.parent.kind];
      const parent = await db.collection(col).doc(input.parent.id).get();
      if (!parent.exists || parent.get("clientId") !== input.clientId) throw fail.invalid("That record doesn't belong to this client.");
    } else if (input.parent.id !== input.clientId) {
      throw fail.invalid("Parent client doesn't match.");
    }
    const ref = db.collection(C.files).doc();
    const storagePath = `clients/${input.clientId}/${ref.id}`;
    const data = {
      clientId: input.clientId,
      parent: input.parent,
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
      entity: "file",
      entityId: ref.id,
      clientIds: [input.clientId],
      op: "files.createUpload",
      after: { fileName: input.fileName, description: input.description, parent: input.parent, sizeBytes: input.sizeBytes },
    });
    await batch.commit();
    return { file: docOut<FileRecord>(await ref.get(), ["storagePath"]), uploadUrl: upload.url, uploadMethod: upload.method, uploadHeaders: upload.headers };
  },

  async "files.completeUpload"(input, ctx) {
    const ref = db.collection(C.files).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists || snap.get("createdBy") !== ctx.uid) throw fail.notFound("File");
    if (snap.get("status") === "ready") return docOut<FileRecord>(snap, ["storagePath"]);
    const clientId = snap.get("clientId") as string;
    ctx.touched.add(clientId);
    const file = bucket().file(snap.get("storagePath"));
    const [exists] = await file.exists();
    if (!exists) throw fail.precondition("The upload hasn't finished yet.");
    let [meta] = await file.getMetadata();
    // The storage emulator ignores Content-Type on media uploads. Signed URLs
    // in production enforce it, so this correction only happens locally.
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
    batch.update(db.collection(C.clients).doc(clientId), { lastActivityAt: Timestamp.now() });
    await auditInBatch(batch, ctx, { action: "update", entity: "file", entityId: input.id, clientIds: [clientId], op: "files.completeUpload", detail: "Upload completed" });
    await batch.commit();
    return docOut<FileRecord>(await ref.get(), ["storagePath"]);
  },

  async "files.getDownloadUrl"(input, ctx) {
    const snap = await db.collection(C.files).doc(input.id).get();
    if (!snap.exists || snap.get("status") !== "ready") throw fail.notFound("File");
    await clientFor(ctx, snap.get("clientId"), "read");
    const url = await signedDownloadUrl(snap.get("storagePath"), snap.get("fileName"));
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_MINUTES * 60_000).toISOString() };
  },
};
