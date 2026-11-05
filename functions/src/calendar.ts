/**
 * Google Calendar sync. Sessions and open callbacks appear in the assigned
 * user's own Google Calendar, so the system doesn't rebuild calendar
 * features. Events hold minimal personal data: the client's initials, the
 * session type and a link back to the record.
 *
 * Each user connects their calendar once (OAuth, calendar.events scope). The
 * refresh token is stored in a server-only collection.
 */
import { initials } from "@ccm/shared";
import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { google } from "googleapis";
import { auditNow } from "./core/audit.js";
import { getOrgSettings } from "./core/context.js";
import { randomToken } from "./core/crypto.js";
import type { HandlerGroup } from "./core/dispatch.js";
import { fail } from "./core/errors.js";
import { C, db, REGION } from "./core/firebase.js";

// Plain environment variables rather than params, so deploys don't stop to
// ask for values when an organisation doesn't use calendar sync.
const GOOGLE_OAUTH_CLIENT_ID = { value: () => process.env.GOOGLE_OAUTH_CLIENT_ID ?? "" };
const APP_URL = { value: () => process.env.APP_URL ?? "http://localhost:5173" };
export const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];

function redirectUri() {
  return `${APP_URL.value().replace(/\/$/, "")}/oauth/calendar`;
}

function oauthClient(withSecret = true) {
  return new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID.value(), withSecret ? GOOGLE_OAUTH_CLIENT_SECRET.value() : undefined, redirectUri());
}

/** Removes and revokes a user's calendar access. Used on disconnect and deactivation. */
export async function disconnectCalendar(uid: string) {
  const ref = db.collection(C.calendarTokens).doc(uid);
  const token = (await ref.get()).get("refreshToken") as string | undefined;
  if (token) {
    await new google.auth.OAuth2().revokeToken(token).catch((err) => logger.warn("Token revoke failed", { err: String(err) }));
  }
  await ref.delete();
  await db.collection(C.users).doc(uid).update({ calendarConnected: false }).catch(() => undefined);
}

async function calendarFor(uid: string) {
  const user = await db.collection(C.users).doc(uid).get();
  if (user.get("active") !== true) return null;
  const snap = await db.collection(C.calendarTokens).doc(uid).get();
  const refreshToken = snap.get("refreshToken") as string | undefined;
  if (!refreshToken) return null;
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth });
}

/** Only allow returning to a path inside the app. */
function safeReturn(path: string | undefined) {
  return path && path.startsWith("/") && !path.startsWith("//") ? path : "/account";
}

export const calendarHandlers: HandlerGroup = {
  async "calendar.connectUrl"(input, ctx) {
    if (!ctx.org.calendarSyncEnabled || !GOOGLE_OAUTH_CLIENT_ID.value()) {
      throw fail.precondition("Calendar sync isn't set up for this organisation.");
    }
    const state = randomToken(24);
    await db.collection(C.oauthStates).doc(state).set({
      uid: ctx.uid,
      returnTo: safeReturn(input.returnTo),
      expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000),
    });
    const url = oauthClient(false).generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
      state,
      login_hint: ctx.user.email,
      include_granted_scopes: true,
    });
    return { url };
  },

  async "calendar.disconnect"(_input, ctx) {
    await disconnectCalendar(ctx.uid);
    await auditNow(ctx, { action: "update", entity: "user", entityId: ctx.uid, op: "calendar.disconnect", detail: "Calendar disconnected" });
    return { ok: true };
  },
};

/** OAuth redirect target, served at /oauth/calendar through a Hosting rewrite. */
export const calendarOAuthCallback = onRequest({ region: REGION, secrets: [GOOGLE_OAUTH_CLIENT_SECRET] }, async (req, res) => {
  const app = APP_URL.value().replace(/\/$/, "");
  const state = String(req.query.state ?? "");
  const code = String(req.query.code ?? "");
  if (!state || !/^[A-Za-z0-9_-]+$/.test(state)) {
    res.redirect(`${app}/account?calendar=error`);
    return;
  }
  const stateRef = db.collection(C.oauthStates).doc(state);
  const stateSnap = await stateRef.get();
  await stateRef.delete().catch(() => undefined);
  const uid = stateSnap.get("uid") as string | undefined;
  const returnTo = safeReturn(stateSnap.get("returnTo"));
  const expired = !stateSnap.exists || (stateSnap.get("expiresAt") as Timestamp).toMillis() < Date.now();
  if (!uid || expired || !code || req.query.error) {
    res.redirect(`${app}${returnTo}?calendar=error`);
    return;
  }
  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token || !tokens.id_token) throw new Error("No refresh or id token returned");
    // The Google account that granted access must be the user's own.
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_OAUTH_CLIENT_ID.value() });
    const email = ticket.getPayload()?.email?.toLowerCase();
    const user = await db.collection(C.users).doc(uid).get();
    if (!email || email !== String(user.get("email")).toLowerCase()) {
      await new google.auth.OAuth2().revokeToken(tokens.refresh_token).catch(() => undefined);
      res.redirect(`${app}${returnTo}?calendar=wrong-account`);
      return;
    }
    await db.collection(C.calendarTokens).doc(uid).set({ refreshToken: tokens.refresh_token, connectedAt: Timestamp.now() });
    await db.collection(C.users).doc(uid).update({ calendarConnected: true });
    await auditNow({ uid, channel: "ui" }, { action: "update", entity: "user", entityId: uid, op: "calendar.connect", detail: "Calendar connected" });
    res.redirect(`${app}${returnTo}?calendar=connected`);
  } catch (err) {
    logger.error("Calendar connect failed", { uid, err: String(err) });
    res.redirect(`${app}${returnTo}?calendar=error`);
  }
});

interface SyncState {
  ownerUid: string;
  eventId: string;
  hash: string;
}

interface Desired {
  ownerUid: string;
  hash: string;
  event: {
    summary: string;
    description: string;
    start: { dateTime: string };
    end: { dateTime: string };
    reminders?: { useDefault: boolean; overrides: { method: string; minutes: number }[] };
  };
}

async function clientInitials(clientId: string): Promise<string> {
  const c = await db.collection(C.clients).doc(clientId).get();
  if (!c.exists || c.get("status") === "anonymised") return "Client";
  return initials({ firstName: c.get("firstName") ?? "", lastName: c.get("lastName") ?? "" });
}

async function desiredForSession(snap: DocumentSnapshot): Promise<Desired | null> {
  const d = snap.data();
  if (!d || d.anonymised || d.status !== "scheduled") return null;
  const start = (d.startsAt as Timestamp).toDate();
  const end = new Date(start.getTime() + (d.durationMinutes ?? 60) * 60_000);
  const type = await db.collection(C.sessionTypes).doc(d.typeId).get();
  const who = await clientInitials(d.clientId);
  const event = {
    summary: `${who} · ${type.get("name") ?? "Session"}`,
    description: `${APP_URL.value()}/clients/${d.clientId}?tab=sessions`,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
  return { ownerUid: d.staffUid, event, hash: hashOf([d.staffUid, event]) };
}

async function desiredForCallback(snap: DocumentSnapshot): Promise<Desired | null> {
  const d = snap.data();
  if (!d || d.anonymised || d.status !== "open") return null;
  const org = await getOrgSettings();
  const start = (d.dueAt as Timestamp).toDate();
  const who = await clientInitials(d.clientId);
  const event = {
    summary: `Callback · ${who}`,
    description: `${APP_URL.value()}/clients/${d.clientId}?tab=callbacks`,
    start: { dateTime: start.toISOString() },
    end: { dateTime: new Date(start.getTime() + 15 * 60_000).toISOString() },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: Math.min(org.reminderLeadHours * 60, 40_320) },
        { method: "popup", minutes: 10 },
      ],
    },
  };
  return { ownerUid: d.assigneeUid, event, hash: hashOf([d.assigneeUid, event]) };
}

function hashOf(v: unknown) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
}

/** Brings the calendar event in line with the record. Idempotent. */
async function sync(after: DocumentSnapshot, before: DocumentSnapshot | undefined, desired: Desired | null) {
  const org = await getOrgSettings();
  const current = (after.get("calendarSync") ?? before?.get("calendarSync")) as SyncState | undefined | null;
  if (!org.calendarSyncEnabled && !current) return;
  const want = org.calendarSyncEnabled ? desired : null;

  if (want && current && current.ownerUid === want.ownerUid && current.hash === want.hash) return;

  if (current && (!want || current.ownerUid !== want.ownerUid)) {
    const cal = await calendarFor(current.ownerUid);
    await cal?.events.delete({ calendarId: "primary", eventId: current.eventId }).catch((err) => {
      if ((err as { code?: number }).code !== 410 && (err as { code?: number }).code !== 404) logger.warn("Calendar delete failed", { err: String(err) });
    });
  }

  let next: SyncState | null = null;
  if (want) {
    const cal = await calendarFor(want.ownerUid);
    if (cal) {
      try {
        if (current && current.ownerUid === want.ownerUid) {
          await cal.events.patch({ calendarId: "primary", eventId: current.eventId, requestBody: want.event });
          next = { ownerUid: want.ownerUid, eventId: current.eventId, hash: want.hash };
        } else {
          const created = await cal.events.insert({ calendarId: "primary", requestBody: want.event });
          next = { ownerUid: want.ownerUid, eventId: created.data.id!, hash: want.hash };
        }
      } catch (err) {
        logger.warn("Calendar upsert failed", { owner: want.ownerUid, err: String(err) });
      }
    }
  }

  if (after.exists && JSON.stringify(next) !== JSON.stringify(current ?? null)) {
    await after.ref.update({ calendarSync: next ?? FieldValue.delete() });
  }
}

export const syncSessionToCalendar = onDocumentWritten(
  { document: `${C.sessions}/{id}`, region: REGION, secrets: [GOOGLE_OAUTH_CLIENT_SECRET] },
  async (event) => {
    if (!event.data) return;
    await sync(event.data.after, event.data.before, await desiredForSession(event.data.after));
  },
);

export const syncCallbackToCalendar = onDocumentWritten(
  { document: `${C.callbacks}/{id}`, region: REGION, secrets: [GOOGLE_OAUTH_CLIENT_SECRET] },
  async (event) => {
    if (!event.data) return;
    await sync(event.data.after, event.data.before, await desiredForCallback(event.data.after));
  },
);
