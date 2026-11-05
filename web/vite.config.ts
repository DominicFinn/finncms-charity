import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@ccm/shared": fileURLToPath(new URL("../packages/shared/src/index.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Lets an MCP client point at the dev server while the emulators run.
      "/mcp": { target: "http://127.0.0.1:5001", rewrite: () => "/demo-ccm/europe-west2/mcp" },
    },
  },
});
