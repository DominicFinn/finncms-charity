# Deploying

This takes about half an hour the first time.

## 1. Create the Firebase project

1. Create a project at https://console.firebase.google.com. Upgrade it to the Blaze plan, which Cloud Functions need. A small charity should stay inside the free allowances most months. Set a budget alert anyway.
2. Create the Firestore database in **europe-west2 (London)**. The functions run in europe-west2, and Firestore triggers must be in the same region as the database. If you choose another UK or EU region, change `REGION` in `functions/src/core/firebase.ts` and the region in `firebase.json` to match.
3. Create the default Cloud Storage bucket in the same region.
4. In Authentication, enable the **Google** sign in provider. Under Settings > Authorized domains, add the domain the app will be served from. The app signs in through its own domain, so in Google Cloud console > Google Auth Platform > Clients, open the "Web client (auto created by Google Service)" and add `https://<your-domain>` to Authorised JavaScript origins and `https://<your-domain>/__/auth/handler` to Authorised redirect URIs. Do this for `<project-id>.web.app` and any custom domain, or sign in fails with `redirect_uri_mismatch`.
5. Register a web app in Project settings. The app reads its config from Firebase Hosting when it starts, so there is nothing to copy.

## 2. Configure

```sh
cp .firebaserc.example .firebaserc        # put your project id in it
cp functions/.env.example functions/.env.<project-id>
```

In `functions/.env.<project-id>` set:

- `BOOTSTRAP_SUPERUSER_EMAIL`: the Google account of the first super user.
- `APP_URL`: where the app will be served, for example `https://your-project.web.app`.
- `GOOGLE_OAUTH_CLIENT_ID`: only if you'll use calendar sync (step 5).

Set the OAuth secret. If you aren't using calendar sync, enter any placeholder value:

```sh
npx firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET
```

## 3. Allow signed URLs for files

Files are uploaded and downloaded with short-lived signed URLs. The functions' service account signs them, which needs the "Service Account Token Creator" role on itself:

```sh
SA="$(gcloud projects describe <project-id> --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:$SA" --role="roles/iam.serviceAccountTokenCreator" --project <project-id>
```

Uploads go straight from the browser to the bucket, so the bucket needs a CORS rule for your app's origin:

```sh
cat > cors.json <<'JSON'
[{ "origin": ["https://your-project.web.app"], "method": ["PUT", "GET"], "responseHeader": ["Content-Type"], "maxAgeSeconds": 3600 }]
JSON
gcloud storage buckets update gs://<your-bucket> --cors-file=cors.json
```

## 4. Deploy and seed

```sh
npm install
npm run build -w web
npx firebase deploy
gcloud auth application-default login
npm run seed -- --config default --project <project-id>   # or your own seed file
```

Open the app and sign in with the bootstrap email. You're now the super user. Invite your colleagues from Admin > Users, and check the settings under Admin > Organisation.

## 5. Calendar sync (optional)

1. In Google Cloud console > APIs & Services, enable the Google Calendar API.
2. Configure the OAuth consent screen. Choose "Internal" if everyone is in one Google Workspace.
3. Create an OAuth client of type "Web application" with the redirect URI `https://<your app domain>/oauth/calendar`.
4. Put the client id in `functions/.env.<project-id>`, set the secret as in step 2, and redeploy the functions.
5. Turn on calendar sync in Admin > Organisation. Each person then connects their calendar from their Account page.

## Backups

Turn on scheduled Firestore backups (Firestore > Disaster recovery) and keep them for as short a time as your policy allows. A backup taken before a client was anonymised still holds that client's data until it expires. Note the backup retention period in your data protection records.

## Updating

Pull the latest code, run the tests, then `npx firebase deploy`. Seeding again won't overwrite anything an administrator has changed unless you pass `--overwrite`.
