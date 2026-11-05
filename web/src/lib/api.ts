import type { ApiErrorCode, OpInput, OpName, OpOutput } from "@ccm/shared";
import { FirebaseError } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

const callable = httpsCallable<{ op: OpName; input: unknown }, unknown>(functions, "api", { timeout: 120_000 });

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Calls one operation on the server. Every read and write goes through here. */
export async function api<N extends OpName>(op: N, input: OpInput<N>): Promise<OpOutput<N>> {
  try {
    // The callable SDK turns undefined into null, so drop undefined keys first.
    const clean = input === undefined ? {} : (JSON.parse(JSON.stringify(input)) as unknown);
    const res = await callable({ op, input: clean });
    return res.data as OpOutput<N>;
  } catch (e) {
    if (e instanceof FirebaseError) {
      const code = e.code.replace(/^functions\//, "") as ApiErrorCode;
      throw new ApiError(code, e.message, (e as FirebaseError & { details?: unknown }).details);
    }
    throw e;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "permission-denied":
        return e.message || "You don't have permission to do that.";
      case "unauthenticated":
        return "Your session has ended. Please sign in again.";
      case "invalid-argument":
        return e.message || "Some of the details aren't valid.";
      default:
        return e.message || "Something went wrong.";
    }
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
