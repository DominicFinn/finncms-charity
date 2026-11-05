import { ops } from "@ccm/shared";
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { resolveCaller } from "./core/context.js";
import { dispatch, isOpName, registerHandlers } from "./core/dispatch.js";
import { fail } from "./core/errors.js";
import { REGION } from "./core/firebase.js";
import { handlers } from "./handlers/index.js";
import { runReminders } from "./jobs/reminders.js";
import { runRetention } from "./jobs/retention.js";

setGlobalOptions({ region: REGION, maxInstances: 10 });

const missing = Object.keys(ops).filter((name) => !(name in handlers));
if (missing.length) throw new Error(`Operations without handlers: ${missing.join(", ")}`);
registerHandlers(handlers);

/** The single entry point for the web app. */
export const api = onCall({ region: REGION, cors: true, timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  if (!request.auth) throw fail.unauthenticated();
  const { op, input } = (request.data ?? {}) as { op?: unknown; input?: unknown };
  if (!isOpName(op)) throw fail.invalid("Unknown operation.");
  const token = request.auth.token;
  const ctx = await resolveCaller(
    {
      uid: request.auth.uid,
      email: token.email,
      emailVerified: token.email_verified,
      name: token.name as string | undefined,
      picture: token.picture,
      provider: token.firebase?.sign_in_provider,
    },
    "ui",
  );
  return dispatch(op, input, ctx);
});

export const retentionDaily = onSchedule({ schedule: "every day 02:30", timeZone: "Europe/London", region: REGION, timeoutSeconds: 540 }, async () => {
  await runRetention();
});

export const callbackReminders = onSchedule({ schedule: "every 15 minutes", timeZone: "Europe/London", region: REGION }, async () => {
  await runReminders();
});

export { mcp } from "./mcp.js";
export { collect } from "./analytics/collect.js";
export { calendarOAuthCallback, syncCallbackToCalendar, syncSessionToCalendar } from "./calendar.js";
