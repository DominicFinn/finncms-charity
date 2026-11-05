import { describe, expect, it } from "vitest";
import { londonDate, quorumFor, servingOn } from "./meetings.js";

const t = (id: string, extra: { active?: boolean; startDate?: string; endDate?: string } = {}) => ({ id, active: true, ...extra });
const present = (...ids: string[]) => ids.map((trusteeId) => ({ trusteeId, status: "present" as const }));

describe("servingOn", () => {
  it("respects start and end dates", () => {
    expect(servingOn(t("a", { startDate: "2026-02-01" }), "2026-01-31")).toBe(false);
    expect(servingOn(t("a", { startDate: "2026-02-01" }), "2026-02-01")).toBe(true);
    expect(servingOn(t("a", { endDate: "2026-02-01", active: false }), "2026-02-01")).toBe(true);
    expect(servingOn(t("a", { endDate: "2026-02-01", active: false }), "2026-02-02")).toBe(false);
  });

  it("treats an inactive trustee with no end date as not serving", () => {
    expect(servingOn(t("a", { active: false }), "2026-01-01")).toBe(false);
  });
});

describe("quorumFor", () => {
  const board = [t("a"), t("b"), t("c"), t("d"), t("e"), t("f")];

  it("uses the minimum when no share is set", () => {
    expect(quorumFor(board, present("a", "b"), "2026-05-01", { quorumMinimum: 3, quorumFraction: 0 })).toEqual({
      eligible: 6,
      present: 2,
      required: 3,
      quorate: false,
    });
    expect(quorumFor(board, present("a", "b", "c"), "2026-05-01", { quorumMinimum: 3, quorumFraction: 0 }).quorate).toBe(true);
  });

  it("uses the share of serving trustees when that is larger, rounding up", () => {
    expect(quorumFor(board, present("a", "b", "c"), "2026-05-01", { quorumMinimum: 2, quorumFraction: 0.5 }).required).toBe(3);
    expect(quorumFor(board, present("a", "b", "c"), "2026-05-01", { quorumMinimum: 2, quorumFraction: 0.6 }).required).toBe(4);
  });

  it("only counts trustees serving on the day", () => {
    const people = [t("a"), t("b"), t("c", { endDate: "2026-01-01", active: false }), t("d", { startDate: "2027-01-01" })];
    const q = quorumFor(people, present("a", "b", "c", "d"), "2026-05-01", { quorumMinimum: 3, quorumFraction: 0 });
    expect(q).toMatchObject({ eligible: 2, present: 2, quorate: false });
  });

  it("ignores apologies, absences and duplicates", () => {
    const att = [...present("a", "a"), { trusteeId: "b", status: "apologies" as const }, { trusteeId: "c", status: "absent" as const }];
    expect(quorumFor(board, att, "2026-05-01", { quorumMinimum: 1, quorumFraction: 0 }).present).toBe(1);
  });

  it("never needs fewer than one trustee", () => {
    expect(quorumFor([], [], "2026-05-01", { quorumMinimum: 0, quorumFraction: 0 }).required).toBe(1);
  });
});

describe("londonDate", () => {
  it("uses London time, not UTC", () => {
    expect(londonDate("2026-06-30T23:30:00Z")).toBe("2026-07-01");
    expect(londonDate("2026-12-31T23:30:00Z")).toBe("2026-12-31");
  });
});
