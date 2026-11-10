# Making it your own

Everything specific to your charity lives in one folder, `site/`: your name, colours, fonts, logo and starting lists. You don't need to change any other file. Because the shared code never touches `site/`, you can take updates later without losing your changes.

## 1. Make your own copy

You need your own copy of the code so you can keep your `site/` folder in it. A private repository is best.

```sh
git clone https://github.com/DominicFinn/finncms-charity.git my-charity-contacts
cd my-charity-contacts
git remote rename origin upstream
git remote add origin <your private repository address>
git push -u origin main
npm install
```

## 2. Create your site folder

```sh
npm run site:init -- --name "Your Charity Name"
```

This creates:

| File | What it is |
| --- | --- |
| `site/theme.ts` | Your name, colours, fonts and how rounded corners are |
| `site/logo.svg` | A placeholder logo with your initials |
| `site/seed.json` | Your starting help categories, session types, locations and questions |

## 3. Change the look

Open `site/theme.ts` in any text editor. Each line has a note saying what it changes. Change the values between the quotes and save.

| Setting | What it changes | Example |
| --- | --- | --- |
| `appName` | The name in the side menu and browser tab | `"Riverside Elders"` |
| `logo` | Your logo. Replace `site/logo.svg`, or put a PNG in `site/` and change the import to `import logo from "./logo.png"` | |
| `colours.primary` | Buttons, links and highlights | `"#0b5d3b"` |
| `colours.primaryText` | Text on primary buttons. Usually white or very dark | `"#ffffff"` |
| `colours.background` | Page background | `"#ffffff"` |
| `colours.text` | Main text | `"#10302b"` |
| `colours.soft` | Soft tint for tags, hover states and quiet panels | `"#e8f3ee"` |
| `colours.softText` | Text on the soft tint. Leave out to use `text` | `"#10302b"` |
| `colours.sidebar` | Side menu background | `"#173f3a"` |
| `colours.sidebarText` | Side menu text | `"#ffffff"` |
| `colours.border` | Lines around cards and boxes | `"#d5e3dc"` |
| `darkColours` | The same colour settings, for people whose device is in dark mode. Leave out to use neutral dark colours | `{ primary: "#9fd8bf", primaryText: "#0b2b22" }` |
| `fonts.body` | The main font | `'"Atkinson Hyperlegible", sans-serif'` |
| `fonts.headings` | The heading font. Leave out to use the body font | `'"Bricolage Grotesque", sans-serif'` |
| `fonts.googleFontsUrl` | The link for your fonts from Google Fonts | `"https://fonts.googleapis.com/css2?family=..."` |
| `fonts.sizePx` | Text size. 16 is normal, 18 is easier for older eyes | `18` |
| `roundness` | How rounded corners are, from `"0.25rem"` (sharp) to `"1rem"` (very round) | `"0.75rem"` |
| `overrides` | Full control over any individual colour. Most charities don't need this | |

Colours can be any web colour. Hex codes such as `#0b5d3b` are easiest, and you can copy them from your brand guidelines.

To use Google Fonts, pick the fonts at https://fonts.google.com, click "Get embed code", and copy the link that starts `https://fonts.googleapis.com/css2?`. Put the font names in `body` and `headings`.

### Check your colours are easy to read

```sh
npm run site:check
```

This checks every text colour against its background and names any that are hard to read, with how far off they are. Aim for at least 4.5 to 1, the level the accessibility guidelines ask for.

### See it before it goes live

Start the local copy (see "Running it locally" in the README), open http://localhost:5173 and the app shows your theme. Changes appear as soon as you save.

Your site theme is always used when `site/theme.ts` exists. You don't need to set anything else.

## 4. Change the starting lists

`site/seed.json` holds the lists the app starts with:

| Section | What it is |
| --- | --- |
| `org` | Your charity's name and settings, such as how long records are kept (`retentionMonths`) |
| `helpCategories` | The kinds of help you give, such as "Benefits advice" |
| `sessionTypes` | Kinds of session, such as "Home visit" or "Phone call". `inPerson` asks for a location |
| `sessionLocations` | Where in-person sessions happen. Keep the one with `"isOther": true` so staff can type a place that isn't listed |
| `questions` | Questions you ask clients, and the outcome measures you track |
| `questionSets` | Groups of questions. `sensitive` sets (health, finance) are only shown to people allowed to see them |

Each entry needs an `id`: a short name in lower case with hyphens, such as `"home-visit"`. Don't change an `id` once the app is live, because records refer to it.

These are only starting lists. After you're live, administrators change them in the app under Admin, and loading the seed file again never overwrites their changes.

## 5. Put it live

If you haven't set up Firebase yet:

```sh
npm run setup
```

If you're live already:

```sh
npm run deploy
npm run seed -- --config ../site/seed.json --project <your project id>   # only for new lists
```

[deploy.md](deploy.md) explains setup step by step.

## 6. Save your changes

Commit your `site/` folder and your Firebase settings to your own repository. The shared code ignores the Firebase settings so nobody commits theirs by accident, so add them on purpose. They hold no secrets.

```sh
git add site
git add -f .firebaserc functions/.env.<your project id>
git commit -m "Our charity's settings"
git push
```

Never commit `functions/.secret.local` or anything holding a password or key.

## Taking updates

When the shared code improves, bring the changes into your copy:

```sh
git fetch upstream
git merge upstream/main
npm install
npm run deploy
```

Your `site/` folder is never changed by an update, so the merge goes through cleanly.

## Going further

Developers can write a complete theme by hand instead of using `makeTheme`. Copy `web/src/theme/default.ts` into `site/theme.ts` and export it as the default. Every colour token is listed in `web/src/theme/types.ts`.
