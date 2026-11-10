# Putting it live

It takes about 15 minutes the first time, most of it waiting for Google. You answer three questions and setup does the rest.

Everyone needs:

- **A Google account** that will own the project. Use an account the charity controls, not a personal one that might leave.
- **A billing account** on Google Cloud. Cloud Functions need the pay as you go (Blaze) plan. A small charity usually stays within the free allowances, and setup reminds you to set a budget alert.

## Easiest: Google Cloud Shell

Nothing to install. Cloud Shell is a terminal in your browser that already has Google's tools signed in.

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/open?cloudshell_git_repo=https://github.com/DominicFinn/finncms-charity&cloudshell_tutorial=docs/cloudshell-tutorial.md)

Click the button, sign in with the charity's Google account, and follow the steps in the panel on the right. They come down to running `./install.sh --here`.

## On your own computer

You need Node 24 or later (https://nodejs.org), git, and the Google Cloud CLI (https://cloud.google.com/sdk/docs/install) signed in with `gcloud auth login`. Then run:

```sh
curl -fsSL https://raw.githubusercontent.com/DominicFinn/finncms-charity/main/install.sh | bash
```

The installer checks your tools and tells you how to get anything missing. It copies the code into a folder, installs it and runs setup. To install your own fork, add its address: `... | bash -s -- https://github.com/your-charity/your-fork.git`.

If you already have a copy of the code, run `npm install` and `npm run setup` in it instead.

If you want your own name, colours and logo, see [customise.md](customise.md). You can do it before or after going live.

## What setup does

Setup asks three questions:

| Question | What to give |
| --- | --- |
| Firebase project id | A new id such as `riverside-contacts`, or an existing project. Ids are global, so pick something specific |
| Your charity's name | Shown in the app |
| First super user | The Google account of the person who'll run the system. They get full access the first time they sign in |

It uses `site/seed.json` for the starting lists if you have one, otherwise the default lists. Then it works through these steps, checking each one first so nothing is done twice:

1. Checks your tools and sign ins.
2. Finds or creates the Firebase project.
3. Checks billing is linked. If it isn't, it gives you the link and stops. Link billing and run `npm run setup` again.
4. Turns on the Google Cloud services the system uses.
5. Creates the database and file storage in London (europe-west2).
6. Lets the app sign file links and accept uploads from its own addresses.
7. Writes `.firebaserc` and `functions/.env.<project id>`. Neither holds secrets.
8. Sets a placeholder for the calendar secret and registers the web app.
9. Builds and deploys. A new project often fails the first deploy while Google sets up permissions, so setup waits and tries again.
10. Loads your starting lists.
11. Allows sign in from the app's addresses.

You can pass the answers as flags instead, and add a custom domain or a different seed file:

```sh
npm run setup -- --project riverside-contacts --name "Riverside Elders" --email manager@riverside.org --domain contacts.riverside.org --seed site/seed.json --create
```

Running setup again is safe. Use it to add a custom domain later (`--domain`), or if something stopped part way.

The Firebase CLI comes with the code, so you don't install it separately. It signs in with your Google Cloud credentials. If setup says it couldn't sign in, run `npx firebase login` (in Cloud Shell, `npx firebase login --no-localhost`).

## Finish in the console

Google doesn't let a script do these, so setup ends by listing them with direct links:

1. **Turn on Google sign in.** Firebase console > Authentication > Get started > Sign-in method > Google > Enable.
2. **Allow sign in from your app's address.** Google Cloud console > Google Auth Platform > Clients > "Web client (auto created by Google Service)". Add `https://<your domain>` to Authorised JavaScript origins and `https://<your domain>/__/auth/handler` to Authorised redirect URIs, for `<project>.web.app` and any custom domain. Save.
3. **Connect your custom domain**, if you have one. Hosting > Add custom domain, then add the DNS records it shows. The certificate can take up to an hour.
4. **Set a budget alert** in Google Cloud billing.
5. **Turn on Firestore backups** under Firestore > Disaster recovery. Keep them for as short a time as your policy allows. A backup taken before a client was anonymised still holds that client's details until it expires.

If you turned on Google sign in for the first time, run `npm run setup` once more so it can add the sign in addresses.

Then open the app and sign in as the first super user. Invite colleagues from Admin > Users and check Admin > Organisation settings.

## Check everything

```sh
npm run doctor
```

This checks the project without changing anything and lists anything missing, with the fix for each.

## Updating

```sh
git fetch upstream
git merge upstream/main
npm install
npm test
npm run deploy
```

`npm run deploy` builds the web app and functions and deploys them, retrying the failures that clear up on their own. Use `npm run deploy -- --only functions` or `--only hosting` to deploy part of it.

New permissions in an update reach the super user automatically. For other roles, add them under Admin > Roles.

## Optional extras

### Calendar sync

1. In Google Cloud console > APIs & Services, enable the Google Calendar API.
2. Configure the OAuth consent screen. Choose "Internal" if everyone is in one Google Workspace.
3. Create an OAuth client of type "Web application" with the redirect URI `https://<your domain>/oauth/calendar`.
4. Put the client id in `GOOGLE_OAUTH_CLIENT_ID` in `functions/.env.<project id>`. Set the client secret with `npx firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET`, then `npm run deploy -- --only functions`.
5. Turn on calendar sync in Admin > Organisation settings. Each person then connects their calendar from their Account page.

### Referrals from your website

Create an integration key in Admin > Integration keys and give it to your website's server. [referrals.md](referrals.md) explains the website side.

### Website analytics

Add your website's address under Admin > Organisation settings > Website analytics, then add the tracking script to your site. [analytics.md](analytics.md) explains how.

### Another region

The code runs in europe-west2 (London). To use another UK or EU region, change `REGION` in `functions/src/core/firebase.ts` and `scripts/lib/cloud.ts`, and the region in each rewrite in `firebase.json`. The database and the functions must be in the same region.

## Troubleshooting

**Sign in fails with `auth/auth-domain-config-required`.** The live app was built with local emulator settings. Vite reads `web/.env.local` for every build. Keep emulator settings in `web/.env.development.local` instead. The build now refuses to go ahead when this happens, and says so.

**Sign in fails with `Error 400: redirect_uri_mismatch`.** The app's address is missing from the OAuth client. Do "Allow sign in from your app's address" above. Changes can take a few minutes to apply.

**The website gets 403 from `/api/collect` or `/api/referrals`, and the function's logs say "The request was not authenticated".** A deploy was interrupted after creating the function but before making it public. Run `npm run deploy -- --only functions`. `npm run doctor` reports this.

**The first deploy fails with "Permission denied while using the Eventarc Service Agent", "Retry the deployment in a few minutes" or a 409.** Google is still setting up a new project. Setup and `npm run deploy` retry automatically. If they still fail, wait five minutes and run `npm run deploy`.

**"Your credentials are no longer valid".** Run `npx firebase login --reauth`, then deploy again.

**Seeding fails with a credentials error.** Run `gcloud auth application-default login`.

**The local emulators say "Could not start Hosting Emulator, port taken".** On a Mac, AirPlay Receiver uses port 5000. Start the emulators without hosting: `npx firebase emulators:start --only auth,firestore,storage,functions --project demo-ccm`. The app runs on the Vite dev server anyway.

**A global npm tool says it isn't installed after an update.** npm 11 doesn't run install scripts unless you allow them, so some tools install only partly. Reinstall with the script allowed, for example `npm install -g @anthropic-ai/claude-code --allow-scripts=@anthropic-ai/claude-code`.
