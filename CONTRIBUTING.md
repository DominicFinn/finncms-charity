# Contributing

Thanks for helping. This system holds sensitive data about vulnerable people, so changes get a careful review.

## Getting started

Follow "Running it locally" in the README. Before opening a pull request, run:

```sh
npm run typecheck
npm test
npm run test:emulator -w functions
```

CI runs the same checks plus a dependency audit and CodeQL.

## Ground rules

- **All data access goes through the dispatcher.** Don't loosen `firestore.rules` or `storage.rules`, and don't read Firestore from the web app. New features are new operations in `packages/shared/src/ops.ts` with a handler in `functions/src/handlers`.
- **Every write is audited in the same batch.** Use `auditInBatch` with the change. Pass `clientIds` whenever a client's data is involved, so the values are sealed and the client access report finds them.
- **Reads record the clients they touch.** Call `clientFor` or add to `ctx.touched`.
- **No personal data in audit `detail`, notifications, logs or calendar events.**
- **Think about anonymisation.** If you add a field or collection holding client data, update `functions/src/jobs/anonymise.ts` and its test.
- **No charity-specific content in the code.** Questions, categories and wording for one charity belong in a seed file under `config/seed`.
- **Tests.** New rules need an integration test in `functions/test`.

## Other identity providers

Google sign in is the only provider on purpose. If your charity needs another, open an issue first to agree the approach. It must keep the same guarantees: an invitation or allowed domain is needed, verified email, and no self sign-up.

## Writing

Interface copy and docs are in British English, plain and direct. Please don't use em dashes.

## Security issues

Report them privately as described in [SECURITY.md](SECURITY.md).
