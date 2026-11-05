/**
 * Callback reminders. Runs every 15 minutes and creates an in-app
 * notification for the assignee when a callback is coming up, and again when
 * it becomes overdue. Calendar sync (when connected) adds a calendar reminder
 * as well, so staff are also told on their phone.
 */
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { getOrgSettings } from "../core/context.js";
import { C, db } from "../core/firebase.js";

function when(ts: Timestamp): string {
  return ts.toDate().toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" });
}

export async function runReminders(now = Timestamp.now()): Promise<{ due: number; overdue: number }> {
  const org = await getOrgSettings();
  const horizon = Timestamp.fromMillis(now.toMillis() + org.reminderLeadHours * 3_600_000);
  const open = await db.collection(C.callbacks).where("status", "==", "open").where("dueAt", "<", horizon).get();

  let due = 0;
  let overdue = 0;
  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending) await batch.commit();
    batch = db.batch();
    pending = 0;
  };

  for (const doc of open.docs) {
    const d = doc.data();
    if (d.anonymised) continue;
    const dueAt = d.dueAt as Timestamp;
    const isOverdue = dueAt.toMillis() < now.toMillis();
    // No client names in notifications: they're short and may show on a lock screen.
    if (isOverdue && !d.overdueNotifiedAt) {
      batch.create(db.collection(C.notifications).doc(), {
        userUid: d.assigneeUid,
        kind: "callback_overdue",
        message: `A callback due ${when(dueAt)} is overdue.`,
        link: `/clients/${d.clientId}?tab=callbacks`,
        createdAt: now,
      });
      batch.update(doc.ref, { overdueNotifiedAt: now, reminderSentAt: d.reminderSentAt ?? now });
      overdue += 1;
      pending += 2;
    } else if (!isOverdue && !d.reminderSentAt) {
      batch.create(db.collection(C.notifications).doc(), {
        userUid: d.assigneeUid,
        kind: "callback_due",
        message: `You have a callback due ${when(dueAt)}.`,
        link: `/clients/${d.clientId}?tab=callbacks`,
        createdAt: now,
      });
      batch.update(doc.ref, { reminderSentAt: now });
      due += 1;
      pending += 2;
    }
    if (pending >= 400) await flush();
  }
  await flush();
  if (due || overdue) logger.info("Reminders sent", { due, overdue });
  return { due, overdue };
}
