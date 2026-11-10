/**
 * Pure decisions for setup, deploy and doctor. No commands run here, so all
 * of it is unit tested.
 */
import { REQUIRED_APIS } from "./cloud.js";

export interface SetupAnswers {
  project: string;
  orgName: string;
  superUserEmail: string;
  /** A custom domain such as contacts.example.org, without https://. */
  customDomain?: string;
  /** default, ndie, or a path to a seed file. */
  seed: string;
}

/** Firebase project ids: 6 to 30 characters, lower case letters, digits and hyphens, starting with a letter. */
export function validProjectId(id: string): boolean {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id);
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Strips a scheme and trailing slash, so "https://x.org/" becomes "x.org". */
export function cleanDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/** Every address the app is served from. */
export function appDomains(a: Pick<SetupAnswers, "project" | "customDomain">): string[] {
  const list = [`${a.project}.web.app`, `${a.project}.firebaseapp.com`];
  if (a.customDomain) list.push(cleanDomain(a.customDomain));
  return [...new Set(list)];
}

export const appOrigins = (a: Pick<SetupAnswers, "project" | "customDomain">) => appDomains(a).map((d) => `https://${d}`);

/** The address used in links the app builds. The custom domain if there is one. */
export function appUrl(a: Pick<SetupAnswers, "project" | "customDomain">): string {
  return a.customDomain ? `https://${cleanDomain(a.customDomain)}` : `https://${a.project}.web.app`;
}

export const missingApis = (enabled: Set<string>) => REQUIRED_APIS.filter((a) => !enabled.has(a));

/** Domains to add to Firebase Auth, keeping any already there. */
export function mergeDomains(current: string[], wanted: string[]): { domains: string[]; changed: boolean } {
  const domains = [...current];
  for (const d of wanted) if (!domains.includes(d)) domains.push(d);
  return { domains, changed: domains.length !== current.length };
}

export function needsCors(current: string[], wanted: string[]): boolean {
  return wanted.some((o) => !current.includes(o));
}

/** Parses a simple KEY=value .env file. Comments and blank lines are kept separately by `writeEnv`. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * The functions settings file. Values already in the file win unless they're
 * empty or still the example placeholders, so running setup again never
 * overwrites a change someone made by hand.
 */
export function functionsEnv(existing: string | null, a: SetupAnswers): string {
  const old = existing ? parseEnv(existing) : {};
  const keep = (key: string, value: string, placeholders: string[] = []) =>
    old[key] && !placeholders.includes(old[key]) ? old[key] : value;
  const values = {
    BOOTSTRAP_SUPERUSER_EMAIL: keep("BOOTSTRAP_SUPERUSER_EMAIL", a.superUserEmail, ["you@example.org"]),
    APP_URL: keep("APP_URL", appUrl(a), ["https://your-project.web.app"]),
    GOOGLE_OAUTH_CLIENT_ID: old.GOOGLE_OAUTH_CLIENT_ID ?? "",
  };
  const extra = Object.entries(old).filter(([k]) => !(k in values));
  return [
    `# Settings for the ${a.project} Firebase project. No secrets go here.`,
    "# Written by npm run setup. Safe to edit; setup keeps your changes.",
    "",
    "# The first person to sign in with this address becomes the super user.",
    `BOOTSTRAP_SUPERUSER_EMAIL=${values.BOOTSTRAP_SUPERUSER_EMAIL}`,
    "",
    "# Where people open the app. Used in links in calendar events.",
    `APP_URL=${values.APP_URL}`,
    "",
    "# Only needed for Google Calendar sync. See docs/deploy.md.",
    `GOOGLE_OAUTH_CLIENT_ID=${values.GOOGLE_OAUTH_CLIENT_ID}`,
    ...extra.map(([k, v]) => `${k}=${v}`),
    "",
  ].join("\n");
}

export function firebaserc(project: string): string {
  return `${JSON.stringify({ projects: { default: project } }, null, 2)}\n`;
}

/**
 * Whether a failed deploy is worth retrying. The first 2nd gen functions
 * deploy on a new project often fails while Google sets up permissions, and a
 * deploy can collide with one still finishing.
 */
export function isRetryableDeployError(output: string): boolean {
  return [
    /Eventarc Service Agent/i,
    /Retry the deployment in a few minutes/i,
    /HTTP Error: 409/i,
    /unable to queue the operation/i,
    /Could not create bucket gcf-v2-sources/i,
    /HTTP Error: 429/i,
    /ECONNRESET|ETIMEDOUT|socket hang up|Failed to make request/i,
  ].some((r) => r.test(output));
}

export interface ManualStep {
  title: string;
  detail: string;
  link?: string;
}

export interface ManualContext {
  project: string;
  domains: string[];
  googleSignIn: boolean;
  oauthClientId?: string;
  customDomain?: string;
}

/** What's left to do by hand in the console, in order. */
export function manualSteps(c: ManualContext): ManualStep[] {
  const console = "https://console.firebase.google.com/project/" + c.project;
  const steps: ManualStep[] = [];
  if (!c.googleSignIn) {
    steps.push({
      title: "Turn on Google sign in",
      detail: "Click Get started if you see it, then Sign-in method > Add new provider > Google > Enable > Save.",
      link: `${console}/authentication/providers`,
    });
  }
  const clientLink = c.oauthClientId
    ? `https://console.cloud.google.com/auth/clients/${c.oauthClientId}?project=${c.project}`
    : `https://console.cloud.google.com/auth/clients?project=${c.project}`;
  steps.push({
    title: "Allow sign in from your app's address",
    detail: [
      'Open "Web client (auto created by Google Service)". Under Authorised JavaScript origins add:',
      ...c.domains.filter((d) => !d.endsWith(".firebaseapp.com")).map((d) => `    https://${d}`),
      "Under Authorised redirect URIs add:",
      ...c.domains.filter((d) => !d.endsWith(".firebaseapp.com")).map((d) => `    https://${d}/__/auth/handler`),
      "Then Save. Without this, sign in fails with redirect_uri_mismatch. Google has no API for this step.",
    ].join("\n"),
    link: clientLink,
  });
  if (c.customDomain) {
    steps.push({
      title: `Connect ${c.customDomain}`,
      detail: "Hosting > Add custom domain, then add the DNS records it shows at your domain provider. The certificate can take up to an hour.",
      link: `${console}/hosting/sites`,
    });
  }
  steps.push({
    title: "Set a budget alert",
    detail: "A small charity usually stays within the free allowances, but an alert tells you if something changes.",
    link: "https://console.cloud.google.com/billing/budgets",
  });
  steps.push({
    title: "Turn on Firestore backups",
    detail: "Firestore > Disaster recovery. Keep backups for as short a time as your data protection policy allows.",
    link: `${console}/firestore/databases/-default-/disaster-recovery`,
  });
  return steps;
}

export function formatSteps(steps: ManualStep[]): string {
  return steps
    .map((s, i) => [`${i + 1}. ${s.title}`, ...(s.link ? [`   ${s.link}`] : []), ...s.detail.split("\n").map((l) => `   ${l}`)].join("\n"))
    .join("\n\n");
}
