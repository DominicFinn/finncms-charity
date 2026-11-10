/**
 * Small, single-purpose wrappers around gcloud, the Firebase CLI and Google
 * REST APIs. Each one either checks something or changes one thing. They all
 * take an Exec, so tests can replace the real commands.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Exec } from "./exec.js";

/** The region the code is built for. Changing it needs code changes too: see docs/deploy.md. */
export const REGION = "europe-west2";

/** Google Cloud APIs the system uses. */
export const REQUIRED_APIS = [
  "cloudfunctions.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "run.googleapis.com",
  "eventarc.googleapis.com",
  "pubsub.googleapis.com",
  "cloudscheduler.googleapis.com",
  "secretmanager.googleapis.com",
  "storage.googleapis.com",
  "firebasestorage.googleapis.com",
  "iamcredentials.googleapis.com",
  "identitytoolkit.googleapis.com",
  "firestore.googleapis.com",
] as const;

/** HTTP functions that must be callable by anyone (they do their own checks). Cloud Run service names are lower case. */
export const PUBLIC_SERVICES = ["api", "mcp", "referralsintake", "collect", "calendaroauthcallback"] as const;

export const OAUTH_SECRET = "GOOGLE_OAUTH_CLIENT_SECRET";

const ok = (code: number) => code === 0;

// Prerequisites

/** Google Cloud Shell sets CLOUD_SHELL=true. It's already signed in to gcloud and has credentials for programs. */
export function inCloudShell(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLOUD_SHELL === "true";
}

export function nodeMajor(version = process.versions.node): number {
  return Number(version.split(".")[0]);
}

export function firebaseVersion(x: Exec): string | null {
  const r = x.run("firebase", ["--version"]);
  return ok(r.code) ? r.stdout.trim() : null;
}

/** The account gcloud is signed in as, or null. */
export function gcloudAccount(x: Exec): string | null {
  const r = x.run("gcloud", ["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"]);
  const account = r.stdout.trim().split("\n")[0];
  return ok(r.code) && account ? account : null;
}

/** Whether application default credentials are set up. The seed script needs them. */
export function hasAdc(x: Exec): boolean {
  return ok(x.run("gcloud", ["auth", "application-default", "print-access-token"]).code);
}

// Project

export function projectNumber(x: Exec, project: string): string | null {
  const r = x.run("gcloud", ["projects", "describe", project, "--format=value(projectNumber)"]);
  return ok(r.code) && r.stdout.trim() ? r.stdout.trim() : null;
}

export function isFirebaseProject(x: Exec, project: string): boolean {
  const r = x.run("firebase", ["projects:list", "--json"]);
  if (!ok(r.code)) return false;
  try {
    const list = JSON.parse(r.stdout) as { result?: { projectId: string }[] };
    return (list.result ?? []).some((p) => p.projectId === project);
  } catch {
    return false;
  }
}

export function createFirebaseProject(x: Exec, project: string, displayName: string): boolean {
  return ok(x.run("firebase", ["projects:create", project, "--display-name", displayName.slice(0, 30)], { stream: true }).code);
}

/** Adds Firebase to an existing Google Cloud project. */
export function addFirebase(x: Exec, project: string): boolean {
  return ok(x.run("firebase", ["projects:addfirebase", project], { stream: true }).code);
}

export function billingEnabled(x: Exec, project: string): boolean {
  const r = x.run("gcloud", ["billing", "projects", "describe", project, "--format=value(billingEnabled)"]);
  return ok(r.code) && r.stdout.trim().toLowerCase() === "true";
}

// APIs

export function enabledApis(x: Exec, project: string): Set<string> {
  const r = x.run("gcloud", ["services", "list", "--enabled", "--project", project, "--format=value(config.name)"]);
  return new Set(ok(r.code) ? r.stdout.split("\n").map((s) => s.trim()).filter(Boolean) : []);
}

export function enableApis(x: Exec, project: string, apis: string[]): boolean {
  if (apis.length === 0) return true;
  return ok(x.run("gcloud", ["services", "enable", ...apis, "--project", project], { stream: true }).code);
}

// Firestore and Storage

export function firestoreExists(x: Exec, project: string): boolean {
  return ok(x.run("gcloud", ["firestore", "databases", "describe", "--database=(default)", "--project", project, "--format=value(name)"]).code);
}

export function createFirestore(x: Exec, project: string): boolean {
  return ok(x.run("gcloud", ["firestore", "databases", "create", `--location=${REGION}`, "--project", project], { stream: true }).code);
}

const storageApi = (project: string) => `https://firebasestorage.googleapis.com/v1beta/projects/${project}/defaultBucket`;

/** The default Firebase Storage bucket name, or null if there isn't one. */
export async function defaultBucket(x: Exec, project: string): Promise<string | null> {
  const r = await x.http("GET", storageApi(project), { project });
  if (r.status !== 200) return null;
  const name = (r.body as { bucket?: { name?: string } }).bucket?.name;
  return name ? name.split("/").pop()! : null;
}

export async function createDefaultBucket(x: Exec, project: string): Promise<string | null> {
  const r = await x.http("POST", storageApi(project), { project, body: { location: REGION } });
  if (r.status !== 200) return null;
  const name = (r.body as { bucket?: { name?: string } }).bucket?.name;
  return name ? name.split("/").pop()! : null;
}

export function corsRule(origins: string[]) {
  return [{ origin: origins, method: ["PUT", "GET"], responseHeader: ["Content-Type"], maxAgeSeconds: 3600 }];
}

export function setBucketCors(x: Exec, bucket: string, origins: string[]): boolean {
  const dir = mkdtempSync(join(tmpdir(), "ccm-cors-"));
  const file = join(dir, "cors.json");
  writeFileSync(file, JSON.stringify(corsRule(origins)));
  return ok(x.run("gcloud", ["storage", "buckets", "update", `gs://${bucket}`, `--cors-file=${file}`]).code);
}

export function bucketCorsOrigins(x: Exec, bucket: string): string[] {
  const r = x.run("gcloud", ["storage", "buckets", "describe", `gs://${bucket}`, "--format=json(cors_config)"]);
  if (!ok(r.code)) return [];
  try {
    const cors = (JSON.parse(r.stdout) as { cors_config?: { origin?: string[] }[] }).cors_config ?? [];
    return cors.flatMap((c) => c.origin ?? []);
  } catch {
    return [];
  }
}

// Service account that signs file URLs

export const computeServiceAccount = (projectNumberValue: string) => `${projectNumberValue}-compute@developer.gserviceaccount.com`;

export function hasTokenCreator(x: Exec, project: string, sa: string): boolean {
  const r = x.run("gcloud", ["iam", "service-accounts", "get-iam-policy", sa, "--project", project, "--format=json"]);
  if (!ok(r.code)) return false;
  try {
    const policy = JSON.parse(r.stdout) as { bindings?: { role: string; members: string[] }[] };
    return (policy.bindings ?? []).some((b) => b.role === "roles/iam.serviceAccountTokenCreator" && b.members.includes(`serviceAccount:${sa}`));
  } catch {
    return false;
  }
}

export function grantTokenCreator(x: Exec, project: string, sa: string): boolean {
  return ok(
    x.run("gcloud", [
      "iam",
      "service-accounts",
      "add-iam-policy-binding",
      sa,
      `--member=serviceAccount:${sa}`,
      "--role=roles/iam.serviceAccountTokenCreator",
      "--project",
      project,
      "--format=none",
    ]).code,
  );
}

// Secrets and web app

export function secretExists(x: Exec, project: string, name = OAUTH_SECRET): boolean {
  return ok(x.run("gcloud", ["secrets", "describe", name, "--project", project, "--format=value(name)"]).code);
}

/** Sets the calendar OAuth secret to a placeholder, so the functions deploy before calendar sync is set up. */
export function setPlaceholderSecret(x: Exec, project: string, name = OAUTH_SECRET): boolean {
  return ok(
    x.run("firebase", ["functions:secrets:set", name, "--project", project, "--data-file=-", "--non-interactive", "--force"], {
      input: "not-configured",
    }).code,
  );
}

export function hasWebApp(x: Exec, project: string): boolean {
  const r = x.run("firebase", ["apps:list", "WEB", "--project", project, "--json"]);
  if (!ok(r.code)) return false;
  try {
    return ((JSON.parse(r.stdout) as { result?: unknown[] }).result ?? []).length > 0;
  } catch {
    return false;
  }
}

export function createWebApp(x: Exec, project: string, name: string): boolean {
  return ok(x.run("firebase", ["apps:create", "WEB", name, "--project", project, "--non-interactive"]).code);
}

// Authentication

const authConfigUrl = (project: string) => `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;

/** Authorised domains, or null when Authentication hasn't been started in the console yet. */
export async function authorizedDomains(x: Exec, project: string): Promise<string[] | null> {
  const r = await x.http("GET", authConfigUrl(project), { project });
  if (r.status !== 200) return null;
  return (r.body as { authorizedDomains?: string[] }).authorizedDomains ?? [];
}

export async function setAuthorizedDomains(x: Exec, project: string, domains: string[]): Promise<boolean> {
  const r = await x.http("PATCH", `${authConfigUrl(project)}?updateMask=authorizedDomains`, { project, body: { authorizedDomains: domains } });
  return r.status === 200;
}

/** Whether the Google sign in provider is on, and the OAuth client it uses. */
export async function googleSignIn(x: Exec, project: string): Promise<{ enabled: boolean; clientId?: string }> {
  const r = await x.http("GET", `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/defaultSupportedIdpConfigs/google.com`, { project });
  if (r.status !== 200) return { enabled: false };
  const body = r.body as { enabled?: boolean; clientId?: string };
  return { enabled: body.enabled === true, clientId: body.clientId };
}

// Functions

/** Public services missing from Cloud Run, or present but not callable by everyone. */
export function servicesNotPublic(x: Exec, project: string, services: readonly string[] = PUBLIC_SERVICES): string[] {
  const missing: string[] = [];
  for (const s of services) {
    const r = x.run("gcloud", ["run", "services", "get-iam-policy", s, "--region", REGION, "--project", project, "--format=json"]);
    if (!ok(r.code)) {
      missing.push(s);
      continue;
    }
    try {
      const policy = JSON.parse(r.stdout) as { bindings?: { role: string; members: string[] }[] };
      const isPublic = (policy.bindings ?? []).some((b) => b.role === "roles/run.invoker" && b.members.includes("allUsers"));
      if (!isPublic) missing.push(s);
    } catch {
      missing.push(s);
    }
  }
  return missing;
}

export function setArtifactCleanup(x: Exec, project: string): boolean {
  return ok(x.run("firebase", ["functions:artifacts:setpolicy", "--location", REGION, "--days", "7", "--force", "--project", project]).code);
}
