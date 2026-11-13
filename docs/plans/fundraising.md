# Fundraising plan

This is the plan for adding fundraising to the system: campaigns, donors, gifts, donation pages, email and attribution. It's split into tickets in the order I think we should build them. Each one is useful on its own, so we can stop after any of them and still have something that works.

The system is for smaller charities and is meant to be fairly all in one. The charity's website stays as information. This platform is the data side: campaigns, donors, gifts and emails, plus the donation pages themselves. A small charity should only need their existing website, an account with a payment platform and an email service.

None of this exists yet. The parts we can reuse are the analytics pipeline (for donation page views and UTMs), the protections from referral intake, the question bank (for configurable fields), the theme, and the audit, crypto-shredding and retention patterns that clients already use.

## What we're trying to answer

Charities want to know whether their fundraising and campaigns are working. For each campaign that means how much it raised, from how many people, how many of them were new, and what it cost. Everything below is in service of that, and the attribution rules are what make the numbers trustworthy.

## How a gift comes in

1. Campaign links (emails, social media posts, posters, the Donate button on the charity's website) go to a donation page on this platform, styled with the charity's theme. Each campaign can have its own page, and there's a general one.
2. The donor fills in the form here: amount, their details, contact preferences, Gift Aid and the charity's own questions.
3. They pay on the payment platform's own checkout, such as Stripe or PayPal. Card details never touch this system.
4. The payment platform calls back here to confirm the payment. Only then is the gift recorded and the donor created or matched.
5. The donor sees a thank-you page here and gets a thank-you email.

Staff can also record gifts by hand (cheques, cash, bank transfers), and gifts made on a payment platform without our page still arrive through the same callback.

## Decisions

Agreed:

- **No direct payments.** Payments go through a standard payment platform, and we receive its callback. We'll write worked examples for the common platforms.
- **Stripe is the first payment platform.** PayPal and a generic signed callback come after it, unless the first charities need something else.
- **Donation pages are hosted here.** The form and the donor are managed on this platform. The charity's website links to it.
- **Email providers plug in.** The system is open source, so it can't assume one email service. We ship Postmark and SMTP, a guide for developers adding another provider, and a guide for charities connecting their own account. Charities that want their email kept in the UK can use Amazon SES in London through the SMTP option. The email providers section has the detail.
- **Donors sign in with a one-time emailed link.** No passwords and no accounts. The link works once, for 15 minutes, and opens a 30 minute session that can only see gifts for that email address. Donors aren't Firebase Authentication users, so they stay completely apart from staff sign-in.
- **The campaign cookie needs consent.** The donation pages are ours, so they ask for it themselves. Gifts made in the same visit as the campaign click don't need the cookie at all.
- **Blended attribution.** A gift is shared equally between every campaign that reached the donor within the attribution window. The window defaults to 30 days and can be changed in settings.
- **No personal data in any export** in the open source version, apart from the subject access export.

Still to confirm:

- **Donors separate from clients.** I've assumed yes. They're different people, held for different reasons, and people working on fundraising shouldn't see client records, or the reverse. Someone who is both would have two records.

## Email providers

All email goes through a small provider adapter. One provider is active at a time, chosen in Admin, Email. To start with we'd ship two:

- **Postmark.** A well known email service with an API, good delivery rates and clear docs. It keeps one-off emails (thank-yous, sign-in links) and bulk emails (campaigns) in separate streams, which matches how the system splits them. It tells us about bounces, spam complaints and unsubscribes. This is the one I'd suggest to most charities. It's an American company and there's no real free plan, so a charity pays a small monthly fee.
- **SMTP.** Works with almost any email service, so a charity can use something they already pay for or manage themselves. The catch is that SMTP doesn't report bounces back, so the system can't suppress bad addresses by itself. It's fine for thank-you emails, but for big campaign emails I'd steer charities to Postmark. Microsoft 365 and Google Workspace in particular cap how many emails you can send a day.

Postmark is the worked example of a full adapter, and SMTP is the simplest possible one, so between them they cover what a developer needs to see. Brevo, Mailgun and Resend would be good next adapters, and each should be one file.

Pricing and free plan limits change, so the guides should link to each provider's pricing page rather than quote numbers.

### Keeping email in the UK

The system itself runs in Google Cloud's London region (europe-west2). A charity that wants their email to stay in the UK too, and is happy to manage it themselves, can use Amazon SES in its London region (eu-west-2) through the SMTP option. There's no extra adapter, because SES accepts mail over SMTP.

The charity guide walks through it: verifying the domain in SES in the London region, asking Amazon to move the account out of its sandbox (new accounts can only send to verified addresses), creating SMTP credentials, and entering `email-smtp.eu-west-2.amazonaws.com` on port 587 in the SMTP settings.

Two things for the guide to be upfront about. Bounces aren't reported back over SMTP, so someone needs to check the SES console and add bad addresses to the suppression list by hand. And the data stays in London, but Amazon is an American company, which some charities' DPIAs will want to note. A proper SES adapter, picking up bounces through Amazon SNS, is on the later list.

### What the system does and what an adapter does

The system does everything that has to be the same whichever provider is used:

- templates and filling them in
- checking consent, the suppression list and the do not contact flag before anything is sent
- adding the unsubscribe and preferences links, and the one-click unsubscribe headers
- queueing campaign emails and sending them in batches, within the provider's limits
- retrying failed sends
- the email log on each donor
- recording campaign sends as touches for attribution

An adapter only does the provider-specific parts:

- sending a finished message
- saying how fast and in what batch sizes the provider accepts mail
- checking the connection, for the test button
- turning the provider's webhooks into bounce, complaint and unsubscribe events, after checking they really came from the provider

Keeping adapters that small is what makes adding one easy. It also means no provider can skip a consent or suppression check, because those happen before the adapter is called.

### Keeping the provider's key safe

The API key or SMTP password is entered in Admin, Email by someone with `config.manage`. It's write only: once saved, the screen only shows the last 4 characters, and it's never sent back to the browser. It's kept in a server-only collection, as calendar tokens are, and encrypted with a key held as a Functions secret. The setup script creates that key, so nobody has to do it by hand.

### Guide for developers adding a provider

`docs/email-providers.md`, written for someone who wants to add a provider or understand how sending works.

- What an adapter is responsible for, and what the system already does for it (the lists above).
- The interface, roughly:

  ```ts
  export interface EmailProvider {
    id: string;                       // "postmark"
    name: string;                     // shown in Admin, Email
    settings: ProviderSetting[];      // fields the admin fills in, marking which are secret
    limits: { perSecond: number; batchSize: number };
    send(messages: OutgoingEmail[], config: ProviderConfig): Promise<SendResult[]>;
    test(config: ProviderConfig): Promise<TestResult>;
    events?(req: WebhookRequest, config: ProviderConfig): Promise<EmailEvent[]>;
  }
  ```

- `OutgoingEmail` holds the recipient, sender, reply-to address, subject, HTML and plain text, headers, our message id, and whether it's transactional (a thank-you or a sign-in link) or bulk (a campaign). Some providers want those two kinds kept apart, so the adapter can route them. The Postmark adapter sends them to its transactional and broadcast streams.
- `EmailEvent` is delivered, soft bounce, hard bounce, complaint or unsubscribe, with the address, the provider's message id and the time. `events` must refuse a webhook it can't verify. Postmark doesn't sign its webhooks, so the system generates a username and password that Postmark sends with each one.
- How to register a provider in `functions/src/email/providers/index.ts`.
- The shared contract tests every adapter has to pass, which run against a fake provider server, and how to try it against the real service with a test account.
- A walk through the Postmark adapter as the worked example, and the SMTP one as the simplest case.
- Things that catch people out. Google Cloud blocks outbound port 25, so SMTP has to use 587 or 465. Adapters must never log message bodies or email addresses. Rate limits go in `limits`, rather than the adapter sleeping between sends.

### Guide for charities connecting their account

`docs/email.md`, written for whoever looks after the charity's systems. It's technical, but it doesn't assume they're a developer.

- Which option to pick, in plain terms: Postmark for most charities, SMTP for a service they already have, and Amazon SES in London through SMTP if they want everything kept in the UK and are happy to manage it themselves.
- Setting up the account with the provider. For Postmark, that's a server with its default transactional stream for thank-yous, and a broadcast stream for campaign emails.
- Proving the charity owns its domain. The provider gives you DNS records to add wherever the domain is managed. The guide says in a line each what SPF, DKIM and DMARC do, and why emails land in spam without them.
- Creating a server token (Postmark) or SMTP login, with the least access the provider allows.
- The Amazon SES steps from the section above, as their own part of the guide.
- In Admin, Email: picking the provider, pasting the key, and setting the sender name and address, the reply-to address and the footer (charity name, registered number and postal address). Registered charities generally have to show they're registered on fundraising emails.
- For Postmark, copying the webhook address from the same screen into Postmark's webhook settings for both streams, and ticking the bounce, spam complaint and subscription change events.
- Sending a test email, and checking the status panel shows the connection working and a webhook received.
- Data protection. The provider handles donors' email addresses on the charity's behalf, so the charity needs a data processing agreement with them (most providers include one in their terms), and the provider should be in the DPIA.
- Troubleshooting: emails going to spam, bounces, a key that's been revoked, and hitting a daily limit.

Payment platforms (ticket 8) follow the same pattern: a small adapter for each platform, a guide for developers and a guide for connecting an account.

## How attribution works

### Touches

A touch is a moment when a campaign reached someone. There are two kinds to start with.

- **Email.** This system sent the donor an email for a campaign. We know who the donor is and when it was sent.
- **Campaign link.** The person arrived at a donation page through a link tagged for a campaign (`utm_campaign`). If they give in the same visit, we know without a cookie. If they leave and come back later, a cookie on the donation pages remembers the click for the attribution window, but only if they've said yes to it.

Later we could add touches that staff log, such as a letter, a phone call or an event.

An email counts as a touch when it's sent, not when it's opened. We won't put tracking pixels in emails, and opens aren't reliable anyway because Apple Mail loads images in advance. If someone clicks a link in the email, that's a campaign link touch as well, but it's the same campaign, so it doesn't count twice.

### The window

A touch counts if it happened within the attribution window before the gift. The default is 30 days, set in Admin, Organisation settings. The same window applies to emails and campaign links, so there's one rule to explain. Because the cookie is set by our own pages, it uses the same setting automatically.

The window is measured back from the date of the gift, not from when it's recorded, so a cheque entered a week late is still credited correctly.

### Blended credit

If more than one campaign reached the donor within the window, the gift is shared equally between those campaigns. A £30 gift from someone we emailed about the Winter Appeal and the Spring Newsletter counts £15 towards each. Several touches for the same campaign still count as one campaign.

This way campaign totals add up to what was actually given, and nothing is counted twice. Reports also show "gifts influenced", the number of gifts each campaign had a share in. That figure can add up to more than the number of gifts, and the report should say so.

When a gift names a campaign directly, because the donor gave through that campaign's own page or staff picked it when recording a cheque, the named campaign takes the whole gift. Blending only applies when we're working the credit out from touches, which mostly means gifts through the general donation page.

### When the credit is worked out

The system works out the credit when the gift is recorded and saves it on the gift, along with the window it used. Changing the window affects gifts recorded from then on, which keeps old reports stable. We could add a way to recalculate a date range later if people ask for it.

### Gifts that can't be attributed

Some gifts won't link to a campaign. These include gifts made on a different device from the click, gifts from people who declined the cookie and came back later, gifts made directly on a payment platform without our page, and gifts made outside the window. These show as unattributed. So a campaign's total is the least it raised, not the whole picture.

### Wording for the app

Something like this on the campaign report and next to the window setting. The 30 should come from the setting.

> **How gifts are credited to campaigns**
>
> A gift made through a campaign's own donation page counts in full towards that campaign.
>
> Other gifts count towards a campaign if, in the 30 days before the gift, we emailed the donor about that campaign or they came to our donation pages through one of its links. You can change the 30 days in Organisation settings.
>
> If more than one campaign reached the donor in that time, we share the gift equally between them. A £30 gift from someone we emailed about two campaigns counts £15 towards each. This is called blended attribution. It means campaign totals add up to what was actually given, with nothing counted twice.
>
> Some gifts can't be linked to a campaign, such as gifts made on another device or by people who said no to the campaign cookie. These show as unattributed, so treat each campaign's total as the least it raised.

### Wording for the cookie notice

The donation pages show this when someone arrives through a campaign link. The charity's privacy notice should say the same, and their data protection lead should check it.

> **Can we remember which campaign brought you here?**
>
> If you come back and donate in the next 30 days, we'll record which campaign led to your gift, so we can tell which of our appeals are working. We don't share this with anyone or use it for advertising.
>
> [Yes, that's fine] [No thanks]

## Data protection notes

- Fundraising data shouldn't be shared outside the charity or fed into advertising tools. That's for each charity's own policies and DPIA rather than something the software can enforce, but the docs should say it. The system only sends data to the email provider, the payment platform and Cloudflare Turnstile (for bot protection on the form).
- Charities should cover donors, the donation pages, campaign emails, the email provider and the campaign cookie in their DPIA before switching any of this on.
- The donation pages are public, so each page links to the charity's privacy notice, set in Organisation settings.
- Marketing emails need a lawful basis under PECR. The Data (Use and Access) Act 2025 extends the soft opt-in to charities, which may change what the donation form needs to ask. Worth confirming with a data protection lead.
- The Fundraising Regulator's Code of Fundraising Practice applies, including requests that come through the Fundraising Preference Service. A do not contact flag on the donor covers those.
- Gift Aid records have to be kept for HMRC's minimum period (6 years is the usual figure), so the retention job mustn't remove them early.
- No export in the open source version contains personal data. The next section has the detail.

## Data model and exports

The fundraising data should be easy to query, both in Firestore and once it's exported. I'd keep it as flat collections with one record per thing. Reports already work this way: the fields they need are copied onto sessions and outcomes, so there are no joins.

- `campaigns`: one per campaign, including its donation page settings.
- `donors`: one per donor. Personal details live here and nowhere else.
- `gifts`: one per gift, with the campaign named on it, the payment platform and its payment id, the attribution window used, and copies of what reports need, such as the donor's postcode district, whether it was their first gift and whether it's eligible for Gift Aid.
- `giftCredits`: one per gift per campaign it's credited to, with that campaign's share in pence. Adding these up by campaign gives the blended totals directly.
- `touches`: one per email send, written as it's sent, and one per campaign link click, written when a gift brings it in. Each has the donor (where we know it), the campaign and the time. Indexed by donor and time, which is the lookup attribution needs.
- `campaignEmails`: one per email sent for a campaign, with its counts.
- `checkouts`: a donation form that's been submitted but not paid yet. Deleted after 24 hours if the payment never arrives.
- `giftAidDeclarations`, and the answers to configurable fields, kept against each gift.

### Exports

- People with a new `fundraising.export` permission can download the fundraising data as a set of CSV files, one per table. The columns are documented and stable, amounts are in pence, dates are ISO 8601, and ids join across the files. That's enough to load into a spreadsheet, Power BI, BigQuery or a database.
- No export in the open source version contains personal data. Each export is built from a list of allowed fields, never by removing fields from the full record, so a field added later stays out until someone deliberately adds it. A test fails if personal data turns up in any file.
- Donors appear as a random donor reference, not their name, email or internal id. The reference doesn't change, so exports taken at different times join up.
- Location goes no finer than postcode district. Free text answers and notes are left out, because people type names and addresses into them. Choice, yes/no, number and date answers are included.
- The subject access export is the one exception, because the law requires it. It's one donor's own data, given to that donor.
- That means there's no export of donor contact lists, for example to load into Mailchimp. A charity that wants one can add it to their own copy, under their own DPIA.

One caveat worth putting in the docs: a donor reference still counts as personal data in law, because the charity can link it back to a person, and small groups can point to someone (one large gift from one postcode district, say). The export is fine to analyse internally, but where it ends up should still be covered by the charity's DPIA.

## Tickets

Tickets 1 to 7 give staff a working donor database and email, with nothing public. Tickets 8 and 9 let the charity take gifts online. Tickets 10 to 13 add campaign emails, attribution and the report that shows whether campaigns are working. Tickets 14 and 15 add exports and donor sign-in.

### 1. Campaigns

Campaigns that gifts, emails and visits can be linked to.

- A campaign has a name, a code (used as `utm_campaign`, lower case and unique), a description, start and end dates, a target, a cost and a status (draft, live or ended).
- A link builder that tags a link with the campaign's UTM parameters. It defaults to the campaign's donation page once ticket 9 is in, and works for any page on the charity's website too.
- The campaign page shows website visits for its code, from the existing analytics.
- A list of campaign codes seen in analytics that have no campaign yet, so staff can create one from it.
- New permissions `fundraising.view` and `campaigns.manage`. Audited, and readable over MCP.

Done when staff can set up a campaign, build its links and see visits to it.

Depends on nothing. There's no personal data in it, so it's a safe place to start.

### 2. Donors and gifts recorded by staff

- A donor has a name, email, phone numbers, address, contact preferences per channel (email, post, phone, text) with when and how each was given, and a do not contact flag.
- A gift has an amount (held in pence), date, method (card, cash, cheque, bank transfer, payment platform), reference, status (paid or refunded), an optional campaign, a Gift Aid flag (filled in properly by ticket 4) and notes.
- A donor list with search, a donor page with their gifts, and a form to record a gift.
- The campaign page shows what's been given to it so far against its target.
- Possible duplicate warnings when adding a donor, reusing the referral matching.
- New permissions `fundraising.manage`, `donors.export` and `donors.anonymise`, and a default Fundraiser role with no client permissions. Existing installs need their roles updated by hand, as with referrals.
- Every read and change audited. Before and after values encrypted with a per-donor key, the same way as clients, so ticket 3 can shred them.
- Donors and gifts stored as described in the data model section, with the Firestore indexes for the lookups we need.
- No bulk export of donors or their contact details.
- MCP tools to find donors and record gifts, with the same permissions.

Done when staff can record a cheque from a new donor against a campaign and see it on both the donor's page and the campaign's page.

Depends on 1.

### 3. Donor data protection

Before any donor data comes in from outside, we need to be able to export it and remove it.

- Subject access export for a donor.
- Erasure, by deleting the donor's key and removing personal details. Gift amounts, dates and campaign credit stay for reporting.
- A retention job. Donors with no gift and no contact for a set period are anonymised, with the same warning period and safeguards as clients. Gift Aid records are kept for HMRC's minimum first.
- A suppression list holding a hash of the email address, so someone who's asked to be removed isn't emailed again if they give again or turn up in an import.

Done when a donor can be exported and erased, and the retention job is covered by the emulator tests.

Depends on 2.

### 4. Gift Aid declarations

Gift Aid is set by HMRC, so it isn't one of the configurable fields.

- A declaration with HMRC's model wording, the donor's home address and postcode, the date, how it was made (online, written or spoken) and what it covers (one gift, or past and future gifts).
- Cancelling a declaration.
- Each gift shows whether it's eligible, from the declarations in force on its date.

Done when staff can record a declaration and see which gifts it covers.

Depends on 2. The HMRC claim export is a later ticket.

### 5. Configurable donation fields

Different charities want to ask different things, such as "In memory of", "How did you hear about us" or an employer for matched giving.

- Reuse the question bank: a new kind of question set for donations, with the same question types and the same admin screens.
- One default donation form, and a campaign can pick a different one.
- Each field can be required or optional on a form.
- The core fields stay fixed: amount, name, email, contact preferences and Gift Aid.
- Answers are saved on the gift and shown with it. Choice questions can be used to break down reports.

Done when an admin can add a question to the donation form and staff see it when recording a gift.

Depends on 2.

### 6. Email providers

- The provider adapter interface and registry, with the shared contract tests and a fake provider server.
- Postmark and SMTP adapters.
- An Admin, Email screen for people with `config.manage`: choose the provider, fill in its settings, enter the key (write only), set the sender name and address, the reply-to address and the footer, copy the webhook address, send a test email, and see the status (last send, last webhook received, any errors).
- Keys kept in a server-only collection and encrypted with a key held as a Functions secret, created by the setup script.
- Bounces, complaints and unsubscribes reported by the provider add the address to the suppression list.
- Nothing that sends email appears in the app until a provider is connected.
- `docs/email.md` for charities connecting their account, and `docs/email-providers.md` for developers adding a provider, as outlined in the email providers section.

Done when someone who isn't a developer can connect a Postmark account by following `docs/email.md` and send a test, the same works for Amazon SES in London over SMTP, and a bounce reported by Postmark suppresses the address.

Depends on 3, because we need the suppression list before we email anyone.

### 7. Thank-you emails and preference links

- Thank-you and receipt templates the charity can edit, with placeholders such as the donor's name and the amount.
- An email log on each donor: what was sent, when, and whether it bounced.
- Signed one-purpose links in every email, to unsubscribe or update contact preferences without signing in, plus one-click unsubscribe headers.
- A tick box when recording a gift to send the thank-you.

Done when a gift recorded by staff sends a thank-you, and the unsubscribe link works.

Depends on 6.

### 8. Payment platform callbacks

Gifts paid through a payment platform are recorded here automatically. This system never takes a payment itself.

- A callback endpoint for each platform, `POST /api/payments/<platform>`. Each one checks the callback really came from that platform, the way the platform signs them, and refuses anything else.
- Stripe first, then PayPal, plus a generic callback signed with a shared secret for any other platform, or for linking one up through a tool like Zapier.
- A paid callback records the gift and creates or matches the donor by email address. Possible duplicates are flagged for staff rather than merged. The platform's payment id means receiving the same callback twice doesn't record the gift twice.
- Refunds and disputes mark the gift as refunded, so it drops out of totals.
- Gifts made on the platform without our donation page, such as a payment link or donate button the charity already has, still come in with whatever details the platform sends, and are flagged for staff to check.
- Sends the thank-you email.
- Each platform's signing secret is stored the same way as email provider keys.
- `docs/payments.md` for charities connecting their account (what to set up in the platform's dashboard, the callback address, which events to send, how to test it, and a prompt to ask Stripe whether its nonprofit rate applies to them), and `docs/payment-platforms.md` for developers adding a platform.

Done when a payment in Stripe's test mode shows up as a paid gift on the right donor, a refund marks it refunded, and a forged callback is refused.

Depends on 3 and 7.

### 9. Donation pages

Donation pages on this platform, styled with the charity's theme, so the charity's website can stay as information and link here.

- A general donation page, and an optional page for each campaign with its own title, story, image, suggested amounts, progress towards the target and choice of form (ticket 5).
- The form asks for the amount, name, email, contact preferences, Gift Aid (with HMRC's wording and home address) and the charity's own questions.
- On submit we save a pending checkout and send the donor to the payment platform's checkout with our reference. The gift and donor are only created when the paid callback arrives (ticket 8). Pending checkouts that never complete are deleted after 24 hours, so abandoned or spam forms never become donors.
- A thank-you page after payment. It says the gift is being confirmed until the callback has landed.
- A gift through a campaign's page names that campaign directly.
- Bot protection on the form. With no website server in front, this platform does what we ask websites to do for referrals: Turnstile, a honeypot, a minimum time to fill, per-network limits, a size limit and a strict schema.
- Page views, forms started, checkouts started and gifts paid are counted for each page, with the same rules as website analytics: no IP addresses stored, and opt-out and Global Privacy Control respected.
- Every page links to the charity's privacy notice.
- The pages are a separate small public bundle, so the staff app's code isn't served to the public. They work on a phone and are keyboard and screen reader friendly, and the theme's contrast check covers them.
- Can run on its own address, such as `give.example.org`, with the setup in `docs/deploy.md`.

Done when someone can open a campaign's page on a phone, give through Stripe's test mode, and the gift appears on the campaign with its answers and Gift Aid declaration.

Depends on 4, 5 and 8.

### 10. Campaign emails to donors

- Write an email for a campaign, preview it and send a test.
- Pick who it goes to: donors who've agreed to email, aren't suppressed and aren't marked do not contact. Optional filters such as "gave in the last 12 months" or "gave to campaign X".
- Links to the donation pages or the charity's website get the campaign's UTM parameters added automatically, with `utm_medium=email`.
- Queued and sent in batches within the provider's limits. No open tracking.
- A warning before sending a large campaign through SMTP, since bounces won't be picked up.
- Each send is recorded as a touch against the donor and the campaign.
- The campaign page shows how many emails were sent and when.

Done when staff can email a campaign to the right donors and see who it went to.

Depends on 7.

### 11. Attribution

- An attribution window setting in Organisation settings, default 30 days.
- A gift through a campaign's own page, or with a campaign picked by staff, is credited in full to that campaign.
- For any other gift, find the touches within the window before the gift date: email sends to that donor, and the campaign link they arrived through if they gave in the same visit. Group them by campaign and share the gift equally between those campaigns.
- Save the split on the gift as gift credits, with the window used.
- Show on the gift which campaigns it was credited to and why.
- The explanation wording from this plan, next to the setting and on the campaign page.

Done when a gift on the general page from a donor emailed about two campaigns in the last 30 days shows half credited to each, a gift from a donor emailed 40 days ago shows as unattributed, and a gift through a campaign's page goes entirely to that campaign.

Depends on 9 and 10.

### 12. Campaign cookie on the donation pages

This covers people who click a campaign link, leave, and come back to give later.

- The cookie notice from this plan, shown on the donation pages when someone arrives through a campaign link. Nothing is set unless they say yes, and nothing is asked if the browser sends Global Privacy Control or Do Not Track.
- The cookie is first party, `HttpOnly`, `SameSite=Lax` and `Secure`, and is set and read by the server. It keeps up to 5 distinct campaigns, each with when it was clicked, and lasts as long as the attribution window.
- When a gift comes in, the clicks in the cookie become touches and go into the same blended split as emails. Anything outside the window or dated in the future is dropped.
- An optional snippet for the charity's website. When someone arrives on the website through a campaign link and then clicks Donate, it adds the campaign to the link to our donation pages. It only keeps the campaign for that visit, in session storage, but the charity's own cookie policy should still mention it.
- `docs/fundraising.md` explaining attribution, the window and blended credit, with the cookie notice wording and the data protection notes from this plan.

Done when a gift made 10 days after clicking a campaign link, with the cookie accepted, is credited to that campaign, and the same gift with the cookie declined is unattributed.

Depends on 11.

### 13. Campaign performance report

This is the report that answers whether campaigns are working.

- For each campaign over a date range: amount raised (blended), gifts, gifts influenced, donors, new donors, average gift, progress against target, cost, amount raised per £1 spent and emails sent.
- How each donation page converts: page views, forms started, checkouts started and gifts paid, so people can see where donors drop off. Website visits from analytics as well, where the charity's website uses it.
- An overall view with the unattributed total, so people can see how much isn't linked to any campaign.
- A breakdown by month and CSV export, like the existing reports.
- Available over MCP, with no personal data, so people can ask Claude how a campaign went.
- The attribution explanation on the page.

Done when a manager can compare two campaigns side by side, and the blended and unattributed totals add up to the gifts recorded.

Depends on 11.

### 14. Exports for analysis

- A Fundraising export page: pick a date range and download a zip of CSV files for campaigns, gifts, gift credits, touches, campaign emails, donors (by donor reference only), Gift Aid eligibility, answers, daily donation page counts, and daily website visits per campaign code from analytics.
- `docs/fundraising-export.md` describing every file and column, and how they join.
- An allow-list of fields for each file, plus tests that seed obvious personal data (names, emails, phone numbers, full postcodes, free text) and check none of it appears in any file.
- Each export is audited with who took it, when, and the date range.
- Not offered over MCP. Claude can already use the report from ticket 13.

Done when an export loads into a spreadsheet or database, gifts join to their credits and campaigns, and the tests show no personal data in any file.

Depends on 11, and on 5 for the answers.

### 15. Donor sign-in with one-time links

- Part of the public bundle from ticket 9.
- A donor enters their email address and gets a one-time link, valid for 15 minutes and usable once. Only a hash of it is stored.
- The link opens a 30 minute session that can only see donors with that email address.
- The reply is the same whether the address is known or not, so nobody can use it to find out who's a donor. Limits per address and per network.
- Donors can see their gifts, download receipts, update their details and preferences, and make or cancel a Gift Aid declaration.
- Changes are audited with a new channel, "donor".

Done when a donor can sign in from the link, update their address and see the change on their record.

Depends on 4, 7 and 9.

## Later

These aren't in this series, but the data model should allow for them:

- More email adapters, such as Brevo, Mailgun and Resend, and an Amazon SES adapter that picks up bounces through Amazon SNS.
- Regular giving by direct debit or card, arriving through the same payment callbacks.
- HMRC Gift Aid claim export.
- Importing past gifts from JustGiving, Enthuse, PayPal and bank statements.
- Touches logged by staff: letters, calls and events.
- Events and sponsored challenges on the same public pages.
- A scheduled export to a Cloud Storage bucket or BigQuery, using the same tables as ticket 14.
- Weighting touches differently, such as a click counting for more than an email, if equal shares turn out too blunt.
