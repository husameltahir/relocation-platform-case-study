/**
 * EXCERPT: the salary comparison maths.
 *
 * What it shows: UK take-home after income tax and National Insurance
 * (2026/27 bands, with the personal allowance taper), then a side-by-side
 * of what a household has left each month in the UK and in the UAE once
 * the sourced costs (rent, school fees, the UAE housing fee, UK council
 * tax) and the person's own figures are paid. One pure function serves
 * the comparator page, its server-rendered worked example and the share
 * image, so a shared link always reproduces the same figures.
 *
 * Two files from a private codebase, trimmed; trims are marked `// ...`.
 */

// ---- From the tax and cost-of-living module ----
//
// England, Wales and Northern Ireland only. Scottish rates, student
// loans and pension contributions are not modelled.
// Sources, checked 2026-10-20 and again 2026-11-03:
// - https://www.gov.uk/income-tax-rates : personal allowance £12,570,
//   reduced by £1 for every £2 of adjusted net income above £100,000;
//   basic rate 20%, higher 40%, additional 45% over £125,140.
// - https://www.gov.uk/national-insurance-rates-letters : employee
//   Class 1 (category A) 8% between £12,570 and £50,270 a year, 2% above.

export const UK_PERSONAL_ALLOWANCE = 12_570;
const UK_PA_TAPER_START = 100_000; // PA reduced by £1 for every £2 over
const UK_BASIC_BAND = 37_700; // taxable income taxed at 20%
const UK_ADDITIONAL_THRESHOLD = 125_140; // taxable income above this at 45%
const UK_NI_PT = 12_570; // primary threshold
const UK_NI_UEL = 50_270; // upper earnings limit
const UK_NI_RATE_MAIN = 0.08;
const UK_NI_RATE_UPPER = 0.02;

export function calculateUKTax(grossGBP: number): { tax: number; ni: number; net: number; personalAllowance: number } {
  if (grossGBP < 0) grossGBP = 0;

  // Personal allowance taper: £1 lost for every £2 over £100k.
  let personalAllowance = UK_PERSONAL_ALLOWANCE;
  if (grossGBP > UK_PA_TAPER_START) {
    const reduction = Math.min(UK_PERSONAL_ALLOWANCE, (grossGBP - UK_PA_TAPER_START) / 2);
    personalAllowance = Math.max(0, UK_PERSONAL_ALLOWANCE - reduction);
  }
  const taxable = Math.max(0, grossGBP - personalAllowance);

  // Fixed bands of taxable income. They do not move when the allowance tapers.
  const basicHit = Math.min(taxable, UK_BASIC_BAND);
  const higherHit = Math.max(0, Math.min(taxable, UK_ADDITIONAL_THRESHOLD) - UK_BASIC_BAND);
  const additionalHit = Math.max(0, taxable - UK_ADDITIONAL_THRESHOLD);
  const tax = basicHit * 0.2 + higherHit * 0.4 + additionalHit * 0.45;

  let ni = 0;
  if (grossGBP > UK_NI_PT) {
    ni += (Math.min(grossGBP, UK_NI_UEL) - UK_NI_PT) * UK_NI_RATE_MAIN;
    if (grossGBP > UK_NI_UEL) ni += (grossGBP - UK_NI_UEL) * UK_NI_RATE_UPPER;
  }

  const net = grossGBP - tax - ni;
  return { tax: Math.round(tax), ni: Math.round(ni), net: Math.round(net), personalAllowance: Math.round(personalAllowance) };
}

/** What UAE gross (AED) matches the current UK net? No UAE income tax is charged on salary. */
export function breakEvenUaeAED(ukGrossGBP: number): number {
  return gbpToAed(calculateUKTax(ukGrossGBP).net);
}

// ... uaeMonthlyCostsAED and ukMonthlyCostsGBP: rent, school fees, housing
// fee and council tax, each read from a table whose rows carry a source
// name, link and checked date.

// ---- From the comparator module ----

export type ComparatorInputs = {
  ukGross: number;
  /** Annual AED. Null means use the salary engine's planning figure. */
  uaeGross: number | null;
  role: string | null;
  ukCity: UkCostCity;
  uaeCity: UaeCity;
  adults: number;
  kids: number;
  /** Annual AED on top of base salary. */
  housingAllowance: number;
  educationAllowance: number;
  schoolTier: SchoolTier;
  /** The person's own other monthly costs; 0 = not counted. */
  ukOtherMonthly: number;
  uaeOtherMonthly: number;
};

/**
 * Everything the comparator shows, from its inputs. `suggestedUaeGross`
 * is the benchmark median a year, used when `uaeGross` is null. With
 * neither (no benchmark for the role and no figure typed),
 * `uaeSalaryKnown` is false and the UAE side must not be shown.
 */
export function computeComparison(inputs: ComparatorInputs, suggestedUaeGross: number | null = suggestedUaeGrossFor(inputs)) {
  const uk = calculateUKTax(inputs.ukGross);
  const uaeSalaryKnown = inputs.uaeGross !== null || suggestedUaeGross !== null;
  const effectiveUaeGross = inputs.uaeGross ?? suggestedUaeGross ?? 0;
  // Total package = base + allowances.
  const totalPackageAED = effectiveUaeGross + inputs.housingAllowance + inputs.educationAllowance;
  const uaeCostsMo = uaeMonthlyCostsAED(
    inputs.uaeCity,
    inputs.adults,
    inputs.kids,
    schoolsMonthlyAED(inputs.uaeCity, inputs.kids, inputs.schoolTier),
    { otherMonthly: inputs.uaeOtherMonthly }
  );
  const ukCostsMo = ukMonthlyCostsGBP(inputs.adults, inputs.kids, inputs.ukCity, inputs.ukOtherMonthly);
  const uaeTotalMoAED = uaeCostsMo.rent + uaeCostsMo.schools + uaeCostsMo.housingFee + uaeCostsMo.other;
  const ukTotalMoGBP = ukCostsMo.rent + ukCostsMo.councilTax + ukCostsMo.schools + ukCostsMo.other;
  const uaeNetMo = totalPackageAED / 12;
  const ukNetMo = uk.net / 12;
  return {
    uk,
    effectiveUaeGross,
    totalPackageAED,
    uaeUsingSuggested: inputs.uaeGross === null,
    uaeSalaryKnown,
    uaeCostsMo,
    ukCostsMo,
    uaeTotalMoAED,
    ukTotalMoGBP,
    uaeNetMo,
    ukNetMo,
    uaeLeftoverMo: uaeNetMo - uaeTotalMoAED,
    ukLeftoverMo: ukNetMo - ukTotalMoGBP,
    breakEvenAED: breakEvenUaeAED(inputs.ukGross),
  };
}
