import { describe, expect, it } from "vitest";
import { hasPermission } from "./permissions";

describe("hasPermission", () => {
  const held = ["clients.view", "sessions.manage"] as const;
  it("allows when nothing is required", () => expect(hasPermission([], undefined)).toBe(true));
  it("checks a single permission", () => {
    expect(hasPermission([...held], "clients.view")).toBe(true);
    expect(hasPermission([...held], "audit.view")).toBe(false);
  });
  it("needs all of an array", () => {
    expect(hasPermission([...held], ["clients.view", "sessions.manage"])).toBe(true);
    expect(hasPermission([...held], ["clients.view", "audit.view"])).toBe(false);
  });
  it("needs one of any", () => {
    expect(hasPermission([...held], { any: ["audit.view", "sessions.manage"] })).toBe(true);
    expect(hasPermission([...held], { any: ["audit.view"] })).toBe(false);
  });
  it("denies without a permission list", () => expect(hasPermission(undefined, "clients.view")).toBe(false));
});
