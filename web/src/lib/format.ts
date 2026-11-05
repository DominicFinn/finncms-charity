const TZ = "Europe/London";

const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });

export function formatDate(iso?: string | null): string {
  if (!iso) return "";
  // Plain YYYY-MM-DD dates have no time zone; show them as written.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return dateFmt.format(new Date(Date.UTC(y, m - 1, d, 12)));
  }
  return dateFmt.format(new Date(iso));
}

export function formatDateTime(iso?: string | null): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : "";
}

export function formatTime(iso?: string | null): string {
  return iso ? timeFmt.format(new Date(iso)) : "";
}

export function formatDay(iso: string): string {
  return dayFmt.format(new Date(iso));
}

/** Calendar day key in London time, for grouping. */
export function dayKey(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
  return parts;
}

/** Value for <input type="datetime-local"> from an ISO string, in the browser's zone. */
export function toLocalInput(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO string with offset from a datetime-local value. */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function humanise(value: string): string {
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function isOverdue(iso: string, now = Date.now()): boolean {
  return new Date(iso).getTime() < now;
}
