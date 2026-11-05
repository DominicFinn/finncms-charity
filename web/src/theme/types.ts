/** Colour tokens used by every component. Values are any CSS colour. */
export interface ThemeColours {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  warning: string;
  warningForeground: string;
  success: string;
  successForeground: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
}

export interface Theme {
  id: string;
  appName: string;
  /** Path under /public. */
  logo: string;
  colours: { light: ThemeColours; dark: ThemeColours };
  typography: {
    bodyFont: string;
    headingFont: string;
    /** Optional Google Fonts stylesheet URL. */
    googleFontsUrl?: string;
    /** Root font size in pixels. */
    baseSizePx: number;
  };
  /** Corner radius, e.g. "0.5rem". */
  radius: string;
}
