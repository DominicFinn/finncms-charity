# Website analytics

The system can count visits to the charity's public website and show them on a Website page, for people whose role has the `analytics.view` permission. It's deliberately small: page views, visits, new and returning visitors, top pages, where visits come from, UTM campaigns and devices.

## How it works

A short script on the website sends one small JSON message per page view to `/api/collect` on the contacts system. That's a Cloud Function, `collect`, which:

1. refuses anything from a website that isn't listed under Admin, Organisation settings, Website analytics;
2. drops bots: known crawlers, headless and automated browsers, scripts, and requests with no browser details;
3. refuses bodies over 4 KB and anything that doesn't match the expected shape;
4. limits each visitor to 60 events a minute, and each network address to 240 a minute (counted in memory, never stored);
5. stores the cleaned event and adds it to that day's totals.

The dashboard reads one totals document per day, so it stays quick and cheap however much traffic the site gets.

## What's collected

| Kept | How |
| --- | --- |
| Page path | `/events`, with no query string or fragment |
| Page title | Up to 200 characters |
| Referring site | Domain only, such as `google.com`. Links within the site are ignored |
| Campaign | `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` and `utm_content` from the landing page |
| Device | Mobile, tablet or desktop |
| Browser | Family only, such as Safari or Chrome |
| Screen size | Small, medium or large |
| Visitor and visit ids | One way hashes of random ids from the browser |
| New or returning | Worked out on the server from when the visitor was first seen |

## What isn't collected

- IP addresses. The address is only used for the per minute limit, as a truncated hash with a daily salt, held in memory and never written anywhere.
- The full user agent string.
- Query string parameters other than `utm_*`. Search terms, email addresses and other things that turn up in URLs are thrown away.
- The raw cookie value. Only a hash is stored, so the stored data can't be matched back to a browser's cookie without that cookie.
- Anything typed into forms.

## The cookie

The script sets one first party cookie, such as `site_vid` (the website's tracker chooses the name), holding a random id. It lasts 13 months, is `SameSite=Lax` and `Secure`, and is only used to tell new visitors from returning ones. A random visit id is kept in session storage and cleared when the browser tab closes.

The script sends nothing and sets no cookie when:

- the visitor has opted out on the website's privacy page (stored as an `site_optout` cookie and in local storage);
- the browser sends Global Privacy Control (`navigator.globalPrivacyControl`);
- the browser has Do Not Track turned on.

## Legal basis

The Data (Use and Access) Act 2025 added an exemption to the UK's cookie rules (PECR) for cookies used only to collect statistics to improve a website, provided visitors are told clearly and can object easily. This setup is built around that exemption: the cookie is described on the privacy page and there's a one click opt out.

**The charity's data protection lead must confirm the exemption is in force and applies before this is switched on for the public site.** If it isn't, the website should ask for consent before setting the cookie, and count visits without it otherwise.

## Retention

- Raw events and visitor records carry an `expireAt` field 13 months ahead. A Firestore TTL policy deletes them after that. TTL deletion usually happens within a day of expiry but isn't instant.
- Daily totals have no personal data and are kept until someone deletes them.

The TTL policies are declared in `firestore.indexes.json` and are created by `firebase deploy --only firestore:indexes`. To create them by hand instead:

```sh
gcloud firestore fields ttls update expireAt --collection-group=analyticsEvents --enable-ttl --project <project-id>
gcloud firestore fields ttls update expireAt --collection-group=analyticsVisitors --enable-ttl --project <project-id>
```

## Limits

Each day's totals keep at most 300 distinct pages, 150 landing pages, 150 referring sites, 100 sources, 100 campaigns, 50 mediums, 50 event names and 20 browsers. Anything past that is counted as "Other", which keeps each day's document well under Firestore's 1 MB limit.

Visitors are counted once per day, so the daily chart shows people per day. Over a longer range the dashboard shows visits, new visitors and returning visits, which add up correctly across days.

Firestore handles about one sustained write a second to a single document. Every event updates that day's totals, so this suits a small charity's site. A site with steady traffic of several page views a second would need the totals sharded.

## Adding it to a website

1. Add the site's origin under Admin, Organisation settings, Website analytics, such as `https://www.example.org`. List both `www` and non-`www` versions if the site answers on both, and `http://localhost:3000` while testing locally.
2. On the website, post page views to `https://<contacts-site>/api/collect`. A small script of a few dozen lines is enough, with no libraries.

Each message is JSON sent with `navigator.sendBeacon` (as `text/plain`, so there's no CORS preflight), falling back to `fetch` with `keepalive`:

```json
{
  "t": "pageview",
  "u": "https://www.example.org/events?utm_source=newsletter",
  "r": "https://www.google.com/",
  "ti": "Events",
  "v": "2b0f6c5e-8c1a-4d7e-9a43-3e1c2f9d8a10",
  "s": "a6d1f0f2-4b9e-4c55-8f0e-0f5b6c7d8e9a",
  "w": 390,
  "utm": { "source": "newsletter" }
}
```

`t` is `pageview` or `event`. Events need a name in `n`, such as `"n": "referral_submitted"`, and appear in an Events table on the dashboard. `v` and `s` must be UUIDs.
