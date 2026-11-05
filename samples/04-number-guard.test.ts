/**
 * EXCERPT: a test file, showing the testing style (Vitest).
 *
 * What it shows: the tests for the number guard in 02-number-guard.ts.
 * The failing figures are the real ones from early test runs (a gain of
 * AED 174,600 where the sum is AED 137,600, "45%" where the rise was
 * 57%), so each fixed bug stays fixed. Pure functions, no mocks.
 *
 * Excerpt from a private codebase, trimmed (the original is 179 lines);
 * trims are marked `// ...`.
 */
import { describe, expect, it } from "vitest";
import { badFigures, buildAllowedSet, extractFigures, repairSentences, type NumberFacts, type RepairLog } from "./number-guard";

const short = (text: string) => extractFigures(text).map((f) => [f.kind, f.value, f.currency, f.period]);

describe("extractFigures", () => {
  it("reads AED, £ and GBP amounts with their period", () => {
    expect(short("AED 31,500 a month, £70,000 a year and GBP 29,500 annually")).toEqual([
      ["money", 31_500, "AED", "month"],
      ["money", 70_000, "GBP", "year"],
      ["money", 29_500, "GBP", "year"],
    ]);
  });

  it("reads both ends of a range, with a hyphen or with 'to'", () => {
    expect(short("one-bed AED 1,200-1,500 a month")).toEqual([
      ["money", 1_200, "AED", "month"],
      ["money", 1_500, "AED", "month"],
    ]);
    expect(short("AED 25,000 to 42,500 monthly")).toEqual([
      ["money", 25_000, "AED", "month"],
      ["money", 42_500, "AED", "month"],
    ]);
  });

  // ...

  it("takes the period from earlier in the clause", () => {
    expect(short("an annual net gain of AED 137,600 (£29,500)")).toEqual([
      ["money", 137_600, "AED", "year"],
      ["money", 29_500, "GBP", "year"],
    ]);
    expect(short("a monthly cost of AED 15,700")).toEqual([["money", 15_700, "AED", "month"]]);
  });

  it("ignores bare numbers, scores and labels", () => {
    expect(extractFigures("Days 1-14: score 78/100, 3 recruiters, paid in 1 to 4 cheques")).toEqual([]);
  });
});

const FACTS: NumberFacts = {
  money: [
    { value: 31_500, currency: "AED", period: "month" },
    { value: 15_700, currency: "AED", period: "month" },
    { value: 378_000, currency: "AED", period: "year" },
    { value: 240_400, currency: "AED", period: "year" },
    { value: 70_000, currency: "GBP", period: "year" },
    { value: 51_157, currency: "GBP", period: "year" },
    { value: 53_000, currency: "AED", period: "once" },
  ],
  percents: [57.5],
  months: [7.9],
  weeks: [4, 6],
};
const ALLOWED = buildAllowedSet(FACTS);
const ok = (text: string) => badFigures(text, ALLOWED).length === 0;

describe("allowed set", () => {
  it("accepts reference figures, their roundings, sums and differences", () => {
    expect(ok("AED 31,500 a month")).toBe(true);
    expect(ok("£51,157 a year")).toBe(true);
    expect(ok("£51,000 a year")).toBe(true); // rounded to 500
    expect(ok("£51,200 a year")).toBe(true); // rounded to 100
    expect(ok("AED 15,800 a month")).toBe(true); // 31,500 minus 15,700
    expect(ok("AED 137,600 a year")).toBe(true); // 378,000 minus 240,400
    expect(ok("AED 47,200 a month")).toBe(true); // 31,500 plus 15,700
    expect(ok("£18,843 a year")).toBe(true); // UK tax: 70,000 minus 51,157
    expect(ok("£51k")).toBe(true);
    expect(ok("AED 53,000 upfront")).toBe(true);
  });

  it("rejects figures the code never supplied", () => {
    expect(ok("AED 174,600 a year")).toBe(false);
    expect(ok("AED 1,200 a month")).toBe(false);
    expect(ok("AED 33,000 a month")).toBe(false);
  });

  it("allows percentages to the nearest whole number only", () => {
    expect(ok("a 57% rise")).toBe(true);
    expect(ok("a 58% rise")).toBe(true);
    expect(ok("a 45% rise")).toBe(false);
    expect(ok("0% income tax")).toBe(true);
  });

  // ...
});

describe("repairSentences", () => {
  it("removes only the sentence with the bad figure", () => {
    const log: RepairLog = [];
    const out = repairSentences(
      "You would earn AED 31,500 a month. That is an annual gain of AED 174,600. Rent is paid upfront.",
      ALLOWED,
      "Fallback.",
      "verdict.summary",
      log
    );
    expect(out).toBe("You would earn AED 31,500 a month. Rent is paid upfront.");
    expect(log).toEqual([{ field: "verdict.summary", figures: 1 }]);
  });

  it("returns clean text unchanged and logs nothing", () => {
    const log: RepairLog = [];
    const text = "You would earn AED 31,500 a month, a 57% rise.";
    expect(repairSentences(text, ALLOWED, "Fallback.", "f", log)).toBe(text);
    expect(log).toEqual([]);
  });

  // ...
});
