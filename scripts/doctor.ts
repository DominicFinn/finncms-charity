/**
 * Checks a project without changing anything, and says what's missing.
 *
 *   npm run doctor
 *   npm run doctor -- --project my-charity-contacts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import * as cloud from "./lib/cloud.js";
import { realExec as x, REPO_ROOT } from "./lib/exec.js";
import * as plan from "./lib/plan.js";
import { currentProject } from "./lib/project.js";

const { values } = parseArgs({ options: { project: { type: "string" } } });
const project = values.project ?? currentProject();
if (!project) {
  console.log("No project set. Run npm run setup first, or pass --project <id>.");
  process.exit(1);
}

let problems = 0;
const check = (good: boolean, okText: string, badText: string) => {
  console.log(`${good ? "  ok  " : "  !!  "} ${good ? okText : badText}`);
  if (!good) problems++;
};

console.log(`Checking ${project}\n`);
check(cloud.nodeMajor() >= 24, `Node ${process.versions.node}`, `Node ${process.versions.node} is too old. Install Node 24 or later.`);
check(cloud.firebaseVersion(x) !== null, "Firebase CLI installed", "Firebase CLI missing: run npm install in this folder");
check(cloud.gcloudAccount(x) !== null, "gcloud signed in", "gcloud not signed in: gcloud auth login");
check(cloud.inCloudShell() || cloud.hasAdc(x), "Application default credentials set", "No application default credentials (needed to seed): gcloud auth application-default login");

const number = cloud.projectNumber(x, project);
check(number !== null, "Project found", `Can't read project ${project}`);
if (number) {
  check(cloud.billingEnabled(x, project), "Billing linked", `Billing not linked: https://console.firebase.google.com/project/${project}/usage/details`);
  const missing = plan.missingApis(cloud.enabledApis(x, project));
  check(missing.length === 0, "Cloud services on", `Services off: ${missing.join(", ")}. Run npm run setup.`);
  check(cloud.firestoreExists(x, project), "Database exists", "No database. Run npm run setup.");
  const bucket = await cloud.defaultBucket(x, project);
  check(bucket !== null, `File storage: ${bucket}`, "No file storage bucket. Run npm run setup.");

  const envPath = join(REPO_ROOT, `functions/.env.${project}`);
  const env = existsSync(envPath) ? plan.parseEnv(readFileSync(envPath, "utf8")) : null;
  check(env !== null, `functions/.env.${project} exists`, `functions/.env.${project} is missing. Run npm run setup.`);
  const domainFromEnv = env?.APP_URL ? plan.cleanDomain(env.APP_URL) : undefined;
  const customDomain = domainFromEnv && !domainFromEnv.endsWith(".web.app") ? domainFromEnv : undefined;
  const origins = plan.appOrigins({ project, customDomain });
  if (bucket) check(!plan.needsCors(cloud.bucketCorsOrigins(x, bucket), origins), "Uploads allowed from the app", "Uploads not allowed from every app address. Run npm run setup.");
  check(cloud.hasTokenCreator(x, project, cloud.computeServiceAccount(number)), "Functions can sign file links", "Functions can't sign file links. Run npm run setup.");
  check(cloud.secretExists(x, project), "Calendar secret set", "Calendar secret missing. Run npm run setup.");
  check(cloud.hasWebApp(x, project), "Web app registered", "No web app registered. Run npm run setup.");

  const notPublic = cloud.servicesNotPublic(x, project);
  check(notPublic.length === 0, "Functions deployed and reachable", `Not deployed or not reachable: ${notPublic.join(", ")}. Run npm run deploy.`);

  const google = await cloud.googleSignIn(x, project);
  check(google.enabled, "Google sign in on", `Google sign in is off: https://console.firebase.google.com/project/${project}/authentication/providers`);
  const domains = await cloud.authorizedDomains(x, project);
  const wanted = plan.appDomains({ project, customDomain });
  check(domains !== null && !plan.mergeDomains(domains, wanted).changed, "Sign in allowed from the app's addresses", "Sign in not allowed from every app address. Run npm run setup.");

  console.log("\nCan't be checked automatically: the OAuth client must list each https://<your domain> origin and");
  console.log("https://<your domain>/__/auth/handler redirect, or sign in fails with redirect_uri_mismatch. See docs/deploy.md.");
}

console.log(problems ? `\n${problems} thing${problems === 1 ? "" : "s"} to fix.` : "\nEverything checked looks right.");
process.exit(problems ? 1 : 0);
