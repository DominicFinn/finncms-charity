import { defaultTheme } from "./default";
import { ndieTheme } from "./ndie";
import type { Theme, ThemeColours } from "./types";

export type { Theme, ThemeColours } from "./types";

/**
 * A deployment can supply its own theme in site/theme.ts at the repository
 * root, with its logo and fonts beside it. When that file exists it's used
 * unless VITE_THEME names another theme. The core never contains a site/
 * folder, so a copy of the code for one charity can pull updates without
 * conflicts.
 */
const siteModules = import.meta.glob<{ default: Theme }>("../../../site/theme.ts", { eager: true });
export const siteTheme: Theme | undefined = Object.values(siteModules)[0]?.default;

export const themes: Record<string, Theme> = {
  default: defaultTheme,
  ndie: ndieTheme,
  ...(siteTheme ? { site: siteTheme } : {}),
};

export function selectTheme(id: string | undefined): Theme {
  if (id && themes[id]) return themes[id];
  return siteTheme ?? defaultTheme;
}

/** camelCase token name to CSS custom property, e.g. primaryForeground to --primary-foreground. */
export function tokenToVar(name: string): string {
  return `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** Builds the stylesheet text for a theme. Kept pure so it can be tested. */
export function themeCss(theme: Theme): string {
  const block = (c: ThemeColours) =>
    Object.entries(c)
      .map(([k, v]) => `  ${tokenToVar(k)}: ${v};`)
      .join("\n");
  const common = [
    `  --radius: ${theme.radius};`,
    `  --font-body: ${theme.typography.bodyFont};`,
    `  --font-heading: ${theme.typography.headingFont};`,
    `  font-size: ${theme.typography.baseSizePx}px;`,
  ].join("\n");
  return [
    `:root {\n${common}\n${block(theme.colours.light)}\n}`,
    `@media (prefers-color-scheme: dark) {\n:root {\n${block(theme.colours.dark)}\n}\n}`,
  ].join("\n");
}

export function applyTheme(theme: Theme, doc: Document = document): void {
  let style = doc.getElementById("app-theme") as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = "app-theme";
    doc.head.appendChild(style);
  }
  style.textContent = themeCss(theme);

  if (theme.typography.googleFontsUrl && !doc.getElementById("app-theme-fonts")) {
    const link = doc.createElement("link");
    link.id = "app-theme-fonts";
    link.rel = "stylesheet";
    link.href = theme.typography.googleFontsUrl;
    doc.head.appendChild(link);
  }

  let icon = doc.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!icon) {
    icon = doc.createElement("link");
    icon.rel = "icon";
    doc.head.appendChild(icon);
  }
  icon.href = theme.logo;
  doc.title = theme.appName;
}

export const theme = selectTheme(import.meta.env.VITE_THEME);
