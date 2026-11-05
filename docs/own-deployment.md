# Running your own copy

Each charity runs its own copy in its own Firebase project. Keep the shared code as it is and put everything specific to your charity in a `site/` folder and your Firebase config. Updates to the shared code then merge without conflicts.

## Set up your copy

```sh
git clone https://github.com/DominicFinn/finncms-charity.git my-charity-contacts
cd my-charity-contacts
git remote rename origin upstream
git remote add origin <your private repository>
git push -u origin main
```

To take updates later:

```sh
git fetch upstream
git merge upstream/main
```

## The site folder

```
site/
  theme.ts      Your theme: colours, fonts, radius, logo and app name
  logo.svg      Your logo, imported by theme.ts
  seed.json     Your help categories, session types and locations, questions and settings
```

`site/theme.ts` exports a theme as its default. Copy `web/src/theme/default.ts` to start:

```ts
import type { Theme } from "../web/src/theme/types";
import logo from "./logo.svg";

const theme: Theme = {
  id: "site",
  appName: "Our contacts",
  logo,
  // colours, typography and radius as in web/src/theme/default.ts
};

export default theme;
```

The web app uses it automatically. Seed your project with `npm run seed -- --config ../site/seed.json --project <project-id>`.

## Firebase config

The shared repository ignores `.firebaserc` and `functions/.env.<project-id>` so nobody commits their project by accident. In your own copy, add them on purpose, because they hold no secrets:

```sh
git add -f .firebaserc functions/.env.<project-id> web/.env.production
```

Never commit `functions/.secret.local` or any real secret. Secrets go in Secret Manager (see [deploy.md](deploy.md)).
