import { describe, expect, it } from "vitest";
import { buildEnvProblem } from "./build-guard";

describe("buildEnvProblem", () => {
  it("stops a production build that uses the emulators", () => {
    expect(buildEnvProblem("production", { VITE_USE_EMULATORS: "true" })).toMatch(/\.env\.development\.local/);
  });

  it("allows emulators in development and normal production builds", () => {
    expect(buildEnvProblem("development", { VITE_USE_EMULATORS: "true" })).toBeNull();
    expect(buildEnvProblem("production", { VITE_USE_EMULATORS: "false" })).toBeNull();
    expect(buildEnvProblem("production", {})).toBeNull();
  });
});
