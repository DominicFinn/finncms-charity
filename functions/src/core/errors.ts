import { HttpsError } from "firebase-functions/v2/https";

export const fail = {
  unauthenticated: (msg = "Please sign in.") => new HttpsError("unauthenticated", msg),
  denied: (msg = "You don't have permission to do that.") => new HttpsError("permission-denied", msg),
  notFound: (what = "Record") => new HttpsError("not-found", `${what} not found.`),
  invalid: (msg: string, details?: unknown) => new HttpsError("invalid-argument", msg, details),
  precondition: (msg: string) => new HttpsError("failed-precondition", msg),
  exists: (msg: string) => new HttpsError("already-exists", msg),
};

export { HttpsError };
