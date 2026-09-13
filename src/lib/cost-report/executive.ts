import type { CostReport, Money } from "./columns";

/**
 * The executive view of the cost report, as on the Excel "Level 01" sheet: the budget (E, F, G) and
 * the anticipated final account (N) include the budget-hold lines – the hold absorbs changes up to
 * its own budget and its remainder stays in the forecast – so the variance to budget (O) is what
 * the hold could not absorb, exactly as the Excel "Variance to Budget". The change, early-warning,
 * claim and certified columns are shown without the hold's offsets.
 */
export function executiveTotals(r: CostReport): Money {
  const g = r.grandTotal;
  const x = r.totalsExclHold;
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const N = g.N;
  return { ...x, E: g.E, F: g.F, G: g.G, N, O: r2(N - g.G), Q: r2(N - x.P), R: g.R, S: g.S };
}
