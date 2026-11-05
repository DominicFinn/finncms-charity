# Charity Contact Management

An open source client and case management system for small charities. It records the people a charity helps, the help given and the outcomes achieved, and reports on impact by place and type of help. It's built to be secure, fully audited and cheap to run on Firebase.

The first deployment is for Nottingham & Derby Irish Elder Support (NDIE).

## What it does

- **Clients**: core details, next of kin and emergency contacts, and questionnaires that each charity builds for itself from reusable questions. Health and finance sets can be marked sensitive.
- **Sessions, callbacks and notes**: appointments and calls, with in-person locations from a managed list. Scheduled follow-ups with reminders, ad hoc notes and file attachments.
- **Outcomes and reports**: outcome measures from the client's and the staff view, split by town, postcode district, location, help category, session type, staff member or month. Reports export to CSV.
- **Safeguarding**: concerns with severity, status, a lead and a full history. Clients with open concerns are flagged to people allowed to see them.
- **Consent and GDPR**: consent records per purpose, restrictions when consent is withdrawn, subject access export and right to erasure.
- **Retention**: a daily job anonymises clients after a configurable period of inactivity. It keeps what's needed for impact reporting and nothing that identifies the person.
- **Audit**: every read and every change is logged with who, what, when and whether it came from the web app or from Claude.
- **Claude**: a built in MCP server lets staff use Claude with the system, with exactly their own permissions and the same auditing.
- **Google Calendar**: sessions and callbacks can appear in each person's own calendar.
- **Theming**: one theme file sets colours, fonts, radius and logo. NDIE has an Irish theme and the default is neutral.

It works on a phone. Staff can sign in and do everything from a mobile.

## How it's built

TypeScript throughout. React with shadcn/ui style components on the front end, and Firebase Authentication, Firestore, Cloud Storage and Cloud Functions behind it.

```
packages/shared   The API contract: operations, input schemas, types and permissions
functions         Cloud Functions: the api callable, MCP server, scheduled jobs, calendar sync
web               The React app
config/seed       Starting configuration (default and NDIE)
scripts           Seed script
docs              Architecture, deployment and MCP guides
```

The key design decision is that browsers never read or write Firestore or Storage directly. The security rules deny everything, and all access goes through one server side dispatcher that checks permissions and writes the audit log. That's what makes "every read is audited" enforceable rather than a convention. [docs/architecture.md](docs/architecture.md) explains it in more detail.

## Running it locally

You need Node 24 or later, Java 21 or later (for the Firebase emulators) and the Firebase CLI (`npm install -g firebase-tools`).

```sh
npm install
cp web/.env.example web/.env.development.local   # set VITE_USE_EMULATORS=true. Only `npm run dev` reads this name, so it never leaks into a deploy build
printf 'BOOTSTRAP_SUPERUSER_EMAIL=you@example.org\nAPP_URL=http://localhost:5173\n' > functions/.env.local
printf 'GOOGLE_OAUTH_CLIENT_SECRET=unused\n' > functions/.secret.local
npm run build -w functions
npx firebase emulators:start --project demo-ccm   # in one terminal
npm run seed -- --config ndie                      # in another, once the emulators are up
npm run dev                                        # the web app on http://localhost:5173
```

Sign in with the emulator's Google popup using the email you set as `BOOTSTRAP_SUPERUSER_EMAIL`. That account becomes the first super user, who can then invite everyone else.

## Tests

```sh
npm test                          # unit tests (shared, web, functions)
npm run test:emulator -w functions   # integration tests against the Firestore and Storage emulators
```

The integration tests cover sign in and invitations, permission checks, read auditing, sealed audit values, search and paging, sensitive questionnaires, consent restrictions, safeguarding, anonymisation, the retention job, reminders, reports, access tokens, the MCP server and the security rules.

## Deploying

See [docs/deploy.md](docs/deploy.md). In short: create a Firebase project in a UK or EU region, set the environment variables, deploy, and run the seed script against the project.

## Using Claude

See [docs/mcp.md](docs/mcp.md). Each person creates a personal access token on their Account page and adds the server to Claude. Claude then works as that person, sees only what they can see, and everything it does appears in the audit log.

## Adapting it for your charity

Run your own copy with your theme, logo and starting configuration in a `site/` folder, so updates to the shared code merge cleanly. [docs/own-deployment.md](docs/own-deployment.md) explains how.

## Open questions

- NDIE's retention period needs confirming with its data protection lead. The default is 3 years after a client's last activity. UK GDPR doesn't set a figure, so each charity has to decide its own.
- The final NDIE questionnaires, help categories and outcome measures. The seed file has a first version based on the spec.
- The licence. A permissive licence such as MIT or Apache 2.0 is planned. Until one is added the code is not licensed for reuse.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues go through [SECURITY.md](SECURITY.md), not public issues.
