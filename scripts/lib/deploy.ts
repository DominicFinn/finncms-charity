import type { Exec } from "./exec.js";
import { isRetryableDeployError } from "./plan.js";

export interface DeployOptions {
  project: string;
  /** Firebase deploy --only value, such as "functions" or "hosting". */
  only?: string;
  /** Extra attempts after the first, for problems that clear up on their own. */
  retries?: number;
  waitMs?: number;
  log?: (msg: string) => void;
}

/**
 * Runs firebase deploy, retrying when the failure is one that clears up on
 * its own, such as permissions still being set up on a new project. The web
 * app and functions are built by the predeploy steps in firebase.json.
 */
export async function deployWithRetry(x: Exec, o: DeployOptions): Promise<boolean> {
  const retries = o.retries ?? 2;
  const waitMs = o.waitMs ?? 90_000;
  const log = o.log ?? console.log;
  const args = ["deploy", "--project", o.project, "--non-interactive", "--force", ...(o.only ? ["--only", o.only] : [])];

  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = x.run("firebase", args);
    const output = `${r.stdout}\n${r.stderr}`;
    if (r.code === 0) {
      log("  Deployed.");
      return true;
    }
    if (attempt < retries && isRetryableDeployError(output)) {
      log(`  Google is still setting things up on this project. Trying again in ${Math.round(waitMs / 1000)} seconds (attempt ${attempt + 2} of ${retries + 1}).`);
      await x.sleep(waitMs);
      continue;
    }
    log(lastLines(output, 25));
    return false;
  }
  return false;
}

export function lastLines(text: string, n: number): string {
  return text.trim().split("\n").slice(-n).join("\n");
}
