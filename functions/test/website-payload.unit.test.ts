import { referralSubmissionSchema } from "@ccm/shared";
import { describe, expect, it } from "vitest";

// The exact shape the NDIE website's /api/referral route forwards, with the
// empty strings a browser sends for fields left blank.
const FROM_WEBSITE = {
  referrerType: "self",
  firstName: "Bridget",
  lastName: "Murphy",
  addressLine: "",
  town: "Derby",
  postcode: "",
  phone: "01332 000000",
  email: "",
  helpNeeded: "Help with a benefits form.",
  helpCategoryHints: ["Help finding the right service"],
  personAware: true,
  consentToContact: true,
  heardAbout: "",
  sourceUrl: "https://finnlytics-charity.web.app/website/refer",
  submissionId: "0b6f8e1c-3a4d-4e5f-9a7b-2c1d0e9f8a7b",
};

describe("payload from the website", () => {
  it("is accepted, with blanks treated as not given", () => {
    const r = referralSubmissionSchema.parse(FROM_WEBSITE);
    expect(r.postcode).toBeUndefined();
    expect(r.email).toBeUndefined();
    expect(r.heardAbout).toBeUndefined();
  });
});
