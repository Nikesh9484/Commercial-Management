import type { CostReport, Money } from "./columns";

/**
 * The executive view of the cost report, as on the project's Excel "Level 01" sheet. The budget
 * (E, F, G) always includes the budget-hold lines; the change, early-warning, claim and certified
 * columns are shown without the hold's offsets. What differs per project is the anticipated final
 * account:
 *   - hold counted as a commitment (VBH): N includes the hold's remainder after it absorbed what it
 *     could, so the variance (O) is what the hold could not absorb;
 *   - hold left out (The Marina): N is the lines without the hold, so the unallocated hold shows as
 *     under budget in the variance.
 * The period movement (S) follows the same choice, total against total.
 */
export function executiveTotals(r: CostReport): Money {
  const g = r.grandTotal;
  const x = r.totalsExclHold;
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const base = r.holdInAfa ? g : x;
  const N = base.N;
  return { ...x, E: g.E, F: g.F, G: g.G, N, O: r2(N - g.G), Q: r2(N - x.P), R: base.R, S: base.S };
}
