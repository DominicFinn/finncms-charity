/**
 * Creates the site/ folder that holds everything specific to your charity.
 *
 *   npm run site:init -- --name "My Charity"
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "./lib/exec.js";
import { placeholderLogo, seedWithName, themeTemplate } from "./lib/site.js";

const { values } = parseArgs({ options: { name: { type: "string" }, force: { type: "boolean", default: false } } });
const name = values.name?.trim();
if (!name) {
  console.log('Give your charity\'s name, for example:\n  npm run site:init -- --name "My Charity"');
  process.exit(1);
}

const dir = join(REPO_ROOT, "site");
if (existsSync(join(dir, "theme.ts")) && !values.force) {
  console.log("site/ already exists, so nothing was changed. Pass --force to start again (this replaces your theme, logo and seed file).");
  process.exit(1);
}

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "theme.ts"), themeTemplate(name));
writeFileSync(join(dir, "logo.svg"), placeholderLogo(name));
writeFileSync(join(dir, "seed.json"), seedWithName(readFileSync(join(REPO_ROOT, "config/seed/default.json"), "utf8"), name));

console.log(`Created site/ for ${name}:

  site/theme.ts   colours, fonts, corners and the app name
  site/logo.svg   a placeholder logo; replace it with yours
  site/seed.json  starting help categories, session types, locations and questions

Next:
  1. Edit site/theme.ts and replace site/logo.svg.
  2. See it with npm run dev (with the emulators running), and check colours with npm run site:check.
  3. Run npm run setup to put it live, or npm run deploy if it's live already.

docs/customise.md explains each step.`);
