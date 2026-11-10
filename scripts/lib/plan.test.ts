import { describe, expect, it } from "vitest";
import { REQUIRED_APIS } from "./cloud.js";
import * as plan from "./plan.js";

const answers: plan.SetupAnswers = { project: "my-charity", orgName: "My Charity", superUserEmail: "me@example.org", seed: "default" };

describe("answers", () => {
  it("checks project ids", () => {
    expect(plan.validProjectId("my-charity-contacts")).toBe(true);
    expect(plan.validProjectId("My-Charity")).toBe(false);
    expect(plan.validProjectId("abc")).toBe(false);
    expect(plan.validProjectId("1charity")).toBe(false);
    expect(plan.validProjectId("charity-")).toBe(false);
  });

  it("checks emails", () => {
    expect(plan.validEmail("me@example.org")).toBe(true);
    expect(plan.validEmail("me@example")).toBe(false);
  });

  it("cleans a domain someone pasted as a URL", () => {
    expect(plan.cleanDomain(" https://Contacts.Example.org/ ")).toBe("contacts.example.org");
  });
});

describe("addresses", () => {
  it("lists the Firebase addresses, plus the custom domain", () => {
    expect(plan.appDomains(answers)).toEqual(["my-charity.web.app", "my-charity.firebaseapp.com"]);
    expect(plan.appDomains({ ...answers, customDomain: "https://contacts.example.org" })).toContain("contacts.example.org");
    expect(plan.appOrigins(answers)[0]).toBe("https://my-charity.web.app");
  });

  it("uses the custom domain for links when there is one", () => {
    expect(plan.appUrl(answers)).toBe("https://my-charity.web.app");
    expect(plan.appUrl({ ...answers, customDomain: "contacts.example.org" })).toBe("https://contacts.example.org");
  });
});

describe("what needs changing", () => {
  it("finds APIs that are off", () => {
    expect(plan.missingApis(new Set(REQUIRED_APIS))).toEqual([]);
    expect(plan.missingApis(new Set(["firestore.googleapis.com"]))).toContain("run.googleapis.com");
  });

  it("adds sign in domains without removing any", () => {
    expect(plan.mergeDomains(["localhost", "a.web.app"], ["a.web.app", "b.org"])).toEqual({ domains: ["localhost", "a.web.app", "b.org"], changed: true });
    expect(plan.mergeDomains(["a.web.app"], ["a.web.app"]).changed).toBe(false);
  });

  it("only updates CORS when an origin is missing", () => {
    expect(plan.needsCors(["https://a", "https://b"], ["https://a"])).toBe(false);
    expect(plan.needsCors([], ["https://a"])).toBe(true);
  });
});

describe("settings files", () => {
  it("writes a new functions settings file", () => {
    const text = plan.functionsEnv(null, answers);
    expect(plan.parseEnv(text)).toEqual({ BOOTSTRAP_SUPERUSER_EMAIL: "me@example.org", APP_URL: "https://my-charity.web.app", GOOGLE_OAUTH_CLIENT_ID: "" });
  });

  it("keeps values someone changed, and anything extra", () => {
    const existing = "BOOTSTRAP_SUPERUSER_EMAIL=boss@example.org\nAPP_URL=https://contacts.example.org\nGOOGLE_OAUTH_CLIENT_ID=abc.apps.googleusercontent.com\nEXTRA=1\n";
    const env = plan.parseEnv(plan.functionsEnv(existing, answers));
    expect(env.BOOTSTRAP_SUPERUSER_EMAIL).toBe("boss@example.org");
    expect(env.APP_URL).toBe("https://contacts.example.org");
    expect(env.GOOGLE_OAUTH_CLIENT_ID).toBe("abc.apps.googleusercontent.com");
    expect(env.EXTRA).toBe("1");
  });

  it("replaces the example placeholders", () => {
    const env = plan.parseEnv(plan.functionsEnv("BOOTSTRAP_SUPERUSER_EMAIL=you@example.org\nAPP_URL=https://your-project.web.app\n", answers));
    expect(env.BOOTSTRAP_SUPERUSER_EMAIL).toBe("me@example.org");
    expect(env.APP_URL).toBe("https://my-charity.web.app");
  });

  it("writes .firebaserc", () => {
    expect(JSON.parse(plan.firebaserc("my-charity"))).toEqual({ projects: { default: "my-charity" } });
  });
});

describe("deploy retries", () => {
  it("retries the failures a new project often has", () => {
    expect(plan.isRetryableDeployError("Permission denied while using the Eventarc Service Agent")).toBe(true);
    expect(plan.isRetryableDeployError("HTTP Error: 409, Could not create bucket gcf-v2-sources-123-europe-west2")).toBe(true);
    expect(plan.isRetryableDeployError("HTTP Error: 409, unable to queue the operation")).toBe(true);
    expect(plan.isRetryableDeployError("Upload Error: Failed to make request to https://storage.googleapis.com/x")).toBe(true);
  });

  it("doesn't retry real mistakes", () => {
    expect(plan.isRetryableDeployError("error TS2304: Cannot find name 'foo'")).toBe(false);
    expect(plan.isRetryableDeployError("Authentication Error: Your credentials are no longer valid")).toBe(false);
  });
});

describe("manual steps", () => {
  it("asks for Google sign in only when it's off", () => {
    const off = plan.manualSteps({ project: "p", domains: ["p.web.app"], googleSignIn: false });
    const on = plan.manualSteps({ project: "p", domains: ["p.web.app"], googleSignIn: true });
    expect(off[0].title).toBe("Turn on Google sign in");
    expect(on.map((s) => s.title)).not.toContain("Turn on Google sign in");
  });

  it("lists every origin and redirect for the OAuth client, with a direct link", () => {
    const steps = plan.manualSteps({ project: "p", domains: ["p.web.app", "p.firebaseapp.com", "c.example.org"], googleSignIn: true, oauthClientId: "123.apps" });
    const oauth = steps.find((s) => s.title.startsWith("Allow sign in"))!;
    expect(oauth.link).toBe("https://console.cloud.google.com/auth/clients/123.apps?project=p");
    expect(oauth.detail).toContain("https://c.example.org/__/auth/handler");
    expect(oauth.detail).toContain("https://p.web.app");
    expect(oauth.detail).not.toContain("firebaseapp.com");
  });

  it("includes the custom domain step only with a custom domain", () => {
    expect(plan.manualSteps({ project: "p", domains: [], googleSignIn: true, customDomain: "c.org" }).some((s) => s.title === "Connect c.org")).toBe(true);
    expect(plan.manualSteps({ project: "p", domains: [], googleSignIn: true }).some((s) => s.title.startsWith("Connect"))).toBe(false);
  });

  it("numbers the steps", () => {
    expect(plan.formatSteps([{ title: "A", detail: "x" }, { title: "B", detail: "y", link: "https://l" }])).toBe("1. A\n   x\n\n2. B\n   https://l\n   y");
  });
});
