# Put your charity contact system live

This puts the system live in your own Firebase project. Cloud Shell already has the tools it needs, so there's nothing to install on your computer. It takes about 15 minutes, most of it waiting for Google.

You'll need a Google account the charity controls, and a billing account. Cloud Functions need the pay as you go (Blaze) plan, though a small charity usually stays within the free allowances.

Click **Start** to begin.

## Run the installer

The terminal below is in your copy of the code. If it isn't, run `cd ~/cloudshell_open/finncms-charity` first.

Run:

```sh
./install.sh --here
```

It switches to Node 24 if needed, installs the code, then asks three questions:

1. **A Firebase project id.** Give a new id, such as `riverside-contacts`, and it creates the project. Or give an existing project's id.
2. **Your charity's name.**
3. **The first super user's Google account.** That person gets full access the first time they sign in.

## Link billing if asked

If the project has no billing account, the installer stops and shows a link. Open it, choose **Upgrade** or **Link a billing account**, and come back.

Then carry on from where it stopped:

```sh
./install.sh --here
```

It checks each step before doing it, so running it again is always safe.

## Wait for the deploy

Setup now creates the database and file storage in London, deploys the app and loads your starting lists. The first deploy takes 5 to 10 minutes. A new project often fails the first time while Google sets up permissions, and setup waits and tries again by itself.

## Finish in the console

Google doesn't let a script do the last few steps, so setup lists them at the end with a link to each:

1. Turn on Google sign in.
2. Add your app's address to the sign in client, or sign in fails with `redirect_uri_mismatch`.
3. Set a budget alert and turn on Firestore backups.

If you turned on Google sign in just now, run the installer once more so it can finish:

```sh
./install.sh --here
```

## Sign in

Open the address setup printed, such as `https://riverside-contacts.web.app`, and sign in with the super user's Google account.

Invite your colleagues from **Admin > Users**, and check **Admin > Organisation settings**.

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

To change the name, colours and logo, see `docs/customise.md`. After any change, run `nvm use 24` and then `npm run deploy`.
