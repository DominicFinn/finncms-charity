/**
 * UK postcode district: the outward code, e.g. "NG7" from "NG7 2RD".
 * Returns undefined when the input doesn't look like a postcode.
 */
export function postcodeDistrict(postcode: string | undefined | null): string | undefined {
  if (!postcode) return undefined;
  const clean = postcode.toUpperCase().replace(/\s+/g, "");
  const match = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})?$/.exec(clean);
  return match ? match[1] : undefined;
}

export function normalisePostcode(postcode: string | undefined | null): string | undefined {
  if (!postcode) return undefined;
  const clean = postcode.toUpperCase().replace(/\s+/g, "");
  if (clean.length < 5) return clean;
  return `${clean.slice(0, -3)} ${clean.slice(-3)}`;
}

export function clientDisplayName(c: { firstName: string; lastName: string; preferredName?: string }): string {
  const first = c.preferredName?.trim() || c.firstName;
  return `${first} ${c.lastName}`.trim();
}

export function initials(c: { firstName: string; lastName: string }): string {
  return `${c.firstName.charAt(0)}${c.lastName.charAt(0)}`.toUpperCase();
}

/** RFC 4180 CSV with formula injection protection for spreadsheet apps. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return "";
          let s = String(cell);
          if (typeof cell === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}
