import { initializeApp, type FirebaseOptions } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

const env = import.meta.env;
const useEmulators = env.VITE_USE_EMULATORS === "true";

/**
 * Firebase web config. Set the VITE_FIREBASE_* variables to choose a project
 * at build time. When they aren't set, the config is read from Firebase
 * Hosting, which serves the project's own at /__/firebase/init.json, so a
 * deployment needs no config file at all.
 */
async function loadConfig(): Promise<FirebaseOptions> {
  if (useEmulators) {
    return { apiKey: env.VITE_FIREBASE_API_KEY || "demo-key", projectId: env.VITE_FIREBASE_PROJECT_ID || "demo-ccm" };
  }
  if (env.VITE_FIREBASE_API_KEY) {
    return {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    };
  }
  const res = await fetch("/__/firebase/init.json");
  if (!res.ok) throw new Error("Firebase config not found. Set the VITE_FIREBASE_* variables or serve the app from Firebase Hosting.");
  const config = (await res.json()) as FirebaseOptions;
  // Sign in through the app's own domain, so the sign in popup and redirect
  // work with browsers that block third party cookies.
  return { ...config, authDomain: location.hostname.endsWith("localhost") ? config.authDomain : location.host };
}

export const app = initializeApp(await loadConfig());

export const auth = getAuth(app);
export const functions = getFunctions(app, "europe-west2");

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
