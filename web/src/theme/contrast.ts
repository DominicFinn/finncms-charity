import type { Theme, ThemeColours } from "./types";

/** Parses #rgb or #rrggbb. Other CSS colours return null and aren't checked. */
export function parseHex(colour: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two hex colours, or null if either isn't hex. */
export function contrastRatio(a: string, b: string): number | null {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return null;
  const [hi, lo] = [luminance(pa), luminance(pb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text and background pairs that people read. */
export const TEXT_PAIRS: [keyof ThemeColours, keyof ThemeColours, string][] = [
  ["foreground", "background", "Main text on the page background"],
  ["cardForeground", "card", "Text on cards"],
  ["primaryForeground", "primary", "Text on primary buttons"],
  ["secondaryForeground", "secondary", "Text on soft panels"],
  ["mutedForeground", "background", "Quiet text, such as hints"],
  ["sidebarForeground", "sidebar", "Side menu text"],
  ["destructiveForeground", "destructive", "Text on delete buttons"],
];

/** WCAG AA for normal text. */
export const MIN_CONTRAST = 4.5;

export interface ContrastProblem {
  mode: "light" | "dark";
  pair: string;
  ratio: number;
}

/** Text pairs below 4.5:1, so they can be fixed before anyone struggles to read them. */
export function contrastProblems(theme: Theme): ContrastProblem[] {
  const problems: ContrastProblem[] = [];
  for (const mode of ["light", "dark"] as const) {
    const c = theme.colours[mode];
    for (const [fg, bg, label] of TEXT_PAIRS) {
      const ratio = contrastRatio(c[fg], c[bg]);
      if (ratio !== null && ratio < MIN_CONTRAST) problems.push({ mode, pair: label, ratio: Math.round(ratio * 100) / 100 });
    }
  }
  return problems;
}
