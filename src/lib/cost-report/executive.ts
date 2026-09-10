import type { CostReport, Money } from "./columns";

/**
 * The executive view of the cost report, as on the Excel "Level 01" sheet: budget columns (E, F, G)
 * include the budget hold; the change, forecast and certified columns exclude it, so the unallocated
 * hold shows as "under budget" in the variance.
 */
export function executiveTotals(r: CostReport): Money {
  const g = r.grandTotal;
  const x = r.totalsExclHold;
  const N = x.N;
  return { ...x, E: g.E, F: g.F, G: g.G, N, O: Math.round((N - g.G + Number.EPSILON) * 100) / 100 };
}
