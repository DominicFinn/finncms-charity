/** Templates for npm run site:init. Pure, so they're tested. */

export function initials(name: string): string {
  const words = name
    .replace(/&/g, " ")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !/^(and|of|the|for)$/i.test(w));
  return (words.slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "C").slice(0, 2);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** A plain square logo with the charity's initials, to replace with the real one. */
export function placeholderLogo(name: string, colour = "#1e293b"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${escapeXml(name)}">
  <rect width="64" height="64" rx="14" fill="${colour}"/>
  <text x="32" y="41" text-anchor="middle" font-family="system-ui, sans-serif" font-size="26" font-weight="700" fill="#ffffff">${escapeXml(initials(name))}</text>
</svg>
`;
}

export function themeTemplate(appName: string): string {
  return `/**
 * Your charity's look. Change the values below, save, and the app updates.
 * Check your colours are easy to read with: npm run site:check
 * Every option is explained in docs/customise.md.
 */
import { makeTheme } from "../web/src/theme/make";
import logo from "./logo.svg";

export default makeTheme({
  // The name in the side menu and the browser tab.
  appName: ${JSON.stringify(appName)},

  // Your logo. Replace site/logo.svg (or import a .png instead).
  logo,

  colours: {
    primary: "#1e293b", // Buttons, links and highlights
    primaryText: "#ffffff", // Text on primary buttons
    background: "#ffffff", // Page background
    text: "#0f172a", // Main text
    soft: "#f1f5f9", // Soft tint for tags and quiet panels
    sidebar: "#f8fafc", // Side menu background
    sidebarText: "#0f172a", // Side menu text
    border: "#e2e8f0", // Lines around cards and boxes
  },

  // Optional: colours for people whose device is in dark mode.
  // darkColours: { primary: "#e2e8f0", primaryText: "#0f172a" },

  fonts: {
    // Pick fonts at https://fonts.google.com, then paste the family names and the link here.
    body: '"Inter", system-ui, sans-serif',
    headings: '"Inter", system-ui, sans-serif',
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
    sizePx: 16, // 18 is easier for older eyes
  },

  // How rounded corners are: "0.25rem" is sharp, "1rem" is very round.
  roundness: "0.5rem",
});
`;
}

/** Puts the charity's name into a copy of a seed file. */
export function seedWithName(seedJson: string, orgName: string): string {
  const seed = JSON.parse(seedJson) as { $comment?: string; org?: Record<string, unknown> };
  seed.$comment = `Starting lists for ${orgName}. Edit them here, then run npm run seed. See docs/customise.md.`;
  seed.org = { ...(seed.org ?? {}), name: orgName };
  return `${JSON.stringify(seed, null, 2)}\n`;
}
