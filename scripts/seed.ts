/**
 * Loads roles and a seed configuration into Firestore.
 *
 *   npm run seed -- --config example                   # against the emulator
 *   npm run seed -- --config example --project my-proj # against a real project
 *
 * Existing documents are left alone, so it's safe to run again after an
 * administrator has changed things in the app. Pass --overwrite to replace
 * them with the seed values.
 *
 * For a real project, authenticate first with
 *   gcloud auth application-default login
 */
import { DEFAULT_ORG_SETTINGS, DEFAULT_ROLES, QUESTION_TYPES } from "@ccm/shared";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    config: { type: "string", default: "default" },
    project: { type: "string" },
    overwrite: { type: "boolean", default: false },
  },
});

if (!values.project) {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  console.log(`Seeding the emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`);
} else {
  console.log(`Seeding project ${values.project}`);
}

interface Seed {
  org?: Record<string, unknown>;
  helpCategories?: { id: string; name: string; description?: string }[];
  sessionTypes?: { id: string; name: string; inPerson: boolean }[];
  sessionLocations?: { id: string; name: string; isOther?: boolean }[];
  questions?: { id: string; text: string; type: string; options?: string[]; scale?: unknown; helpText?: string }[];
  questionSets?: { id: string; name: string; kind: string; sensitive?: boolean; attachByDefault?: boolean; questionIds: string[]; description?: string }[];
}

const path = values.config!.includes("/") ? values.config! : new URL(`../config/seed/${values.config}.json`, import.meta.url);
const seed = JSON.parse(readFileSync(path, "utf8")) as Seed;

// Basic checks so a typo in a seed file fails here rather than in the app.
const questionIds = new Set((seed.questions ?? []).map((q) => q.id));
for (const q of seed.questions ?? []) {
  if (!QUESTION_TYPES.includes(q.type as never)) throw new Error(`Question ${q.id} has unknown type ${q.type}`);
}
for (const s of seed.questionSets ?? []) {
  for (const id of s.questionIds) if (!questionIds.has(id)) throw new Error(`Set ${s.id} uses unknown question ${id}`);
}

initializeApp({ projectId: values.project ?? "demo-ccm" });
const db = getFirestore();
let written = 0;
let skipped = 0;

async function put(collection: string, id: string, data: Record<string, unknown>) {
  const ref = db.collection(collection).doc(id);
  if (!values.overwrite && (await ref.get()).exists) {
    skipped += 1;
    return;
  }
  await ref.set(data);
  written += 1;
}

for (const r of DEFAULT_ROLES) {
  await put("roles", r.id, { name: r.name, description: r.description, permissions: r.permissions, system: !!r.system });
}
await put("config", "org", { ...DEFAULT_ORG_SETTINGS, ...(seed.org ?? {}) });
for (const c of seed.helpCategories ?? []) await put("helpCategories", c.id, { name: c.name, description: c.description ?? null, archived: false });
for (const t of seed.sessionTypes ?? []) await put("sessionTypes", t.id, { name: t.name, inPerson: t.inPerson, archived: false });
for (const l of seed.sessionLocations ?? []) await put("sessionLocations", l.id, { name: l.name, isOther: !!l.isOther, archived: false });
for (const { id, ...q } of seed.questions ?? []) await put("questions", id, { ...q, archived: false });
for (const { id, ...s } of seed.questionSets ?? []) {
  await put("questionSets", id, { sensitive: false, attachByDefault: false, ...s, archived: false });
}

await db.collection("audit").add({
  at: Timestamp.now(),
  actorUid: "system",
  actorEmail: null,
  channel: "system",
  action: "create",
  entity: "seed",
  entityId: String(values.config),
  clientIds: [],
  clientId: null,
  op: "seed",
  detail: `Seed "${values.config}" loaded: ${written} written, ${skipped} left as they were`,
});

console.log(`Done. ${written} documents written, ${skipped} already existed and were left alone.`);
