import { describe, expect, it } from "vitest";
import { normalisePostcode, postcodeDistrict, toCsv } from "./util.js";

describe("postcodeDistrict", () => {
  it.each([
    ["NG7 2RD", "NG7"],
    ["ng72rd", "NG7"],
    ["DE1 1AA", "DE1"],
    ["W1A 0AX", "W1A"],
    ["EC1A 1BB", "EC1A"],
    ["NG7", "NG7"],
    ["not a postcode", undefined],
    ["", undefined],
  ])("%s -> %s", (input, expected) => {
    expect(postcodeDistrict(input)).toBe(expected);
  });
});

describe("normalisePostcode", () => {
  it("formats with a single space", () => {
    expect(normalisePostcode(" ng7  2rd ")).toBe("NG7 2RD");
  });
});

describe("toCsv", () => {
  it("quotes and escapes", () => {
    expect(toCsv([["a", 'b"c', "d,e"], [1, null, "x\ny"]])).toBe('a,"b""c","d,e"\r\n1,,"x\ny"');
  });
  it("neutralises spreadsheet formulas", () => {
    expect(toCsv([["=SUM(A1)", "-1"]])).toBe("'=SUM(A1),'-1");
    expect(toCsv([[-1]])).toBe("-1");
  });
});
