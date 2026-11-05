/**
 * EXCERPT: the number guard on generated reports.
 *
 * What it shows: the model writes the report's sentences, the code owns
 * the numbers. Every money, percentage and duration figure in the prose is
 * checked against the figures the code gave the model. A sentence that
 * quotes any other figure is removed (or the field is replaced by a code
 * template) before the reader sees it, and the repair is logged.
 *
 * Why it exists: test runs with sample households found prose that
 * disagreed with the code, for example a net gain of "AED 174,600" where
 * the sum is AED 137,600, and "45%" where the rise was 57%.
 *
 * Pure functions only: no I/O, so the same guard runs on streamed
 * sections, the saved report and the tests. Excerpt from a private
 * codebase, trimmed; trims are marked `// ...`.
 */

export type Currency = "AED" | "GBP";
export type Period = "month" | "year" | "once";

export type MoneyFact = {
  value: number;
  currency: Currency;
  period: Period;
  /** False for small cost lines: their pairwise sums would let almost any wrong figure pass. */
  pairable?: boolean;
};

/** Everything a report's prose may quote. */
export type NumberFacts = { money: MoneyFact[]; percents: number[]; months: number[]; weeks: number[] };

export type Figure = {
  kind: "money" | "percent" | "months" | "weeks";
  value: number;
  currency: Currency | null; // null when the text names no currency ("30k")
  period: Exclude<Period, "once"> | null;
  suffix: "k" | "m" | null;
  // ... raw text and position
};

// ... extractFigures(text): regular expressions that read "AED 31,500",
// "£1,200-£1,500", "1,500 AED", "30k", "45%", "4 to 6 weeks", and take
// the period from the words around each figure ("a month", "annual").

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/** Money keyed by `${currency}:${period}`; "once" figures sit in both periods. */
export type AllowedSet = {
  money: Map<string, { base: number[]; derived: number[] }>;
  percents: number[]; months: number[]; weeks: number[];
};

export function buildAllowedSet(facts: NumberFacts): AllowedSet {
  const money = new Map<string, { base: number[]; derived: number[] }>();
  for (const currency of ["AED", "GBP"] as const) {
    for (const period of ["month", "year"] as const) {
      const own = facts.money.filter((f) => f.currency === currency && f.period === period);
      const once = facts.money.filter((f) => f.currency === currency && f.period === "once");
      const base = new Set([...own, ...once].map((f) => f.value));
      const derived = new Set<number>();
      // Simple sums and differences of two figures of the same period.
      const pairs = (list: MoneyFact[]) => list.filter((f) => f.pairable !== false).map((f) => f.value);
      for (const group of [pairs(own), pairs(once)]) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            derived.add(group[i]! + group[j]!);
            derived.add(Math.abs(group[i]! - group[j]!));
          }
        }
      }
      money.set(`${currency}:${period}`, {
        base: [...base].filter((v) => v > 0),
        derived: [...derived].filter((v) => v > 0 && !base.has(v)),
      });
    }
  }
  return { money, percents: [...new Set([0, ...facts.percents])], months: [...new Set(facts.months)], weeks: [...new Set(facts.weeks)] };
}

function moneyMatches(claimed: number, allowed: number, suffix: Figure["suffix"]): boolean {
  if (Math.abs(claimed - allowed) < 0.005) return true;
  if (allowed >= 1_000 && claimed === roundTo(allowed, 100)) return true;
  if (allowed >= 5_000 && claimed === roundTo(allowed, 500)) return true;
  if (suffix === "k" && allowed >= 10_000 && claimed === roundTo(allowed, 1_000)) return true;
  // ... further "k" and "m" roundings
  return false;
}

/** True when a figure is one the code supplied (or a plain rounding of one). */
export function isFigureAllowed(fig: Figure, allowed: AllowedSet): boolean {
  if (fig.kind === "percent") return allowed.percents.some((p) => Math.abs(fig.value - p) <= 0.5 + 1e-9);
  if (fig.kind === "months") return allowed.months.some((m) => Math.abs(fig.value - m) <= 0.5 + 1e-9);
  if (fig.kind === "weeks") return allowed.weeks.some((w) => Math.abs(fig.value - w) <= 0.5 + 1e-9);
  const currencies: Currency[] = fig.currency ? [fig.currency] : ["AED", "GBP"];
  const periods = fig.period ? [fig.period] : (["month", "year"] as const);
  for (const c of currencies) {
    for (const p of periods) {
      const set = allowed.money.get(`${c}:${p}`);
      if (!set) continue;
      if (set.base.some((v) => moneyMatches(fig.value, v, fig.suffix))) return true;
      // A sum or difference must be quoted exactly or to the nearest 100.
      if (set.derived.some((v) => fig.value === v || fig.value === roundTo(v, 100))) return true;
    }
  }
  return false;
}

export type RepairLog = { field: string; figures: number }[];

/**
 * Remove each sentence that carries a figure the code did not supply.
 * Falls back to `fallback` when nothing is left, and records the repair.
 * ... (the original also takes an option for fields that may quote no
 * money at all, and a sibling that swaps in a whole code template)
 */
export function repairSentences(text: string, allowed: AllowedSet, fallback: string, field: string, log: RepairLog): string {
  const sentences = splitSentences(text);
  let removed = 0;
  const kept = sentences.filter((s) => {
    const bad = badFigures(s, allowed).length;
    removed += bad;
    return bad === 0;
  });
  if (removed === 0) return text;
  log.push({ field, figures: removed });
  if (kept.length === 0) return fallback;
  const joined = kept.join(" ");
  return /[.!?]$/.test(joined) ? joined : `${joined}.`;
}
