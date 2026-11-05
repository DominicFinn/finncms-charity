import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@ccm/shared": fileURLToPath(new URL("../packages/shared/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.emulator.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      GCLOUD_PROJECT: "demo-ccm",
      FUNCTIONS_EMULATOR: "true",
      BOOTSTRAP_SUPERUSER_EMAIL: "boss@example.org",
      FIREBASE_CONFIG: JSON.stringify({ projectId: "demo-ccm", storageBucket: "demo-ccm.appspot.com" }),
    },
  },
});
