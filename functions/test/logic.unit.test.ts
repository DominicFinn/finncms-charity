import { DEFAULT_ORG_SETTINGS } from "@ccm/shared";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { restrictionsFrom } from "../src/handlers/consent.js";
import { searchTokens } from "../src/handlers/clients.js";
import { anonymiseAfter, retentionCutoff } from "../src/jobs/retention.js";
import { monthStart } from "../src/jobs/anonymise.js";

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

describe("consent restrictions", () => {
  it("follow the latest record per purpose", () => {
    expect(
      restrictionsFrom([
        { purpose: "data_processing", givenAt: ts("2026-01-01"), withdrawnAt: ts("2026-02-01") },
        { purpose: "data_processing", givenAt: ts("2026-03-01") },
        { purpose: "contact", givenAt: ts("2026-01-01"), withdrawnAt: ts("2026-01-05") },
      ]),
    ).toEqual(["no_contact"]);
  });
  it("are empty with no records", () => {
    expect(restrictionsFrom([])).toEqual([]);
  });
});

describe("retention dates", () => {
  const org = { ...DEFAULT_ORG_SETTINGS, retentionMonths: 36 };
  it("cut off three years back", () => {
    expect(retentionCutoff(org, 0, new Date("2026-11-05T00:00:00Z")).toDate().toISOString()).toBe("2023-11-05T00:00:00.000Z");
    expect(retentionCutoff(org, 60, new Date("2026-11-05T00:00:00Z")).toDate().toISOString()).toBe("2024-01-04T00:00:00.000Z");
  });
  it("anonymise three years after last activity", () => {
    expect(anonymiseAfter(org, new Date("2025-06-15T09:00:00Z")).toISOString()).toBe("2028-06-15T09:00:00.000Z");
  });
});

describe("helpers", () => {
  it("truncate to the month", () => {
    expect(monthStart(ts("2026-02-17T15:30:00Z"))?.toDate().toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(monthStart(undefined)).toBeNull();
  });
  it("build search prefixes from names and postcode", () => {
    const tokens = searchTokens({ firstName: "Mary", lastName: "O'Brien-Kelly", postcode: "NG7 2RD" });
    expect(tokens).toEqual(expect.arrayContaining(["ma", "mary", "o'", "o'brien", "ke", "kelly", "ng", "ng7", "ng72rd"]));
  });
});
