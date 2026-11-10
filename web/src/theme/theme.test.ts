import { describe, expect, it } from "vitest";
import { defaultTheme } from "./default";
import { makeTheme, selectTheme, siteTheme, themeCss, tokenToVar } from "./index";
import { greenTheme } from "./green";

describe("theme", () => {
  it("maps token names to CSS variables", () => {
    expect(tokenToVar("primaryForeground")).toBe("--primary-foreground");
    expect(tokenToVar("background")).toBe("--background");
  });

  it("chooses a built in theme by name when there's no site theme", () => {
    expect(selectTheme(undefined, null)).toBe(defaultTheme);
    expect(selectTheme("nope", null)).toBe(defaultTheme);
    expect(selectTheme("green", null)).toBe(greenTheme);
    expect(selectTheme("default", null)).toBe(defaultTheme);
  });

  it("always uses the site theme when there is one", () => {
    const site = makeTheme({ appName: "Site", logo: "/logo.svg", colours: { primary: "#123456", primaryText: "#ffffff" } });
    expect(selectTheme(undefined, site)).toBe(site);
    expect(selectTheme("default", site)).toBe(site);
    expect(selectTheme("green", site)).toBe(site);
    expect(selectTheme("default")).toBe(siteTheme ?? defaultTheme);
  });

  it("writes light and dark variables", () => {
    const css = themeCss(greenTheme);
    expect(css).toContain("--primary: #0b5d3b;");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain("font-size: 18px;");
    expect(css).toContain("--radius: 0.75rem;");
  });

  it("defines every token in both modes for each theme", () => {
    for (const t of [defaultTheme, greenTheme]) {
      expect(Object.keys(t.colours.dark).sort()).toEqual(Object.keys(t.colours.light).sort());
    }
  });
});
