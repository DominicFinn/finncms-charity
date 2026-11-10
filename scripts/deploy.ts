/**
 * Builds and deploys everything to the project in .firebaserc, retrying the
 * failures that clear up on their own.
 *
 *   npm run deploy
 *   npm run deploy -- --only functions
 *   npm run deploy -- --project another-project
 */
import { parseArgs } from "node:util";
import * as cloud from "./lib/cloud.js";
import { deployWithRetry } from "./lib/deploy.js";
import { realExec } from "./lib/exec.js";
import { currentProject } from "./lib/project.js";

const { values } = parseArgs({ options: { project: { type: "string" }, only: { type: "string" } } });
const project = values.project ?? currentProject();
if (!project) {
  console.log("No project set. Run npm run setup first, or pass --project <id>.");
  process.exit(1);
}

console.log(`Deploying to ${project}${values.only ? ` (${values.only} only)` : ""}. This usually takes a few minutes.`);
const ok = await deployWithRetry(realExec, { project, only: values.only });
if (!ok) {
  console.log("\nThe deploy failed. See docs/deploy.md, Troubleshooting.");
  process.exit(1);
}
if (!values.only || values.only.includes("functions")) {
  const notPublic = cloud.servicesNotPublic(realExec, project);
  if (notPublic.length) console.log(`\nWarning: these functions aren't reachable yet: ${notPublic.join(", ")}. Run npm run deploy again.`);
}
