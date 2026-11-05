/**
 * Pure helpers for the analytics endpoint: user agent parsing, URL and UTM
 * cleaning, and safe keys for Firestore maps. Nothing here touches Firestore,
 * so it's all unit tested.
 */
import { createHash } from "node:crypto";

export type Device = "mobile" | "tablet" | "desktop";

export interface Agent {
  bot: boolean;
  device: Device;
  browser: string;
}

const BOT_PATTERN =
  /bot\b|bot\/|crawl|spider|slurp|archiver|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|whatsapp|curl\/|wget|python|httpclient|okhttp|axios|node-fetch|undici|go-http|java\/|libwww|monitor|pingdom|uptime|statuscake|phantomjs|selenium|puppeteer|playwright/i;

/** Coarse device type and browser family. The full user agent is never stored. */
export function parseUserAgent(ua: string | undefined, screenWidth?: number): Agent {
  if (!ua || ua.length < 20 || BOT_PATTERN.test(ua)) return { bot: true, device: "desktop", browser: "Other" };
  let device: Device;
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) device = "tablet";
  else if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) device = "mobile";
  else device = "desktop";
  // iPadOS reports itself as a Mac, so fall back to the screen width.
  if (device === "desktop" && /Macintosh/.test(ua) && screenWidth !== undefined && screenWidth > 0 && screenWidth <= 1366 && /Safari/.test(ua) && !/Chrome/.test(ua)) {
    device = screenWidth < 1100 ? "tablet" : "desktop";
  }
  return { bot: false, device, browser: browserFamily(ua) };
}

function browserFamily(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS/.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS/.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}

export const UTM_FIELDS = ["source", "medium", "campaign", "term", "content"] as const;
export type UtmField = (typeof UTM_FIELDS)[number];
export type Utm = Partial<Record<UtmField, string>>;

function cleanUtmValue(v: string | null | undefined): string | undefined {
  const t = v?.trim().toLowerCase().slice(0, 100);
  return t ? t : undefined;
}

export interface CleanUrl {
  host: string;
  /** The path with no query string or fragment, and no trailing slash except for the home page. */
  path: string;
  utm: Utm;
}

/** Parses a page URL. Every query parameter except utm_* is dropped, as they can carry personal data. */
export function cleanUrl(raw: string): CleanUrl | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  let path = url.pathname || "/";
  try {
    path = decodeURI(path);
  } catch {
    // Keep the encoded form if it doesn't decode.
  }
  if (path.length > 1) path = path.replace(/\/+$/, "") || "/";
  const utm: Utm = {};
  for (const f of UTM_FIELDS) {
    const v = cleanUtmValue(url.searchParams.get(`utm_${f}`));
    if (v) utm[f] = v;
  }
  return { host: url.host.toLowerCase(), path: path.slice(0, 300), utm };
}

export function cleanUtm(input: Partial<Record<string, string | undefined>> | undefined): Utm {
  const utm: Utm = {};
  for (const f of UTM_FIELDS) {
    const v = cleanUtmValue(input?.[f]);
    if (v) utm[f] = v;
  }
  return utm;
}

/** The referring site's domain, or undefined for none, internal links and non-web referrers. */
export function referrerDomain(raw: string | undefined, ownHost: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === ownHost.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "")) return undefined;
    return host.slice(0, 200);
  } catch {
    return undefined;
  }
}

/**
 * Map keys in the daily rollups. Firestore map keys can't be empty, and
 * names like `__x__` are reserved, so every key is prefixed and URI encoded,
 * with dots encoded too so a key is never read as a field path.
 */
export function encodeKey(value: string): string {
  return "k" + encodeURIComponent(value).replace(/\./g, "%2E").replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function decodeKey(key: string): string {
  if (!key.startsWith("k")) return key;
  try {
    return decodeURIComponent(key.slice(1));
  } catch {
    return key.slice(1);
  }
}

/** The bucket for values past the per-day cap. */
export const OTHER = "(other)";

/** Uses `key` if the map already has it or has room, otherwise the "other" bucket. */
export function capKey(existing: Record<string, unknown> | undefined, value: string, cap: number): string {
  const key = encodeKey(value);
  if (!existing || key in existing) return key;
  return Object.keys(existing).length < cap ? key : encodeKey(OTHER);
}

/** Date in Europe/London as YYYY-MM-DD, so days match the charity's own. */
export function londonDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** One-way hash for visitor and session ids, so the raw cookie value is never stored. */
export function hashId(value: string, salt = "ccm-analytics"): string {
  return createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 32);
}

export function widthBucket(w: number | undefined): string | undefined {
  if (w === undefined || w <= 0) return undefined;
  if (w < 640) return "small";
  if (w < 1024) return "medium";
  return "large";
}
