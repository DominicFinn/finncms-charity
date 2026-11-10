/**
 * The only place the setup tools touch the outside world: running gcloud,
 * firebase and npm, and calling Google REST APIs. Everything else takes an
 * `Exec` so it can be tested with a fake.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Text written to the command's standard input. */
  input?: string;
  /** Extra environment variables. */
  env?: Record<string, string>;
  /** Show the command's output as it runs, for long steps like deploys. */
  stream?: boolean;
  cwd?: string;
}

export interface HttpResult {
  status: number;
  body: unknown;
}

export interface Exec {
  run(cmd: string, args: string[], opts?: RunOptions): RunResult;
  /** Calls a Google API with the gcloud user's access token. */
  http(method: string, url: string, opts?: { project?: string; body?: unknown }): Promise<HttpResult>;
  sleep(ms: number): Promise<void>;
}

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const realExec: Exec = {
  run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, {
      cwd: opts.cwd ?? REPO_ROOT,
      input: opts.input,
      env: { ...process.env, ...opts.env },
      encoding: "utf8",
      stdio: opts.stream ? ["pipe", "inherit", "inherit"] : "pipe",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") return { code: 127, stdout: "", stderr: `${cmd} not found` };
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  },

  async http(method, url, opts = {}) {
    const token = realExec.run("gcloud", ["auth", "print-access-token"]).stdout.trim();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    if (opts.project) headers["x-goog-user-project"] = opts.project;
    const res = await fetch(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON; keep the text.
    }
    return { status: res.status, body };
  },

  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
