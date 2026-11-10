/**
 * Sets up a Firebase project for the system and deploys it.
 *
 *   npm run setup
 *   npm run setup -- --project my-charity-contacts --name "My Charity" --email me@example.org
 *
 * Safe to run again: each step checks first and only changes what's missing.
 * When something has to be done by hand, it says what and where, and you run
 * it again afterwards.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import * as cloud from "./lib/cloud.js";
import { deployWithRetry } from "./lib/deploy.js";
import { type Exec, realExec, REPO_ROOT } from "./lib/exec.js";
import * as plan from "./lib/plan.js";
import { currentProject } from "./lib/project.js";

const { values: flags } = parseArgs({
  options: {
    project: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    domain: { type: "string" },
    seed: { type: "string" },
    create: { type: "boolean", default: false },
    yes: { type: "boolean", short: "y", default: false },
    "skip-deploy": { type: "boolean", default: false },
    "skip-seed": { type: "boolean", default: false },
  },
});

const x: Exec = realExec;
const say = (msg = "") => console.log(msg);
const step = (msg: string) => say(`\n> ${msg}`);
const done = (msg: string) => say(`  ${msg}`);

function stop(msg: string, code = 1): never {
  say(`\n${msg}\n`);
  process.exit(code);
}

const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;

async function ask(question: string, fallback?: string): Promise<string> {
  if (!rl || flags.yes) {
    if (fallback !== undefined) return fallback;
    stop(`Missing answer for "${question}". Pass it as a flag, for example --project, --name or --email.`);
  }
  const answer = (await rl.question(`  ${question}${fallback ? ` [${fallback}]` : ""}: `)).trim();
  return answer || fallback || "";
}

async function confirm(question: string): Promise<boolean> {
  if (flags.yes) return true;
  if (!rl) return false;
  return /^y/i.test((await rl.question(`  ${question} (y/n): `)).trim());
}

function defaultSeed(): string {
  return existsSync(join(REPO_ROOT, "site/seed.json")) ? "site/seed.json" : "default";
}

async function main() {
  say("Charity contact management: Firebase setup");
  say("This checks your project and sets up anything missing. It's safe to run again.");

  // 1. Prerequisites
  step("Checking your tools");
  const cloudShell = cloud.inCloudShell();
  if (cloud.nodeMajor() < 24) {
    stop(
      cloudShell
        ? `Cloud Shell is using Node ${process.versions.node}. Run:\n  nvm install 24\nthen run this again.`
        : `You have Node ${process.versions.node}. Install Node 24 or later from https://nodejs.org and run this again.`,
    );
  }
  done(`Node ${process.versions.node}`);
  const fbv = cloud.firebaseVersion(x);
  if (!fbv) stop("The Firebase CLI comes with this project. Run:\n  npm install\nthen run this again.");
  done(`Firebase CLI ${fbv}`);
  const account = cloud.gcloudAccount(x);
  if (!account) stop("The Google Cloud CLI isn't installed or isn't signed in.\nInstall it from https://cloud.google.com/sdk/docs/install, then run:\n  gcloud auth login\nand run this again.");
  done(`gcloud signed in as ${account}`);
  // Without `firebase login`, the Firebase CLI uses your Google Cloud credentials,
  // which Cloud Shell already has.
  if (x.run("firebase", ["projects:list", "--json"]).code !== 0) {
    stop(`The Firebase CLI couldn't sign in. Run:\n  npx firebase login${cloudShell ? " --no-localhost" : ""}\nand run this again.`);
  }
  done("Firebase CLI signed in");
  if (!cloudShell && !flags["skip-seed"] && !cloud.hasAdc(x)) {
    stop("Loading your starting lists needs your Google credentials saved for programs to use. Run:\n  gcloud auth application-default login\nand run this again.");
  }

  // 2. Answers. Only three questions; everything else has a default or a flag.
  step("About your charity");
  const suggested = currentProject() ?? (cloudShell ? process.env.GOOGLE_CLOUD_PROJECT || undefined : undefined);
  const project = flags.project ?? (await ask("Firebase project id (new or existing, e.g. riverside-contacts)", suggested));
  if (!plan.validProjectId(project)) stop(`"${project}" isn't a valid project id. Use 6 to 30 lower case letters, numbers and hyphens, starting with a letter.`);
  const orgName = flags.name ?? (await ask("Your charity's name"));
  const envPath = join(REPO_ROOT, `functions/.env.${project}`);
  const existingEnv = existsSync(envPath) ? readFileSync(envPath, "utf8") : null;
  const knownEmail = existingEnv ? plan.parseEnv(existingEnv).BOOTSTRAP_SUPERUSER_EMAIL : undefined;
  const superUserEmail = flags.email ?? (await ask("Google account of the first super user", knownEmail ?? account));
  if (!plan.validEmail(superUserEmail)) stop(`"${superUserEmail}" doesn't look like an email address.`);
  const knownUrl = existingEnv ? plan.parseEnv(existingEnv).APP_URL : undefined;
  const knownDomain = knownUrl && !/\.(web\.app|firebaseapp\.com)$/.test(plan.cleanDomain(knownUrl)) && !knownUrl.includes("your-project") ? plan.cleanDomain(knownUrl) : undefined;
  const customDomain = flags.domain ? plan.cleanDomain(flags.domain) : knownDomain;
  const seed = flags.seed ?? defaultSeed();
  done(`Starting lists: ${seed}${customDomain ? `. Custom domain: ${customDomain}` : ""}`);
  const answers: plan.SetupAnswers = { project, orgName, superUserEmail, customDomain, seed };

  // 3. Project
  step(`Firebase project ${project}`);
  if (cloud.isFirebaseProject(x, project)) {
    done("Found it.");
  } else if (cloud.projectNumber(x, project)) {
    done("It's a Google Cloud project without Firebase. Adding Firebase.");
    if (!cloud.addFirebase(x, project)) stop("Couldn't add Firebase to the project. Add it at https://console.firebase.google.com and run this again.");
  } else {
    if (!flags.create && !(await confirm(`There's no project called ${project}. Create it?`))) stop("Nothing changed. Choose an existing project id or allow it to be created.");
    if (!cloud.createFirebaseProject(x, project, orgName)) stop("Couldn't create the project. Project ids are global, so it may be taken. Try another id.");
    done("Created.");
  }
  const number = cloud.projectNumber(x, project);
  if (!number) stop(`Couldn't read project ${project}. Check you have access to it with gcloud projects describe ${project}.`);
  // Google client libraries using your own credentials need a project to bill API calls to.
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = project;

  // 4. Billing
  step("Billing");
  if (!cloud.billingEnabled(x, project)) {
    stop(
      [
        "Cloud Functions need the pay as you go (Blaze) plan. A small charity usually stays within the free allowances.",
        "Link a billing account here, then run npm run setup again:",
        `  https://console.firebase.google.com/project/${project}/usage/details`,
      ].join("\n"),
      2,
    );
  }
  done("Billing is linked.");

  // 5. APIs
  step("Turning on the Google Cloud services the system uses");
  const missing = plan.missingApis(cloud.enabledApis(x, project));
  if (missing.length === 0) done("All on already.");
  else if (!cloud.enableApis(x, project, missing)) stop("Couldn't turn on the services. Check billing is linked and run this again.");
  else done(`Turned on ${missing.length}.`);

  // 6. Database and file storage
  step(`Database in ${cloud.REGION} (London)`);
  if (cloud.firestoreExists(x, project)) done("Already there.");
  else if (cloud.createFirestore(x, project)) done("Created.");
  else stop("Couldn't create the database. Check the Firestore page in the Firebase console and run this again.");

  step("File storage");
  let bucket = await cloud.defaultBucket(x, project);
  if (bucket) done(`Already there: ${bucket}`);
  else {
    bucket = await cloud.createDefaultBucket(x, project);
    if (!bucket) stop(`Couldn't create the storage bucket. Open Storage in the Firebase console, click Get started, choose ${cloud.REGION}, and run this again.`);
    done(`Created ${bucket}.`);
  }
  const origins = plan.appOrigins(answers);
  if (plan.needsCors(cloud.bucketCorsOrigins(x, bucket), origins)) {
    if (!cloud.setBucketCors(x, bucket, origins)) stop("Couldn't set the upload rule on the bucket. Run this again.");
    done("Allowed uploads from the app's addresses.");
  } else done("Uploads already allowed from the app's addresses.");

  const sa = cloud.computeServiceAccount(number);
  if (cloud.hasTokenCreator(x, project, sa)) done("File links can already be signed.");
  else if (cloud.grantTokenCreator(x, project, sa)) done("Allowed the functions to sign file links.");
  else stop("Couldn't let the functions sign file links. See docs/deploy.md, Troubleshooting.");

  // 7. Settings files
  step("Settings files");
  writeFileSync(join(REPO_ROOT, ".firebaserc"), plan.firebaserc(project));
  writeFileSync(envPath, plan.functionsEnv(existingEnv, answers));
  done(`Wrote .firebaserc and functions/.env.${project}. Neither holds secrets.`);
  if (cloud.secretExists(x, project)) done("Calendar secret already set.");
  else if (cloud.setPlaceholderSecret(x, project)) done("Set a placeholder calendar secret. Replace it if you turn on calendar sync.");
  else stop("Couldn't set the calendar secret. Check Secret Manager is on and run this again.");
  if (cloud.hasWebApp(x, project)) done("Web app already registered.");
  else if (cloud.createWebApp(x, project, orgName)) done("Registered the web app.");
  else stop("Couldn't register the web app. Add one in Project settings > Your apps and run this again.");

  // 8. Deploy
  if (flags["skip-deploy"]) {
    step("Skipping the deploy, as asked.");
  } else {
    step("Deploying. The first time takes 5 to 10 minutes.");
    if (!(await deployWithRetry(x, { project, log: done }))) stop("The deploy failed. The error is above. Fix it and run npm run setup again, or npm run deploy.");
    if (cloud.setArtifactCleanup(x, project)) done("Old function builds will be deleted after 7 days, so they don't add to the bill.");
    const notPublic = cloud.servicesNotPublic(x, project);
    if (notPublic.length) {
      done(`Warning: these functions aren't reachable yet: ${notPublic.join(", ")}. Run npm run deploy again to fix it.`);
    }
  }

  // 9. Starting data
  if (flags["skip-seed"]) {
    step("Skipping the starting data, as asked.");
  } else {
    step(`Loading starting lists from ${seed}`);
    // The seed script runs from scripts/, so give it an absolute path for a file.
    const seedArg = seed.includes("/") && !isAbsolute(seed) ? resolve(REPO_ROOT, seed.replace(/^\.\.\//, "")) : seed;
    const r = x.run("npm", ["run", "seed", "-w", "scripts", "--", "--config", seedArg, "--project", project], {
      env: { GOOGLE_CLOUD_QUOTA_PROJECT: project },
      stream: true,
    });
    if (r.code !== 0) stop("Loading the starting lists failed. The error is above. Run npm run setup again once it's fixed.");
  }

  // 10. Sign in
  step("Sign in settings");
  const domains = plan.appDomains(answers);
  const current = await cloud.authorizedDomains(x, project);
  if (current === null) {
    done("Authentication isn't started yet, so sign in domains will be added next time you run setup.");
  } else {
    const merged = plan.mergeDomains(current, domains);
    if (!merged.changed) done("Sign in already allowed from the app's addresses.");
    else if (await cloud.setAuthorizedDomains(x, project, merged.domains)) done("Allowed sign in from the app's addresses.");
    else done("Couldn't update the sign in domains. Add them under Authentication > Settings > Authorised domains.");
  }
  const google = await cloud.googleSignIn(x, project);

  // 11. What's left
  const steps = plan.manualSteps({ project, domains, googleSignIn: google.enabled, oauthClientId: google.clientId, customDomain });
  say("\nAlmost there. These steps can only be done in the console:\n");
  say(plan.formatSteps(steps));
  say(`\nThen open ${plan.appUrl(answers)} and sign in as ${superUserEmail}. You'll be the super user.`);
  if (current === null) say("Run npm run setup again after turning on Google sign in, so it can add the sign in domains.");
  if (!customDomain) say("To use your own domain later, run: npm run setup -- --domain contacts.your-charity.org");
}

main()
  .catch((err) => stop(`Setup stopped: ${err instanceof Error ? err.message : String(err)}`))
  .finally(() => rl?.close());
