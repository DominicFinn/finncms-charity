import type { MeetingAttendance, OrgSettings, Quorum, Trustee } from "./domain.js";

/** YYYY-MM-DD for an ISO date time, in London time. */
export function londonDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

/** Whether a trustee was serving on a given day (YYYY-MM-DD). */
export function servingOn(trustee: Pick<Trustee, "active" | "startDate" | "endDate">, day: string): boolean {
  if (trustee.startDate && trustee.startDate > day) return false;
  if (trustee.endDate) return trustee.endDate >= day;
  // Marked inactive with no end date: treat as no longer serving.
  return trustee.active;
}

/**
 * Whether a meeting is quorate. The quorum is the larger of the minimum
 * number of trustees and the given share of those serving, rounded up, and
 * never less than one. Only trustees serving on the day count.
 */
export function quorumFor(
  trustees: Pick<Trustee, "id" | "active" | "startDate" | "endDate">[],
  attendance: MeetingAttendance[],
  meetingDay: string,
  settings: Pick<OrgSettings, "quorumMinimum" | "quorumFraction">,
): Quorum {
  const serving = new Set(trustees.filter((t) => servingOn(t, meetingDay)).map((t) => t.id));
  const present = new Set(attendance.filter((a) => a.status === "present" && serving.has(a.trusteeId)).map((a) => a.trusteeId)).size;
  const fraction = Math.min(Math.max(settings.quorumFraction || 0, 0), 1);
  // Small tolerance so 0.5 of 6 is 3, not 4 from floating point error.
  const byShare = Math.ceil(serving.size * fraction - 1e-9);
  const required = Math.max(settings.quorumMinimum || 0, byShare, 1);
  return { eligible: serving.size, present, required, quorate: present >= required };
}
