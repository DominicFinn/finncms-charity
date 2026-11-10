import { describe, expect, it } from "vitest";
import { contrastProblems, contrastRatio, parseHex } from "./contrast";
import { defaultTheme } from "./default";
import { makeTheme } from "./make";
import { greenTheme } from "./green";

describe("makeTheme", () => {
  it("fills every token from a few brand colours", () => {
    const t = makeTheme({
      appName: "Our contacts",
      logo: "/logo.svg",
      colours: { primary: "#0b5d3b", primaryText: "#ffffff", sidebar: "#0b5d3b", sidebarText: "#ffffff", soft: "#e8f3ee" },
    });
    expect(t.colours.light.primary).toBe("#0b5d3b");
    expect(t.colours.light.ring).toBe("#0b5d3b");
    expect(t.colours.light.sidebarForeground).toBe("#ffffff");
    expect(t.colours.light.muted).toBe("#e8f3ee");
    expect(t.colours.light.background).toBe(defaultTheme.colours.light.background);
    expect(Object.keys(t.colours.dark).sort()).toEqual(Object.keys(defaultTheme.colours.dark).sort());
    expect(t.radius).toBe(defaultTheme.radius);
    expect(t.typography.googleFontsUrl).toBe(defaultTheme.typography.googleFontsUrl);
  });

  it("uses your fonts, size and roundness, and drops the default font link", () => {
    const t = makeTheme({
      appName: "x",
      logo: "/l.svg",
      colours: { primary: "#000000", primaryText: "#ffffff" },
      fonts: { body: '"Atkinson Hyperlegible", sans-serif', sizePx: 18 },
      roundness: "1rem",
    });
    expect(t.typography.headingFont).toBe('"Atkinson Hyperlegible", sans-serif');
    expect(t.typography.googleFontsUrl).toBeUndefined();
    expect(t.typography.baseSizePx).toBe(18);
    expect(t.radius).toBe("1rem");
  });

  it("lets overrides set any token", () => {
    const t = makeTheme({ appName: "x", logo: "/l.svg", colours: { primary: "#000000", primaryText: "#ffffff" }, overrides: { dark: { warning: "#ff0" } } });
    expect(t.colours.dark.warning).toBe("#ff0");
  });
});

describe("contrast", () => {
  it("parses hex colours", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#0b5d3b")).toEqual([11, 93, 59]);
    expect(parseHex("rgb(0 0 0)")).toBeNull();
  });

  it("measures contrast like WCAG", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(contrastRatio("red", "#ffffff")).toBeNull();
  });

  it("passes the built in themes", () => {
    expect(contrastProblems(defaultTheme)).toEqual([]);
    expect(contrastProblems(greenTheme)).toEqual([]);
  });

  it("flags hard to read text", () => {
    const t = makeTheme({ appName: "x", logo: "/l.svg", colours: { primary: "#9fd3ff", primaryText: "#ffffff" } });
    expect(contrastProblems(t).map((p) => p.pair)).toContain("Text on primary buttons");
  });
});
