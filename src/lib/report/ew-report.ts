import type { ReportData } from "./data";
import type { RecordRow } from "../registers/types";
import { formatDate } from "../format";
import { num, numOrNull, txt, money, plural, list, capMovement} from "./report-utils";

/**
 * Executive Early Warnings & Risks / Opportunities Status Report: open exposure feeding column L of
 * the cost report, the risk heat map summarised, and what needs attention – narrative written from the
 * two registers together, since one schedule (D) covers both in the monthly report.
 */
export interface EwLine {
  ew_no: string;
  description: string;
  raisedBy: string;
  contractor: string;
  package: string;
  status: string;
  likelihood: string;
  costImpact: number;
  timeImpactDays: number | null;
  daysOpen: number | null;
  dateRaised: string | null;
  linkedChange: boolean;
}

export interface RiskLine {
  ro_no: string;
  type: string;
  description: string;
  owner: string;
  status: string;
  probability: number | null;
  costImpact: number;
  expectedValue: number | null;
  rating: string;
}

export interface EwReport {
  title: string;
  asOf: string;
  headline: {
    ewTotal: number;
    ewOpen: number;
    ewOpenValue: number;
    ewConverted: number;
    ewOverdue30: number;
    ewOverdue60: number;
    risksTotal: number;
    risksOpen: number;
    opportunitiesOpen: number;
    riskExposure: number;
    opportunityValue: number;
    netExposure: number;
    highRated: number;
  };
  narrative: { heading: string; text: string }[];
  movement: { label: string; items: string[] } | null;
  attention: string[];
  ewOpen: EwLine[];
  risksOpen: RiskLine[];
  byLikelihood: { likelihood: string; n: number; value: number }[];
  byRating: { rating: string; n: number; risks: number; opportunities: number }[];
}

export function buildEwReport(data: ReportData): EwReport {
  const ewRows = (data.registers.early_warnings?.rows ?? []) as RecordRow[];
  const riskRows = (data.registers.risks?.rows ?? []) as RecordRow[];
  const asOf = data.period.period_end;
  const assetName = data.asset ? `${data.asset.code} ${data.asset.name}` : data.programme.name;

  const ewOpenRows = ewRows.filter((r) => txt(r.status) === "Open");
  const ewConverted = ewRows.filter((r) => r.change_id !== null && r.change_id !== undefined).length;
  const ewOpen: EwLine[] = ewOpenRows
    .map((r) => {
      const raised = txt(r.date_raised) || null;
      const days = raised ? Math.max(0, Math.round((new Date(asOf).getTime() - new Date(raised).getTime()) / 86400000)) : null;
      return {
        ew_no: txt(r.ew_no),
        description: txt(r.description),
        raisedBy: txt(r.raised_by),
        contractor: txt(r.contractor_id__label),
        package: txt(r.package_id__label),
        status: txt(r.status),
        likelihood: txt(r.likelihood) || "–",
        costImpact: num(r.cost_impact),
        timeImpactDays: numOrNull(r.time_impact_days),
        daysOpen: days,
        dateRaised: raised,
        linkedChange: !!(r.change_id !== null && r.change_id !== undefined),
      };
    })
    .sort((a, b) => b.costImpact - a.costImpact);

  const ewOpenValue = Math.round(ewOpen.reduce((t, r) => t + r.costImpact, 0) * 100) / 100;
  const overdue30 = ewOpen.filter((r) => (r.daysOpen ?? 0) > 30 && (r.daysOpen ?? 0) <= 60).length;
  const overdue60 = ewOpen.filter((r) => (r.daysOpen ?? 0) > 60).length;

  const byLikelihoodMap = new Map<string, { n: number; value: number }>();
  for (const r of ewOpen) {
    const k = r.likelihood;
    const b = byLikelihoodMap.get(k) ?? { n: 0, value: 0 };
    b.n++;
    b.value += r.costImpact;
    byLikelihoodMap.set(k, b);
  }
  const order = ["High", "Med", "Low", "–"];
  const byLikelihood = [...byLikelihoodMap.entries()].map(([likelihood, v]) => ({ likelihood, n: v.n, value: Math.round(v.value * 100) / 100 })).sort((a, b) => order.indexOf(a.likelihood) - order.indexOf(b.likelihood));

  const activeRiskStatuses = ["Open", "Mitigating"];
  const risksActive = riskRows.filter((r) => activeRiskStatuses.includes(txt(r.status)));
  const risksOpen: RiskLine[] = risksActive
    .map((r) => ({
      ro_no: txt(r.ro_no),
      type: txt(r.type),
      description: txt(r.description),
      owner: txt(r.owner),
      status: txt(r.status),
      probability: numOrNull(r.probability),
      costImpact: num(r.cost_impact),
      expectedValue: numOrNull(r.expected_value),
      rating: txt(r.rating) || "–",
    }))
    .sort((a, b) => (b.expectedValue ?? 0) - (a.expectedValue ?? 0));

  const risksOnly = risksOpen.filter((r) => r.type === "Risk");
  const oppsOnly = risksOpen.filter((r) => r.type === "Opportunity");
  const riskExposure = Math.round(risksOnly.reduce((t, r) => t + (r.expectedValue ?? r.costImpact), 0) * 100) / 100;
  const opportunityValue = Math.round(oppsOnly.reduce((t, r) => t + (r.expectedValue ?? r.costImpact), 0) * 100) / 100;
  const highRated = risksOpen.filter((r) => r.rating === "High").length;

  const byRatingMap = new Map<string, { risks: number; opportunities: number }>();
  for (const r of risksOpen) {
    const b = byRatingMap.get(r.rating) ?? { risks: 0, opportunities: 0 };
    if (r.type === "Risk") b.risks++;
    else b.opportunities++;
    byRatingMap.set(r.rating, b);
  }
  const ratingOrder = ["High", "Medium", "Low", "–"];
  const byRating = ratingOrder.filter((r) => byRatingMap.has(r)).map((rating) => ({ rating, n: (byRatingMap.get(rating)!.risks + byRatingMap.get(rating)!.opportunities), risks: byRatingMap.get(rating)!.risks, opportunities: byRatingMap.get(rating)!.opportunities }));

  const headline: EwReport["headline"] = {
    ewTotal: ewRows.length,
    ewOpen: ewOpenRows.length,
    ewOpenValue,
    ewConverted,
    ewOverdue30: overdue30,
    ewOverdue60: overdue60,
    risksTotal: riskRows.length,
    risksOpen: risksOnly.length,
    opportunitiesOpen: oppsOnly.length,
    riskExposure,
    opportunityValue,
    netExposure: Math.round((riskExposure - opportunityValue) * 100) / 100,
    highRated,
  };

  const mv = data.movement;
  const grpEw = mv?.groups.find((g) => g.key === "early_warnings");
  const grpRisk = mv?.groups.find((g) => g.key === "risks");
  const movement =
    mv?.previous && (grpEw || grpRisk)
      ? {
          label: `Since ${mv.previous.label}`,
          items: [
            ...(grpEw?.added ?? []).map((i) => `New early warning: ${i.key} ${i.title}${i.amount ? ` (${money(i.amount)})` : ""}`),
            ...(grpEw?.changed ?? []).map((i) => `${i.key} ${i.title}: ${i.from} -> ${i.to}${i.delta ? ` (${i.delta > 0 ? "+" : ""}${money(i.delta)})` : ""}`),
            ...(grpRisk?.added ?? []).map((i) => `New risk / opportunity: ${i.key} ${i.title}${i.amount ? ` (${money(i.amount)})` : ""}`),
            ...(grpRisk?.changed ?? []).map((i) => `${i.key} ${i.title}: ${i.from} -> ${i.to}`),
          ],
        }
      : null;

  const attention: string[] = [];
  if (headline.ewOverdue60) attention.push(`${plural(headline.ewOverdue60, "early warning")} open more than 60 days (${list(ewOpen.filter((e) => (e.daysOpen ?? 0) > 60).map((e) => e.ew_no))}) – decide whether it converts to a change or closes.`);
  const bigEw = ewOpen.slice(0, 3);
  if (bigEw.length && bigEw[0].costImpact > 0) attention.push(`The largest open early warnings are ${list(bigEw.map((e) => `${e.ew_no} ${money(e.costImpact)}`))} – these carry the most potential cost in column L.`);
  if (highRated) attention.push(`${plural(highRated, "risk or opportunity")} rated High (${list(risksOpen.filter((r) => r.rating === "High").map((r) => r.ro_no))}) – these need an owner and a mitigation plan, not just monitoring.`);
  const noOwner = risksOpen.filter((r) => !r.owner);
  if (noOwner.length) attention.push(`${plural(noOwner.length, "open risk / opportunity")} with no owner assigned (${list(noOwner.map((r) => r.ro_no))}).`);

  const narrative: { heading: string; text: string }[] = [];
  narrative.push({
    heading: "Position at cut-off",
    text:
      ewRows.length === 0 && riskRows.length === 0
        ? `No early warnings or risks are recorded against ${assetName} as at ${formatDate(asOf)}.`
        : `As at ${formatDate(asOf)}, ${plural(headline.ewOpen, "early warning")} ${headline.ewOpen === 1 ? "is" : "are"} open against ${assetName}, carrying ${money(headline.ewOpenValue)} of potential cost in column L of the cost report; ${headline.ewConverted} early warning(s) have already been converted into a change. Separately, the risk and opportunity register holds ${plural(headline.risksOpen, "open risk")} worth ${money(headline.riskExposure)} of expected exposure and ${plural(headline.opportunitiesOpen, "open opportunity", "open opportunities")} worth ${money(headline.opportunityValue)}, a net exposure of ${money(headline.netExposure)}.`,
  });
  if (mv?.previous) {
    const n = (grpEw?.added.length ?? 0) + (grpEw?.changed.length ?? 0) + (grpRisk?.added.length ?? 0) + (grpRisk?.changed.length ?? 0);
    narrative.push({
      heading: `Movement since ${mv.previous.label}`,
      text: n === 0 ? `No movement in the early warning or risk registers since ${mv.previous.label}.` : `${grpEw?.added.length ? `${plural(grpEw.added.length, "new early warning")} ${grpEw.added.length === 1 ? "was" : "were"} raised. ` : ""}${grpEw?.changed.length ? `${plural(grpEw.changed.length, "early warning")} changed. ` : ""}${grpRisk?.added.length ? `${plural(grpRisk.added.length, "new risk or opportunity")} ${grpRisk.added.length === 1 ? "was" : "were"} added. ` : ""}${grpRisk?.changed.length ? `${plural(grpRisk.changed.length, "risk or opportunity")} moved. ` : ""}`,
    });
  }
  narrative.push({
    heading: "Ageing and rating",
    text: `${headline.ewOpen === 0 ? "No open early warnings to age." : `${headline.ewOverdue60 ? `${plural(headline.ewOverdue60, "early warning")} over 60 days old` : "Nothing over 60 days old"}${headline.ewOverdue30 ? `, ${plural(headline.ewOverdue30, "more")} between 30 and 60` : ""}.`} ${headline.highRated ? `${plural(headline.highRated, "item")} on the risk register rate High on the probability / impact matrix and should be reviewed at the next commercial meeting.` : "No item on the risk register currently rates High."}`,
  });
  narrative.push({
    heading: "Outlook",
    text: `Convert early warnings to a change as soon as the cost is quantified, so the value moves from column L into the change tracker's own columns.${headline.opportunitiesOpen ? ` Keep pursuing the ${plural(headline.opportunitiesOpen, "identified opportunity", "identified opportunities")} worth ${money(headline.opportunityValue)}, which offset the risk exposure.` : ""}`,
  });

  return {
    title: `Early Warnings & Risks / Opportunities Status Report – ${data.period.label}`,
    asOf,
    headline,
    narrative,
    movement: capMovement(movement),
    attention,
    ewOpen,
    risksOpen,
    byLikelihood,
    byRating,
  };
}
