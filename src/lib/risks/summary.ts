import { PROBABILITY_BANDS, IMPACT_BANDS, bandIndex, severity } from "../registers/defs/risks";
import type { RecordRow } from "../registers/types";

export interface HeatCell {
  prob: number; // band index
  impact: number; // band index
  severity: "Low" | "Medium" | "High";
  risks: number;
  opportunities: number;
  items: { no: string; type: string; description: string }[];
}

export interface RiskSummary {
  totals: { type: string; count: number; open: number; costImpact: number; expectedValue: number; timeImpact: number }[];
  netExpected: number; // risk EV − opportunity EV (open items)
  heat: HeatCell[];
  unrated: number;
  probabilityBands: string[];
  impactBands: string[];
}

export interface EwSummary {
  total: number;
  open: number;
  converted: number;
  closed: number;
  openCost: number;
  openTime: number;
  unlinked: number;
  byLikelihood: Record<string, number>;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

export function getRiskSummary(rows: RecordRow[]): RiskSummary {
  const openRows = rows.filter((r) => r.status === "Open" || r.status === "Mitigating");
  const totals = ["Risk", "Opportunity"].map((type) => {
    const all = rows.filter((r) => r.type === type);
    const open = openRows.filter((r) => r.type === type);
    return {
      type,
      count: all.length,
      open: open.length,
      costImpact: open.reduce((t, r) => t + num(r.cost_impact), 0),
      expectedValue: open.reduce((t, r) => t + num(r.expected_value), 0),
      timeImpact: open.reduce((t, r) => t + num(r.time_impact_days), 0),
    };
  });
  const heat: HeatCell[] = [];
  for (let p = PROBABILITY_BANDS.length - 1; p >= 0; p--) {
    for (let i = 0; i < IMPACT_BANDS.length; i++) heat.push({ prob: p, impact: i, severity: severity(p, i), risks: 0, opportunities: 0, items: [] });
  }
  let unrated = 0;
  for (const r of openRows) {
    if (r.probability === null || r.probability === undefined || r.cost_impact === null || r.cost_impact === undefined) {
      unrated++;
      continue;
    }
    const p = bandIndex(Number(r.probability), PROBABILITY_BANDS);
    const i = bandIndex(Number(r.cost_impact), IMPACT_BANDS);
    const cell = heat.find((c) => c.prob === p && c.impact === i)!;
    if (r.type === "Opportunity") cell.opportunities++;
    else cell.risks++;
    cell.items.push({ no: String(r.ro_no), type: String(r.type), description: String(r.description ?? "") });
  }
  return {
    totals,
    netExpected: totals[0].expectedValue - totals[1].expectedValue,
    heat,
    unrated,
    probabilityBands: PROBABILITY_BANDS.map((b) => b.label),
    impactBands: IMPACT_BANDS.map((b) => b.label),
  };
}

export function getEwSummary(rows: RecordRow[]): EwSummary {
  const open = rows.filter((r) => r.status === "Open");
  const byLikelihood: Record<string, number> = { Low: 0, Med: 0, High: 0 };
  for (const r of open) if (typeof r.likelihood === "string" && r.likelihood in byLikelihood) byLikelihood[r.likelihood]++;
  return {
    total: rows.length,
    open: open.length,
    converted: rows.filter((r) => r.status === "Converted to RFC").length,
    closed: rows.filter((r) => r.status === "Closed").length,
    openCost: open.reduce((t, r) => t + num(r.cost_impact), 0),
    openTime: open.reduce((t, r) => t + num(r.time_impact_days), 0),
    unlinked: open.filter((r) => !r.cost_line_id).length,
    byLikelihood,
  };
}
