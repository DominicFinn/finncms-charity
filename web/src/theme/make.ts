import { defaultTheme } from "./default";
import type { Theme, ThemeColours } from "./types";

/** The handful of colours most charities want to change. Any CSS colour works; hex is easiest. */
export interface BrandColours {
  /** Buttons, links and highlights. */
  primary: string;
  /** Text on primary buttons. Usually white or very dark. */
  primaryText: string;
  /** Page background. */
  background?: string;
  /** Main text colour. */
  text?: string;
  /** Soft tint for tags, hover states and quiet panels. */
  soft?: string;
  /** Text on the soft tint. */
  softText?: string;
  /** Side menu background. */
  sidebar?: string;
  /** Side menu text. */
  sidebarText?: string;
  /** Lines around cards and inputs. */
  border?: string;
}

export interface MakeThemeOptions {
  appName: string;
  /** A logo file imported from the site folder, such as `import logo from "./logo.svg"`. */
  logo: string;
  colours: BrandColours;
  /** Colours for people whose device is in dark mode. Leave out to use the neutral dark colours with your primary colour. */
  darkColours?: Partial<BrandColours>;
  fonts?: {
    body?: string;
    headings?: string;
    /** A Google Fonts stylesheet link for the fonts above. */
    googleFontsUrl?: string;
    /** Base text size in pixels. 16 is normal; 18 is easier to read. */
    sizePx?: number;
  };
  /** How rounded corners are, such as "0.25rem" (sharp) to "1rem" (very round). */
  roundness?: string;
  /** Full control over any colour token, for light and dark. Most sites don't need this. */
  overrides?: { light?: Partial<ThemeColours>; dark?: Partial<ThemeColours> };
}

function apply(base: ThemeColours, c: Partial<BrandColours>): ThemeColours {
  const out = { ...base };
  if (c.primary) Object.assign(out, { primary: c.primary, ring: c.primary });
  if (c.primaryText) out.primaryForeground = c.primaryText;
  if (c.background) Object.assign(out, { background: c.background, card: c.background, popover: c.background });
  if (c.text) {
    Object.assign(out, { foreground: c.text, cardForeground: c.text, popoverForeground: c.text, secondaryForeground: c.text, accentForeground: c.text });
  }
  if (c.soft) Object.assign(out, { secondary: c.soft, muted: c.soft, accent: c.soft });
  if (c.softText) Object.assign(out, { secondaryForeground: c.softText, accentForeground: c.softText });
  if (c.sidebar) out.sidebar = c.sidebar;
  if (c.sidebarText) out.sidebarForeground = c.sidebarText;
  if (c.border) Object.assign(out, { border: c.border, input: c.border });
  return out;
}

/** Builds a complete theme from a few brand choices, starting from the neutral default. */
export function makeTheme(o: MakeThemeOptions): Theme {
  const light = { ...apply(defaultTheme.colours.light, o.colours), ...o.overrides?.light };
  const darkBrand: Partial<BrandColours> = o.darkColours ?? {};
  const dark = { ...apply(defaultTheme.colours.dark, darkBrand), ...o.overrides?.dark };
  const fonts = o.fonts ?? {};
  return {
    id: "site",
    appName: o.appName,
    logo: o.logo,
    radius: o.roundness ?? defaultTheme.radius,
    typography: {
      bodyFont: fonts.body ?? defaultTheme.typography.bodyFont,
      headingFont: fonts.headings ?? fonts.body ?? defaultTheme.typography.headingFont,
      googleFontsUrl: fonts.googleFontsUrl ?? (fonts.body ? undefined : defaultTheme.typography.googleFontsUrl),
      baseSizePx: fonts.sizePx ?? defaultTheme.typography.baseSizePx,
    },
    colours: { light, dark },
  };
}
