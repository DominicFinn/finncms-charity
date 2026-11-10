/**
 * Checks the site theme in site/theme.ts, if there is one. Run it with
 * npm run site:check. It fails with a plain message for each text colour that
 * would be hard to read.
 */
import { describe, expect, it } from "vitest";
import { contrastProblems, MIN_CONTRAST } from "./contrast";
import { siteTheme } from "./index";

describe("site theme", () => {
  it.runIf(siteTheme)("has readable text colours", () => {
    const problems = contrastProblems(siteTheme!).map(
      (p) => `${p.pair} (${p.mode} mode) has a contrast of ${p.ratio}:1. Aim for at least ${MIN_CONTRAST}:1.`,
    );
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it.runIf(siteTheme)("has a name and a logo", () => {
    expect(siteTheme!.appName.trim()).not.toBe("");
    expect(siteTheme!.logo).toBeTruthy();
  });
});
