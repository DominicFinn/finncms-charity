import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./exec.js";

/** The default project from .firebaserc, ignoring the example placeholder. */
export function currentProject(root = REPO_ROOT): string | undefined {
  const path = join(root, ".firebaserc");
  if (!existsSync(path)) return undefined;
  try {
    const id = (JSON.parse(readFileSync(path, "utf8")) as { projects?: { default?: string } }).projects?.default;
    return id && id !== "your-firebase-project-id" ? id : undefined;
  } catch {
    return undefined;
  }
}
