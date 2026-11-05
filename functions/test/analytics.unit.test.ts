import { describe, expect, it } from "vitest";
import { capKey, cleanUrl, cleanUtm, decodeKey, encodeKey, hashId, londonDay, OTHER, parseUserAgent, referrerDomain, widthBucket } from "../src/analytics/clean.js";

const UA = {
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  androidPhone: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ipadAsMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  headless: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
  curl: "curl/8.7.1",
};

describe("parseUserAgent", () => {
  it("finds the device and browser family", () => {
    expect(parseUserAgent(UA.chromeMac)).toEqual({ bot: false, device: "desktop", browser: "Chrome" });
    expect(parseUserAgent(UA.safariIphone)).toEqual({ bot: false, device: "mobile", browser: "Safari" });
    expect(parseUserAgent(UA.androidPhone)).toMatchObject({ device: "mobile", browser: "Chrome" });
    expect(parseUserAgent(UA.androidTablet)).toMatchObject({ device: "tablet" });
    expect(parseUserAgent(UA.ipad)).toMatchObject({ device: "tablet", browser: "Safari" });
    expect(parseUserAgent(UA.edge).browser).toBe("Edge");
    expect(parseUserAgent(UA.firefox).browser).toBe("Firefox");
    expect(parseUserAgent(UA.samsung).browser).toBe("Samsung Internet");
  });

  it("uses the screen width for iPads that report as a Mac", () => {
    expect(parseUserAgent(UA.ipadAsMac, 820).device).toBe("tablet");
    expect(parseUserAgent(UA.ipadAsMac, 1440).device).toBe("desktop");
  });

  it("treats crawlers, headless browsers, scripts and missing agents as bots", () => {
    for (const ua of [UA.googlebot, UA.headless, UA.curl, "", undefined]) expect(parseUserAgent(ua).bot).toBe(true);
  });
});

describe("cleanUrl", () => {
  it("keeps only the path and the UTM fields", () => {
    expect(cleanUrl("https://www.example.org/events/?email=a%40b.com&utm_source=Facebook&utm_campaign=Ceili%202026#top")).toEqual({
      host: "www.example.org",
      path: "/events",
      utm: { source: "facebook", campaign: "ceili 2026" },
    });
  });

  it("keeps the home page as a slash and decodes the path", () => {
    expect(cleanUrl("https://example.org")?.path).toBe("/");
    expect(cleanUrl("https://example.org/caf%C3%A9")?.path).toBe("/café");
  });

  it("refuses anything that isn't a web URL", () => {
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
    expect(cleanUrl("not a url")).toBeNull();
  });

  it("caps long paths", () => {
    expect(cleanUrl(`https://example.org/${"a".repeat(1000)}`)?.path.length).toBe(300);
  });
});

describe("cleanUtm", () => {
  it("trims, lowercases and drops empty values and unknown fields", () => {
    expect(cleanUtm({ source: " Newsletter ", medium: "", campaign: "Spring", other: "x" })).toEqual({ source: "newsletter", campaign: "spring" });
  });
});

describe("referrerDomain", () => {
  it("returns the referring domain without www", () => {
    expect(referrerDomain("https://www.google.com/search?q=irish+elders", "www.example.org")).toBe("google.com");
  });

  it("ignores internal links, empty and non-web referrers", () => {
    expect(referrerDomain("https://example.org/about", "www.example.org")).toBeUndefined();
    expect(referrerDomain("https://www.example.org/about", "example.org")).toBeUndefined();
    expect(referrerDomain("", "example.org")).toBeUndefined();
    expect(referrerDomain("android-app://com.google", "example.org")).toBeUndefined();
  });
});

describe("map keys", () => {
  it("round trips awkward values and never contains dots or reserved names", () => {
    for (const v of ["/events/ceili.html", "__name__", "", "a b/c?d", "(direct)", "café", "x*y!z~"]) {
      const k = encodeKey(v);
      expect(k.startsWith("k")).toBe(true);
      expect(k).not.toContain(".");
      expect(k).not.toMatch(/^__.*__$/);
      expect(decodeKey(k)).toBe(v);
    }
  });

  it("buckets new values into other once the cap is reached", () => {
    const existing = { [encodeKey("/a")]: 1, [encodeKey("/b")]: 1 };
    expect(capKey(existing, "/a", 2)).toBe(encodeKey("/a"));
    expect(capKey(existing, "/c", 2)).toBe(encodeKey(OTHER));
    expect(capKey(existing, "/c", 3)).toBe(encodeKey("/c"));
    expect(capKey(undefined, "/c", 1)).toBe(encodeKey("/c"));
  });
});

describe("helpers", () => {
  it("uses the London date", () => {
    expect(londonDay(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(londonDay(new Date("2026-01-01T23:30:00Z"))).toBe("2026-01-01");
  });

  it("hashes ids one way and consistently", () => {
    expect(hashId("abc")).toBe(hashId("abc"));
    expect(hashId("abc")).not.toBe(hashId("abd"));
    expect(hashId("abc")).toHaveLength(32);
  });

  it("buckets screen widths", () => {
    expect(widthBucket(390)).toBe("small");
    expect(widthBucket(800)).toBe("medium");
    expect(widthBucket(1920)).toBe("large");
    expect(widthBucket(undefined)).toBeUndefined();
  });
});
