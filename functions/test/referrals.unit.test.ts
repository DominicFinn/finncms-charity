import { referralSubmissionSchema } from "@ccm/shared";
import { describe, expect, it } from "vitest";
import { hourBucket, newReference } from "../src/intake.js";

const SELF = {
  referrerType: "self",
  firstName: "Bridget",
  lastName: "Murphy",
  phone: "01332 000000",
  helpNeeded: "Help with a benefits form.",
  consentToContact: true,
};

describe("referral submission schema", () => {
  it("accepts a minimal self referral and fills defaults", () => {
    const r = referralSubmissionSchema.parse(SELF);
    expect(r.helpCategoryHints).toEqual([]);
    expect(r.personAware).toBe(false);
  });

  it("treats blank optional text as not given", () => {
    const r = referralSubmissionSchema.parse({ ...SELF, town: "  ", email: "", referrerName: "" });
    expect(r.town).toBeUndefined();
    expect(r.email).toBeUndefined();
    expect(r.referrerName).toBeUndefined();
  });

  it("rejects unknown fields", () => {
    const res = referralSubmissionSchema.safeParse({ ...SELF, role: "admin" });
    expect(res.success).toBe(false);
  });

  it("needs consent, a way to make contact and, for others, who is referring", () => {
    expect(referralSubmissionSchema.safeParse({ ...SELF, consentToContact: false }).success).toBe(false);
    expect(referralSubmissionSchema.safeParse({ ...SELF, phone: undefined }).success).toBe(false);
    expect(referralSubmissionSchema.safeParse({ ...SELF, phone: undefined, email: "b@example.org" }).success).toBe(true);
    const other = { ...SELF, referrerType: "professional", referrerName: "Dr Patel", referrerOrganisation: "Surgery" };
    expect(referralSubmissionSchema.safeParse(other).success).toBe(false);
    expect(referralSubmissionSchema.safeParse({ ...other, referrerEmail: "gp@example.nhs.uk" }).success).toBe(true);
  });

  it("caps lengths", () => {
    expect(referralSubmissionSchema.safeParse({ ...SELF, helpNeeded: "x".repeat(3001) }).success).toBe(false);
    expect(referralSubmissionSchema.safeParse({ ...SELF, helpCategoryHints: Array(11).fill("a") }).success).toBe(false);
    expect(referralSubmissionSchema.safeParse({ ...SELF, submissionId: "bad id with spaces" }).success).toBe(false);
  });
});

describe("intake helpers", () => {
  it("makes short unambiguous references", () => {
    for (let i = 0; i < 50; i++) expect(newReference()).toMatch(/^R-[2-9A-HJKMNP-TV-Z]{6}$/);
  });

  it("buckets requests by UTC clock hour", () => {
    expect(hourBucket(new Date("2026-11-05T10:59:59Z"))).toBe("2026110510");
    expect(hourBucket(new Date("2026-11-05T11:00:00Z"))).toBe("2026110511");
  });
});
