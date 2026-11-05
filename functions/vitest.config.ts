import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@ccm/shared": fileURLToPath(new URL("../packages/shared/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.unit.test.ts"],
  },
});
