# Referrals

People can be referred to the charity through its website, by themselves, by family or friends, or by professionals such as GPs. Referrals land in a triage queue in this system. Staff look at each one, get in touch, and then either accept it, which creates a client record (or links an existing one), or decline it with a reason.

## How a referral gets here

```
Browser                Website server                 This system
-------                --------------                 -----------
Form with Turnstile -> /api/referral route
                       1. checks Turnstile token
                       2. checks honeypot and timing
                       3. light per-IP limit
                       4. POST /api/referrals  -----> referralsIntake function
                          Authorization: Bearer          1. checks the key
                          ccmk_...                        2. hourly limit per key
                                                          3. strict validation
                                                          4. saves to the queue
                       <- { reference: "R-7K3Q9X" } <-
```

The browser never talks to this system and never sees the key. The website's own server holds the key and is the only thing that can send referrals.

## Setting it up

0. On a system set up before referrals existed, the roles already saved don't have the new permissions, because seeding never changes existing records. The super user always has every permission. Add `referrals.view`, `referrals.manage` and `integrations.manage` to the right roles in Admin > Roles (new installs give the first two to caseworkers and all three to managers).
1. In the admin area, open **Integration keys** and create a key. You need the `integrations.manage` permission, which managers have by default. Give it a name ("Charity website"), a source label that appears on every referral ("Website") and an hourly limit (20 is plenty for a small charity).
2. Copy the key. It starts with `ccmk_` and is shown once. Only a SHA-256 hash of it is stored here.
3. Put it in the website's server settings as `CONTACTS_API_KEY`, with `CONTACTS_API_URL` set to this system's address, for example `https://contacts.example.org`. The website sends to `${CONTACTS_API_URL}/api/referrals`.
4. If a key leaks, revoke it and create a new one. Revoking takes effect at once.

## The intake endpoint

`POST /api/referrals`, served by the `referralsIntake` function through a Hosting rewrite.

| Check | Result when it fails |
| --- | --- |
| Method is POST | 405 |
| `Content-Type: application/json` | 415 |
| Body under 16 KB | 413 |
| `Authorization: Bearer ccmk_...` matches a key that isn't revoked | 401, the same response for every kind of bad key |
| Under the key's hourly limit, counting every authenticated request | 429 with `Retry-After` |
| Body matches the schema, with no unknown fields | 400 with the paths of the fields at fault, never their values |

On success it returns `201 { "reference": "R-7K3Q9X" }`. If the request includes a `submissionId` the website can retry safely: sending the same id with the same key again returns `200` and the first reference, without creating a second referral.

The fields are defined in `referralSubmissionSchema` in `packages/shared/src/ops.ts`. The person must agree to be contacted (`consentToContact: true`), there must be at least one way to reach them, and a referral for someone else must say who is referring and how to reach them.

The endpoint sends no CORS headers, so a web page on another site can't call it from a browser.

## What each protection stops

| Protection | Where | Stops |
| --- | --- | --- |
| Cloudflare Turnstile | Website | Automated form filling by bots. Most people never see a challenge. |
| Honeypot field | Website | Simple bots that fill in every field. |
| Minimum time to fill | Website | Scripts that submit the form instantly. |
| Per-IP limit | Website | One person or machine sending many referrals. Best effort, as it is held in memory on each server instance. |
| Integration key | Here | Anyone other than the website sending referrals directly. |
| Hourly limit per key | Here | Floods, including from a leaked key or a website bug. Caps the damage to a known number an hour. |
| Strict schema and size limit | Here | Oversized or unexpected data, and attempts to set fields the form doesn't have. |
| Triage queue | Here | Nothing from outside becomes a client record without a person accepting it. |

None of this proves a referral is genuine. A person can still submit a false one. Staff check by getting in touch before accepting.

## Triage

Referrals appear under **Referrals** in the menu, with a count of new ones. They are also counted on the home page. Anyone with `referrals.manage` (caseworkers and managers by default) is notified when a new one arrives.

- **New** and **Contacted** are the waiting statuses. Assign a referral to someone and keep notes as you go.
- **Accept** creates a client from the referral, or links it to an existing client if it's someone already on the system. Possible matches (same name, with postcode or phone number) are shown as a warning. The referral details and triage notes are added to the client's notes. Creating a client also needs `clients.create`.
- **Decline** needs a reason.

Every view and change is in the audit log. Intake is logged with the channel "integration". Audit entries for referrals hold statuses and who did what, never the referral's personal details.

Claude can list, read and triage referrals over MCP for people whose role allows it. Integration keys can only be managed in the web app.

## Retention

- A referral's personal details are removed a set number of days after it is accepted or declined. The default is 90 days, set under **Organisation settings**. Shortening it needs the `clients.anonymise` permission.
- Accepted referrals have been copied into the client's notes by then, so nothing is lost from the client record.
- What stays: status, source, referrer type, town, postcode district, the help areas ticked, and dates. That's enough to count referrals by source and area.
- Referrals still waiting for a decision are never removed automatically, so nobody drops out of the queue. Work the queue regularly.
- When a client is anonymised, any referral linked to them is anonymised at the same time.
- A subject access export for a client includes the referrals linked to them.
- The daily retention job does this, along with clearing rate limit counters older than two days.
