// Bundles the functions with the shared package inlined. Third party
// dependencies stay external and are installed by Cloud Build from
// package.json, so the shared workspace never has to be published.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

await build({
  entryPoints: ["src/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  external: Object.keys(pkg.dependencies),
  alias: { "@ccm/shared": "../packages/shared/src/index.ts" },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
