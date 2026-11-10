import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentProject } from "./project.js";
import { initials, placeholderLogo, seedWithName, themeTemplate } from "./site.js";

describe("site templates", () => {
  it("makes initials from a charity name", () => {
    expect(initials("Riverside & District Community Trust")).toBe("RD");
    expect(initials("The Friends of the Park")).toBe("FP");
    expect(initials("")).toBe("C");
  });

  it("escapes the name in the placeholder logo", () => {
    expect(placeholderLogo("A & B <C>")).toContain('aria-label="A &amp; B &lt;C&gt;"');
  });

  it("puts the name in the theme and seed", () => {
    expect(themeTemplate('My "Charity"')).toContain('appName: "My \\"Charity\\""');
    const seed = JSON.parse(seedWithName(JSON.stringify({ org: { retentionMonths: 36 }, helpCategories: [] }), "My Charity"));
    expect(seed.org).toEqual({ retentionMonths: 36, name: "My Charity" });
    expect(seed.helpCategories).toEqual([]);
  });
});

describe("currentProject", () => {
  it("reads .firebaserc and ignores the example", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccm-rc-"));
    expect(currentProject(dir)).toBeUndefined();
    writeFileSync(join(dir, ".firebaserc"), JSON.stringify({ projects: { default: "your-firebase-project-id" } }));
    expect(currentProject(dir)).toBeUndefined();
    writeFileSync(join(dir, ".firebaserc"), JSON.stringify({ projects: { default: "my-charity" } }));
    expect(currentProject(dir)).toBe("my-charity");
  });
});
