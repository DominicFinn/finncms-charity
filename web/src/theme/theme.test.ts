import { describe, expect, it } from "vitest";
import { defaultTheme } from "./default";
import { selectTheme, siteTheme, themeCss, tokenToVar } from "./index";
import { ndieTheme } from "./ndie";

describe("theme", () => {
  it("maps token names to CSS variables", () => {
    expect(tokenToVar("primaryForeground")).toBe("--primary-foreground");
    expect(tokenToVar("background")).toBe("--background");
  });

  it("falls back to the site theme when there is one, otherwise the default", () => {
    const fallback = siteTheme ?? defaultTheme;
    expect(selectTheme(undefined)).toBe(fallback);
    expect(selectTheme("nope")).toBe(fallback);
    expect(selectTheme("ndie")).toBe(ndieTheme);
    expect(selectTheme("default")).toBe(defaultTheme);
  });

  it("writes light and dark variables", () => {
    const css = themeCss(ndieTheme);
    expect(css).toContain("--primary: #0b5d3b;");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain("font-size: 18px;");
    expect(css).toContain("--radius: 0.75rem;");
  });

  it("defines every token in both modes for each theme", () => {
    for (const t of [defaultTheme, ndieTheme]) {
      expect(Object.keys(t.colours.dark).sort()).toEqual(Object.keys(t.colours.light).sort());
    }
  });
});
