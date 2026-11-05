/**
 * Daily retention job. Finds clients whose last activity is older than the
 * organisation's retention period and anonymises them, except where an open
 * safeguarding concern holds them. Managers are told ahead of time.
 */
import { clientDisplayName, type OrgSettings, type Permission, type RetentionCandidate } from "@ccm/shared";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { SYSTEM_ACTOR } from "../core/audit.js";
import { getOrgSettings, permissionsFor } from "../core/context.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { bucket, C, db, toIso } from "../core/firebase.js";
import { anonymiseClient } from "./anonymise.js";

/** Clients with last activity before this are due. `aheadDays` looks into the future. */
export function retentionCutoff(org: OrgSettings, aheadDays = 0, now = new Date()): Timestamp {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - org.retentionMonths);
  d.setUTCDate(d.getUTCDate() + aheadDays);
  return Timestamp.fromDate(d);
}

export function anonymiseAfter(org: OrgSettings, lastActivity: Date): Date {
  const d = new Date(lastActivity);
  d.setUTCMonth(d.getUTCMonth() + org.retentionMonths);
  return d;
}

async function candidates(org: OrgSettings, aheadDays: number) {
  return db
    .collection(C.clients)
    .where("status", "in", ["active", "restricted"])
    .where("lastActivityAt", "<", retentionCutoff(org, aheadDays))
    .orderBy("lastActivityAt")
    .limit(500)
    .get();
}

async function usersWith(permission: Permission): Promise<string[]> {
  const users = await db.collection(C.users).where("active", "==", true).get();
  const out: string[] = [];
  for (const u of users.docs) {
    if (u.get("invited")) continue;
    if ((await permissionsFor(u.get("roleIds") ?? [])).has(permission)) out.push(u.id);
  }
  return out;
}

/** Most clients one run will anonymise, so a mistaken setting can't empty the system overnight. */
const MAX_PER_RUN = 100;

export async function runRetention(now = new Date()): Promise<{ anonymised: number; held: number; warned: number }> {
  const org = await getOrgSettings();
  let anonymised = 0;
  let held = 0;

  // A client is only anonymised once managers have been warned about it and
  // the full warning period has passed since, even if the retention period
  // was shortened in the meantime.
  const warnedBefore = now.getTime() - org.retentionWarningDays * 86_400_000;
  const due = await candidates(org, 0);
  for (const doc of due.docs) {
    if (anonymised >= MAX_PER_RUN) break;
    const warnedAt = (doc.get("retentionWarnedAt") as Timestamp | undefined)?.toMillis();
    if (!warnedAt || warnedAt > warnedBefore) continue;
    if ((doc.get("openSafeguardingConcerns") ?? 0) > 0) {
      held += 1;
      continue;
    }
    try {
      await anonymiseClient(doc.id, SYSTEM_ACTOR, "retention_period");
      anonymised += 1;
    } catch (err) {
      held += 1;
      logger.warn("Retention: client not anonymised", { clientId: doc.id, err: String(err) });
    }
  }

  // Warn managers once per client as it enters the warning window.
  const upcoming = await candidates(org, org.retentionWarningDays);
  const fresh = upcoming.docs.filter((d) => !d.get("retentionWarnedAt"));
  if (fresh.length) {
    const managers = await usersWith("retention.manage");
    const batch = db.batch();
    for (const uid of managers) {
      batch.create(db.collection(C.notifications).doc(), {
        userUid: uid,
        kind: "retention_upcoming",
        message: `${fresh.length} client record${fresh.length === 1 ? "" : "s"} will be anonymised within ${org.retentionWarningDays} days.`,
        link: "/admin/retention",
        createdAt: Timestamp.now(),
      });
    }
    for (const d of fresh) batch.update(d.ref, { retentionWarnedAt: Timestamp.now() });
    await batch.commit();
  }

  // Remove uploads that were started but never finished.
  const stale = await db
    .collection(C.files)
    .where("status", "==", "pending")
    .where("createdAt", "<", Timestamp.fromMillis(Date.now() - 86_400_000))
    .get();
  for (const f of stale.docs) {
    await bucket().file(f.get("storagePath")).delete({ ignoreNotFound: true }).catch(() => undefined);
    await f.ref.delete();
  }

  if (anonymised >= MAX_PER_RUN) logger.warn(`Retention: stopped at ${MAX_PER_RUN} clients; the rest will follow tomorrow`);
  logger.info("Retention run complete", { anonymised, held, warned: fresh.length });
  return { anonymised, held, warned: fresh.length };
}

export const retentionHandlers: HandlerGroup = {
  async "retention.upcoming"(_input, ctx) {
    const snap = await candidates(ctx.org, ctx.org.retentionWarningDays);
    return snap.docs.map((d): RetentionCandidate => {
      ctx.touched.add(d.id);
      const last = (d.get("lastActivityAt") as Timestamp).toDate();
      return {
        clientId: d.id,
        displayName: clientDisplayName(d.data() as { firstName: string; lastName: string }),
        lastActivityAt: toIso(d.get("lastActivityAt"))!,
        anonymiseAfter: anonymiseAfter(ctx.org, last).toISOString(),
        heldBySafeguarding: ctx.can("safeguarding.view") && (d.get("openSafeguardingConcerns") ?? 0) > 0,
      };
    });
  },
};
