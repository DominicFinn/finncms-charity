import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

if (getApps().length === 0) initializeApp();

export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

export const bucket = () => getStorage().bucket();

export const REGION = "europe-west2";

export const isEmulator = () => process.env.FUNCTIONS_EMULATOR === "true";

/** Collection names in one place. */
export const C = {
  users: "users",
  roles: "roles",
  config: "config",
  clients: "clients",
  clientKeys: "clientKeys",
  questions: "questions",
  questionSets: "questionSets",
  answers: "answers",
  helpCategories: "helpCategories",
  sessionTypes: "sessionTypes",
  sessionLocations: "sessionLocations",
  sessions: "sessions",
  callbacks: "callbacks",
  notes: "notes",
  files: "files",
  outcomes: "outcomes",
  consents: "consents",
  safeguarding: "safeguarding",
  audit: "audit",
  notifications: "notifications",
  apiTokens: "apiTokens",
  calendarTokens: "calendarTokens",
  oauthStates: "oauthStates",
} as const;

export { Timestamp };

export function toIso(v: unknown): string | undefined {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return undefined;
}

export function fromIso(v: string): Timestamp;
export function fromIso(v: string | undefined): Timestamp | undefined;
export function fromIso(v: string | undefined): Timestamp | undefined {
  return v ? Timestamp.fromDate(new Date(v)) : undefined;
}

/** Recursively converts Timestamps to ISO strings for the wire. */
export function serialise<T>(value: unknown): T {
  if (value instanceof Timestamp) return value.toDate().toISOString() as T;
  if (Array.isArray(value)) return value.map((v) => serialise(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || v === null) continue;
      out[k] = serialise(v);
    }
    return out as T;
  }
  return value as T;
}

/** Document to wire record with its id, dropping server-only fields. */
export function docOut<T>(snap: DocumentSnapshot, omit: string[] = []): T {
  const data = { ...(snap.data() ?? {}) };
  for (const key of [...omit, ...SERVER_ONLY_FIELDS]) delete data[key];
  return serialise<T>({ id: snap.id, ...data });
}

/** Fields kept on documents for queries and housekeeping, never returned. */
const SERVER_ONLY_FIELDS = ["searchTokens", "sortName", "dims", "calendarSync", "reminderSentAt", "overdueNotifiedAt", "retentionWarnedAt", "anonymised", "flagged"];

export function newId(collection: string): string {
  return db.collection(collection).doc().id;
}
