import type { Question } from "@ccm/shared";
import { describe, expect, it } from "vitest";
import { cleanAnswers, formatAnswer, validateAnswer, validateAnswers } from "./answers";

const q = (over: Partial<Question>): Question => ({ id: "q", text: "Q", type: "text", archived: false, ...over });

describe("validateAnswer", () => {
  it("allows blanks", () => {
    expect(validateAnswer(q({ type: "number" }), undefined)).toBeNull();
    expect(validateAnswer(q({ type: "number" }), "")).toBeNull();
  });
  it("checks scale bounds", () => {
    const s = q({ type: "scale", scale: { min: 1, max: 5 } });
    expect(validateAnswer(s, 3)).toBeNull();
    expect(validateAnswer(s, 6)).toBe("Choose a value from 1 to 5");
  });
  it("checks choices against options", () => {
    const c = q({ type: "single_choice", options: ["A", "B"] });
    expect(validateAnswer(c, "A")).toBeNull();
    expect(validateAnswer(c, "C")).not.toBeNull();
    const m = q({ type: "multiple_choice", options: ["A", "B"] });
    expect(validateAnswer(m, ["A", "B"])).toBeNull();
    expect(validateAnswer(m, ["A", "Z"])).not.toBeNull();
  });
  it("checks dates and yes/no", () => {
    expect(validateAnswer(q({ type: "date" }), "2026-01-31")).toBeNull();
    expect(validateAnswer(q({ type: "date" }), "31/01/2026")).not.toBeNull();
    expect(validateAnswer(q({ type: "yes_no" }), true)).toBeNull();
    expect(validateAnswer(q({ type: "yes_no" }), "yes")).not.toBeNull();
  });
  it("collects errors by question", () => {
    const qs = [q({ id: "a", type: "number" }), q({ id: "b", type: "text" })];
    expect(validateAnswers(qs, { a: "x", b: "ok" })).toEqual({ a: "Enter a number" });
  });
});

describe("cleanAnswers", () => {
  it("drops blank values", () => {
    expect(cleanAnswers({ a: "", b: null, c: [], d: false, e: 0, f: "x" })).toEqual({ d: false, e: 0, f: "x" });
  });
});

describe("formatAnswer", () => {
  it("formats by type", () => {
    expect(formatAnswer(undefined, true)).toBe("Yes");
    expect(formatAnswer(undefined, null)).toBe("Not answered");
    expect(formatAnswer(undefined, ["A", "B"])).toBe("A, B");
    expect(formatAnswer(q({ type: "scale", scale: { min: 1, max: 10 } }), 7)).toBe("7 of 10");
    expect(formatAnswer(q({ type: "date" }), "2026-03-04")).toBe("04/03/2026");
  });
});
