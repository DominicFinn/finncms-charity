import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

const env = import.meta.env;
const useEmulators = env.VITE_USE_EMULATORS === "true";

export const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY || (useEmulators ? "demo-key" : undefined),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || (useEmulators ? "demo-ccm" : undefined),
  appId: env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
export const functions = getFunctions(app, "europe-west2");

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
