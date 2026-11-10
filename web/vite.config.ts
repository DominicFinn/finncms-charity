import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { buildEnvProblem } from "./build-guard";

export default defineConfig(({ mode, command }) => {
  if (command === "build") {
    const problem = buildEnvProblem(mode, { ...loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "VITE_"), ...process.env });
    if (problem) throw new Error(problem);
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@ccm/shared": fileURLToPath(new URL("../packages/shared/src/index.ts", import.meta.url)),
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    // Top level await is used to load the Firebase config before the app starts.
    build: { target: "es2022" },
    server: {
      port: 5173,
      proxy: {
        // Lets an MCP client point at the dev server while the emulators run.
        "/mcp": { target: "http://127.0.0.1:5001", rewrite: () => "/demo-ccm/europe-west2/mcp" },
      },
    },
  };
});
