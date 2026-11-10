import { describe, expect, it } from "vitest";
import * as cloud from "./cloud.js";
import { deployWithRetry } from "./deploy.js";
import type { Exec, HttpResult, RunResult } from "./exec.js";

/** A fake Exec that answers commands from a list of rules and records every call. */
function fake(rules: { match: RegExp; result: Partial<RunResult> }[], http: Record<string, HttpResult> = {}) {
  const calls: string[] = [];
  const x: Exec = {
    run(cmd, args) {
      const line = [cmd, ...args].join(" ");
      calls.push(line);
      const rule = rules.find((r) => r.match.test(line));
      return { code: 0, stdout: "", stderr: "", ...rule?.result };
    },
    async http(method, url) {
      calls.push(`${method} ${url}`);
      return http[`${method} ${url}`] ?? { status: 404, body: null };
    },
    async sleep() {},
  };
  return { x, calls };
}

describe("checks", () => {
  it("recognises Google Cloud Shell", () => {
    expect(cloud.inCloudShell({ CLOUD_SHELL: "true" })).toBe(true);
    expect(cloud.inCloudShell({})).toBe(false);
  });

  it("reads Node's major version", () => {
    expect(cloud.nodeMajor("24.3.1")).toBe(24);
  });

  it("finds the signed in gcloud account", () => {
    expect(cloud.gcloudAccount(fake([{ match: /auth list/, result: { stdout: "me@example.org\n" } }]).x)).toBe("me@example.org");
    expect(cloud.gcloudAccount(fake([{ match: /auth list/, result: { stdout: "" } }]).x)).toBeNull();
    expect(cloud.gcloudAccount(fake([{ match: /auth list/, result: { code: 127 } }]).x)).toBeNull();
  });

  it("knows whether billing is linked", () => {
    expect(cloud.billingEnabled(fake([{ match: /billing/, result: { stdout: "True\n" } }]).x, "p")).toBe(true);
    expect(cloud.billingEnabled(fake([{ match: /billing/, result: { stdout: "False\n" } }]).x, "p")).toBe(false);
  });

  it("finds a Firebase project in the list", () => {
    const { x } = fake([{ match: /projects:list/, result: { stdout: JSON.stringify({ result: [{ projectId: "p" }] }) } }]);
    expect(cloud.isFirebaseProject(x, "p")).toBe(true);
    expect(cloud.isFirebaseProject(x, "q")).toBe(false);
  });

  it("checks the signing permission", () => {
    const sa = "1-compute@developer.gserviceaccount.com";
    const policy = { bindings: [{ role: "roles/iam.serviceAccountTokenCreator", members: [`serviceAccount:${sa}`] }] };
    expect(cloud.hasTokenCreator(fake([{ match: /get-iam-policy/, result: { stdout: JSON.stringify(policy) } }]).x, "p", sa)).toBe(true);
    expect(cloud.hasTokenCreator(fake([{ match: /get-iam-policy/, result: { stdout: "{}" } }]).x, "p", sa)).toBe(false);
  });

  it("lists functions that aren't public", () => {
    const isPublic = JSON.stringify({ bindings: [{ role: "roles/run.invoker", members: ["allUsers"] }] });
    const { x } = fake([
      { match: /get-iam-policy collect/, result: { stdout: "{}" } },
      { match: /get-iam-policy mcp/, result: { code: 1 } },
      { match: /get-iam-policy/, result: { stdout: isPublic } },
    ]);
    expect(cloud.servicesNotPublic(x, "p")).toEqual(["mcp", "collect"]);
  });

  it("reads the default bucket name", async () => {
    const url = "https://firebasestorage.googleapis.com/v1beta/projects/p/defaultBucket";
    const { x } = fake([], { [`GET ${url}`]: { status: 200, body: { bucket: { name: "projects/p/buckets/p.firebasestorage.app" } } } });
    expect(await cloud.defaultBucket(x, "p")).toBe("p.firebasestorage.app");
    expect(await cloud.defaultBucket(fake([]).x, "p")).toBeNull();
  });

  it("treats a missing Auth config as not started", async () => {
    expect(await cloud.authorizedDomains(fake([]).x, "p")).toBeNull();
  });

  it("writes a CORS rule for the app origins", () => {
    expect(cloud.corsRule(["https://a"])[0]).toMatchObject({ origin: ["https://a"], method: ["PUT", "GET"] });
  });
});

describe("deployWithRetry", () => {
  it("retries after a setting up error, then succeeds", async () => {
    let n = 0;
    const calls: string[] = [];
    const x: Exec = {
      run(cmd, args) {
        calls.push([cmd, ...args].join(" "));
        n++;
        return n === 1 ? { code: 1, stdout: "", stderr: "Permission denied while using the Eventarc Service Agent" } : { code: 0, stdout: "", stderr: "" };
      },
      http: async () => ({ status: 200, body: null }),
      sleep: async () => {},
    };
    expect(await deployWithRetry(x, { project: "p", log: () => {} })).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("deploy --project p --non-interactive --force");
  });

  it("gives up straight away on a real error", async () => {
    const { x, calls } = fake([{ match: /deploy/, result: { code: 1, stderr: "error TS2304" } }]);
    expect(await deployWithRetry(x, { project: "p", log: () => {} })).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("stops after the retries run out", async () => {
    const { x, calls } = fake([{ match: /deploy/, result: { code: 1, stderr: "HTTP Error: 409" } }]);
    expect(await deployWithRetry(x, { project: "p", only: "functions", retries: 2, log: () => {} })).toBe(false);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("--only functions");
  });
});
