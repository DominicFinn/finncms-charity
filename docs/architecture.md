# Architecture

## Request path

Every read and write follows the same path, whether it comes from the web app or from Claude:

1. The caller is identified. The web app sends a Firebase ID token to the `api` callable function. Claude sends a personal access token to the `mcp` function.
2. `resolveCaller` (`functions/src/core/context.ts`) finds the user record and refuses anyone who hasn't been invited, isn't in an allowed domain or has been deactivated. It works out their permissions from their roles.
3. `dispatch` (`functions/src/core/dispatch.ts`) checks the operation exists, checks the permission it needs, validates the input against the schema in `packages/shared/src/ops.ts` and runs the handler.
4. The handler applies the finer rules: sensitive question sets, consent restrictions, anonymised records, safeguarding visibility.
5. Writes add their audit entry to the same Firestore batch as the change, so the two land together or not at all. For reads, the dispatcher writes the audit entry before returning the data. If the audit write fails, the caller gets an error rather than the data.

Firestore and Storage security rules deny all access from browsers. Nothing can skip this path, which is why every read can be audited.

## The operation registry

`packages/shared/src/ops.ts` lists every operation with its input schema, the permission it needs, a description, whether it changes data and whether it's offered over MCP. The web app's API client, the server dispatcher and the MCP tool list are all driven from it, so adding an operation means:

1. Add it to `ops` and `OpOutputs` in the shared package.
2. Add the handler in `functions/src/handlers`. The functions won't start if any operation lacks a handler.
3. Call it from the web app with `api("name", input)`.

## Audit and anonymisation

The audit log is append only. No operation updates or deletes an audit entry, and the security rules stop anyone else doing so.

That creates a tension with anonymisation. Audit entries for changes hold before and after values, which include personal data, and those values can't be removed from an append-only log. The answer is crypto-shredding. Each client has a random key in the server-only `clientKeys` collection. Before and after values for that client are encrypted with it (AES-256-GCM). Anonymising the client deletes the key. The audit entries stay, still showing who did what and when, but the old values can no longer be read. The audit log viewer says so where that has happened.

Firestore backups taken before an anonymisation still contain the key until they expire. Keep the backup retention period short and document it in your data protection records.

Audit `detail` text never contains personal data. That's why the erasure operation takes a fixed basis ("erasure request" or "no longer needed") rather than a free text reason.

## What anonymisation keeps

| Record | Kept | Removed |
| --- | --- | --- |
| Client | id, status, help categories, postcode district, created and last activity month | everything else |
| Sessions | type, status, duration, help categories, staff member, location from the managed list, month | notes, "Other" location description, exact time, town |
| Callbacks | assignee, status, month | reason, exact time |
| Outcomes | answers to non free text questions, help category, perspective, month, postcode district | free text answers, town, location |
| Safeguarding (closed) | severity, status, month | description, history |
| Questionnaire answers, notes, files, consent records | nothing | deleted, including stored files |

A client with an open safeguarding concern isn't anonymised until the concern is closed. Scheduled sessions and open callbacks are cancelled, and their calendar events removed.

The retention job has three safeguards against mistakes. A client is anonymised only after managers have been warned about them and the full warning period has passed since, so shortening the retention period never takes effect overnight. Shortening the period needs the permission to anonymise clients. And one run anonymises at most 100 clients.

## Consent restrictions

The latest consent record for each purpose decides whether a restriction applies. A client with no record for a purpose has no restriction, because consent isn't always the lawful basis being relied on.

| Withdrawn | Effect |
| --- | --- |
| Data processing | Client is marked restricted. No new sessions, callbacks, notes, answers, outcomes or files. Details can still be corrected, and safeguarding concerns can still be raised. |
| Sensitive data | No new answers to sensitive question sets. |
| Contact | No new or reopened callbacks. |
| Sharing with partners | Shown on the record for staff to follow. |

Recording consent again lifts the restriction.

## Who sees what in the audit log

People with the audit permission see who did what and when for every entry. They see before and after values only where they could see that kind of record anyway: sensitive answers and outcomes need the sensitive questionnaire permission, and safeguarding entries need safeguarding access. Viewing audit entries about a client is itself recorded as access to that client.

## Session locations

In-person sessions pick their location from a managed list (for example client's home, hospital, community centre). One entry is marked as "Other", and choosing it asks for a short description. Reports group by the list entry, so a description typed under Other never appears in a report. Administrators see the Other descriptions with how often each was used, and can promote one to its own list entry, which moves the matching past sessions across.

## Search

Firestore has no full text search, so each client carries a list of name and postcode prefixes. Search sends the first word to Firestore and checks the remaining words in the function. That's fine for the few thousand records a small charity holds. A larger organisation would want a search service.

## Reports

Reports read sessions, callbacks and outcomes and aggregate them in the function. The fields reports need (town, postcode district, location, session type, staff) are copied onto sessions and outcomes when they're written, so reports don't need joins and the figures reflect where the person lived when they were helped. Reports never return personal data.

## Scheduled jobs

| Function | Schedule | Purpose |
| --- | --- | --- |
| `retentionDaily` | 02:30 every day | Anonymise clients past the retention period, warn managers about upcoming ones, remove abandoned uploads |
| `callbackReminders` | every 15 minutes | In-app notifications when a callback is coming up and when it's overdue |

## Calendar sync

When an organisation turns calendar sync on, each user can connect their Google Calendar from their Account page. Firestore triggers keep one event per scheduled session or open callback in the assigned person's calendar. Events hold the client's initials, the session type and a link back. A hash of the event content stops the triggers writing in a loop. Done, cancelled and anonymised records have their events removed.
