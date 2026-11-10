/**
 * Stops a production build that would point the live app at the local
 * emulators. Vite reads web/.env.local in every mode, so emulator settings
 * meant for development can otherwise end up in a deploy, and sign in then
 * fails with auth/auth-domain-config-required.
 */
export function buildEnvProblem(mode: string, env: Record<string, string | undefined>): string | null {
  if (mode !== "production") return null;
  if (env.VITE_USE_EMULATORS === "true") {
    return [
      "This production build has VITE_USE_EMULATORS=true, so the live app would try to use the local emulators.",
      "Move your emulator settings from web/.env.local to web/.env.development.local, which only npm run dev reads.",
    ].join("\n");
  }
  return null;
}
