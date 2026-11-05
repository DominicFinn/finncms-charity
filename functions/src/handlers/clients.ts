import {
  normalisePostcode,
  postcodeDistrict,
  type Client,
  type ClientExport,
  type ClientSummary,
  type OpParsedInput,
} from "@ccm/shared";
import { FieldValue, FieldPath, Timestamp, type Query } from "firebase-admin/firestore";
import { auditInBatch, changedFields } from "../core/audit.js";
import type { Ctx } from "../core/context.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { fail } from "../core/errors.js";
import { C, db, docOut, newId, serialise } from "../core/firebase.js";
import { anonymiseClient } from "../jobs/anonymise.js";
import { signedDownloadUrl } from "./files.js";
import { clientFor, decodeCursor, encodeCursor, loadClient, type ClientDoc } from "./common.js";

type ClientInput = OpParsedInput<"clients.create">;

function prefixes(word: string | undefined, min = 2): string[] {
  if (!word) return [];
  const w = word.toLowerCase().replace(/[^a-z0-9'-]/g, "");
  const out: string[] = [];
  for (let i = Math.min(min, w.length); i <= w.length; i++) out.push(w.slice(0, i));
  return out;
}

export function searchTokens(c: Partial<ClientDoc>): string[] {
  const tokens = new Set<string>();
  for (const name of [c.firstName, c.lastName, c.preferredName]) {
    for (const part of (name ?? "").split(/[\s-]+/)) prefixes(part).forEach((t) => tokens.add(t));
  }
  const pc = (c.postcode ?? "").replace(/\s+/g, "");
  prefixes(pc).forEach((t) => tokens.add(t));
  return [...tokens];
}

function sortName(c: Partial<ClientDoc>): string {
  return `${c.lastName ?? ""} ${c.firstName ?? ""}`.toLowerCase().trim();
}

/** Derived fields kept in step with the editable ones. */
function derived(c: Partial<ClientDoc>) {
  return {
    postcodeDistrict: postcodeDistrict(c.postcode as string | undefined) ?? null,
    searchTokens: searchTokens(c),
    sortName: sortName(c),
  };
}

/** Optional fields that an empty string clears. */
const CLEARABLE = ["preferredName", "dateOfBirth", "town", "postcode", "email", "preferredContactMethod"] as const;

function cleanInput(input: Partial<ClientInput>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  if (input.postcode) out.postcode = normalisePostcode(input.postcode);
  for (const key of CLEARABLE) if (out[key] === "") out[key] = null;
  if (input.contacts) {
    out.contacts = input.contacts.map((c) => ({ ...c, id: c.id ?? newId("contacts"), email: c.email || null }));
  }
  return out;
}

export function clientOut(ctx: Ctx, id: string, data: ClientDoc): Client {
  const out = serialise<Client>({ id, ...data });
  for (const key of ["searchTokens", "sortName", "flagged", "retentionWarnedAt"]) delete (out as unknown as Record<string, unknown>)[key];
  if (!ctx.can("safeguarding.view")) delete out.openSafeguardingConcerns;
  out.addressLines ??= [];
  out.phones ??= [];
  out.contacts ??= [];
  out.questionSetIds ??= [];
  out.restrictions ??= [];
  out.helpCategoryIds ??= [];
  if (data.status === "anonymised") {
    out.firstName = "Anonymised";
    out.lastName = "client";
  }
  return out;
}

function summaryOut(ctx: Ctx, id: string, data: ClientDoc): ClientSummary {
  const c = clientOut(ctx, id, data);
  return {
    id: c.id,
    status: c.status,
    firstName: c.firstName,
    lastName: c.lastName,
    preferredName: c.preferredName,
    town: c.town,
    postcodeDistrict: c.postcodeDistrict,
    helpCategoryIds: c.helpCategoryIds,
    openSafeguardingConcerns: c.openSafeguardingConcerns,
    lastActivityAt: c.lastActivityAt,
  };
}

async function defaultQuestionSetIds(): Promise<string[]> {
  const q = await db.collection(C.questionSets).where("attachByDefault", "==", true).where("archived", "==", false).get();
  return q.docs.filter((d) => d.get("kind") === "questionnaire").map((d) => d.id);
}

const POSTCODE_ONLY = /^[a-z]{1,2}\d[a-z\d]?\s*\d?[a-z]{0,2}$/i;

export const clientHandlers: HandlerGroup = {
  async "clients.list"(input, ctx) {
    if (input.flaggedOnly && !ctx.can("safeguarding.view")) throw fail.denied();
    const search = input.search?.toLowerCase().trim() ?? "";
    let words = search.split(/\s+/).filter((w) => w.length > 0);
    if (POSTCODE_ONLY.test(search)) words = [search.replace(/\s+/g, "")];
    // Firestore allows one array-contains per query. The most selective filter
    // goes to Firestore and the rest are applied here.
    const primary = words[0]?.slice(0, 40);

    let q: Query = db.collection(C.clients);
    if (input.status !== "all") q = q.where("status", "==", input.status);
    let used: "search" | "category" | "flagged" | "town" | null = null;
    if (primary) {
      q = q.where("searchTokens", "array-contains", primary);
      used = "search";
    } else if (input.helpCategoryId) {
      q = q.where("helpCategoryIds", "array-contains", input.helpCategoryId);
      used = "category";
    } else if (input.flaggedOnly) {
      q = q.where("flagged", "==", true);
      used = "flagged";
    } else if (input.town) {
      q = q.where("town", "==", input.town);
      used = "town";
    }
    q = q.orderBy("sortName").orderBy(FieldPath.documentId());

    const matches = (d: ClientDoc) => {
      const tokens = (d.searchTokens as string[] | undefined) ?? [];
      if (words.slice(1).some((w) => !tokens.includes(w))) return false;
      if (used !== "category" && input.helpCategoryId && !d.helpCategoryIds?.includes(input.helpCategoryId)) return false;
      if (used !== "flagged" && input.flaggedOnly && !d.flagged) return false;
      if (used !== "town" && input.town && d.town !== input.town) return false;
      return true;
    };

    const items: ClientSummary[] = [];
    let cursor = decodeCursor(input.cursor);
    let exhausted = false;
    for (let round = 0; round < 5 && items.length < input.limit && !exhausted; round++) {
      let page = q.limit(input.limit * 2);
      if (cursor) page = page.startAfter(...cursor);
      const snap = await page.get();
      exhausted = snap.size < input.limit * 2;
      for (const doc of snap.docs) {
        cursor = [doc.get("sortName"), doc.id];
        const data = doc.data() as ClientDoc;
        if (!matches(data)) continue;
        items.push(summaryOut(ctx, doc.id, data));
        ctx.touched.add(doc.id);
        if (items.length >= input.limit) break;
      }
    }
    return { items, nextCursor: !exhausted || items.length >= input.limit ? encodeCursor(cursor ?? []) : undefined };
  },

  async "clients.get"(input, ctx) {
    const { client } = await clientFor(ctx, input.id, "read");
    return clientOut(ctx, input.id, client);
  },

  async "clients.create"(input, ctx) {
    const ref = db.collection(C.clients).doc();
    const now = Timestamp.now();
    const fields = Object.fromEntries(Object.entries(cleanInput(input)).filter(([, v]) => v !== null));
    const data = {
      ...fields,
      ...derived(fields as Partial<ClientDoc>),
      status: "active",
      questionSetIds: await defaultQuestionSetIds(),
      restrictions: [],
      openSafeguardingConcerns: 0,
      flagged: false,
      createdAt: now,
      createdBy: ctx.uid,
      updatedAt: now,
      lastActivityAt: now,
    };
    const batch = db.batch();
    batch.create(ref, data);
    await auditInBatch(batch, ctx, {
      action: "create",
      entity: "client",
      entityId: ref.id,
      clientIds: [ref.id],
      op: "clients.create",
      after: serialise(fields),
    });
    await batch.commit();
    return clientOut(ctx, ref.id, data as unknown as ClientDoc);
  },

  async "clients.update"(input, ctx) {
    const { snap, client } = await clientFor(ctx, input.id, "edit");
    const patch = cleanInput(input.patch);
    const merged = { ...client, ...patch } as ClientDoc;
    const update: Record<string, unknown> = { ...patch, ...derived(merged), updatedAt: FieldValue.serverTimestamp() };
    for (const key of CLEARABLE) {
      if (patch[key] === null) {
        update[key] = FieldValue.delete();
        delete merged[key];
      }
    }
    const batch = db.batch();
    batch.update(snap.ref, update);
    const before = serialise<Record<string, unknown>>(Object.fromEntries(Object.keys(patch).map((k) => [k, client[k]])));
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "client",
      entityId: input.id,
      clientIds: [input.id],
      op: "clients.update",
      ...changedFields(before, serialise(patch)),
    });
    await batch.commit();
    return clientOut(ctx, input.id, { ...merged, ...derived(merged), updatedAt: Timestamp.now() } as ClientDoc);
  },

  async "clients.setQuestionSet"(input, ctx) {
    const { snap, client } = await clientFor(ctx, input.clientId, "edit");
    const set = await db.collection(C.questionSets).doc(input.setId).get();
    if (!set.exists || set.get("kind") !== "questionnaire") throw fail.notFound("Questionnaire");
    if (set.get("sensitive") && !ctx.can("questionnaires.viewSensitive")) throw fail.denied();
    const ids = new Set(client.questionSetIds ?? []);
    if (input.attached) ids.add(input.setId);
    else ids.delete(input.setId);
    const questionSetIds = [...ids];
    const batch = db.batch();
    batch.update(snap.ref, { questionSetIds, updatedAt: FieldValue.serverTimestamp() });
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "client",
      entityId: input.clientId,
      clientIds: [input.clientId],
      op: "clients.setQuestionSet",
      before: { questionSetIds: client.questionSetIds ?? [] },
      after: { questionSetIds },
    });
    await batch.commit();
    return clientOut(ctx, input.clientId, { ...client, questionSetIds });
  },

  async "clients.export"(input, ctx) {
    const { client } = await loadClient(input.id);
    ctx.touched.add(input.id);
    const byClient = (col: string) => db.collection(col).where("clientId", "==", input.id).get();
    const [answers, sessions, callbacks, notes, files, outcomes, consents, safeguarding] = await Promise.all([
      byClient(C.answers),
      byClient(C.sessions),
      byClient(C.callbacks),
      byClient(C.notes),
      byClient(C.files),
      byClient(C.outcomes),
      byClient(C.consents),
      byClient(C.safeguarding),
    ]);
    const fileRecords = await Promise.all(
      files.docs
        .filter((d) => d.get("status") === "ready")
        .map(async (d) => ({ ...docOut<ClientExport["files"][number]>(d, ["storagePath"]), downloadUrl: await signedDownloadUrl(d.get("storagePath"), d.get("fileName")) })),
    );
    // Respect the finer permissions: sensitive sets and safeguarding are
    // included only for people allowed to see them.
    const sensitive = new Set(
      ctx.can("questionnaires.viewSensitive")
        ? []
        : (await db.collection(C.questionSets).where("sensitive", "==", true).get()).docs.map((d) => d.id),
    );
    const visible = (d: FirebaseFirestore.QueryDocumentSnapshot) => !sensitive.has(d.get("setId"));
    return {
      exportedAt: new Date().toISOString(),
      client: clientOut(ctx, input.id, client),
      answers: answers.docs.filter(visible).map((d) => docOut(d)),
      sessions: sessions.docs.map((d) => docOut(d)),
      callbacks: callbacks.docs.map((d) => docOut(d)),
      notes: notes.docs.map((d) => docOut(d)),
      files: fileRecords,
      outcomes: outcomes.docs.filter(visible).map((d) => docOut(d)),
      consents: consents.docs.map((d) => docOut(d)),
      safeguarding: ctx.can("safeguarding.view") ? safeguarding.docs.map((d) => docOut(d)) : [],
    };
  },

  async "clients.anonymise"(input, ctx) {
    await anonymiseClient(input.id, ctx, input.basis);
    return { ok: true };
  },
};
