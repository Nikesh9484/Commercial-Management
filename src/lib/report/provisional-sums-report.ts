import type { ReportData } from "./data";
import type { RecordRow } from "../registers/types";
import { formatDate } from "../format";
import { num, txt, money, plural, list, capMovement} from "./report-utils";

/** Executive Provisional Sums Status Report: budget vs instructed value, savings and extras by status. */
export interface PsLine {
  item: string;
  description: string;
  status: string;
  contractor: string;
  budget: number;
  contractValue: number | null;
  savingExtra: number | null;
}

export interface PsReport {
  title: string;
  asOf: string;
  headline: {
    total: number;
    budget: number;
    instructed: number;
    withValue: number;
    withoutValue: number;
    savings: number;
    extras: number;
    net: number;
  };
  narrative: { heading: string; text: string }[];
  movement: { label: string; items: string[] } | null;
  attention: string[];
  rows: PsLine[];
  byStatus: { status: string; n: number; budget: number; contractValue: number }[];
}

export function buildPsReport(data: ReportData): PsReport {
  const src = (data.registers.provisional_sums?.rows ?? []) as RecordRow[];
  const asOf = data.period.period_end;
  const assetName = data.asset ? `${data.asset.code} ${data.asset.name}` : data.programme.name;

  const rows: PsLine[] = src.map((r) => ({
    item: txt(r.item),
    description: txt(r.description),
    status: txt(r.status_id__label) || "No status",
    contractor: txt(r.contractor_id__label),
    budget: num(r.budget),
    contractValue: r.contract_value === null || r.contract_value === undefined ? null : num(r.contract_value),
    savingExtra: r.saving_extra === null || r.saving_extra === undefined ? null : num(r.saving_extra),
  }));
  rows.sort((a, b) => Math.abs(b.savingExtra ?? 0) - Math.abs(a.savingExtra ?? 0));

  const budget = Math.round(rows.reduce((t, r) => t + r.budget, 0) * 100) / 100;
  const withValue = rows.filter((r) => r.contractValue !== null);
  const instructed = Math.round(withValue.reduce((t, r) => t + (r.contractValue ?? 0), 0) * 100) / 100;
  const savings = Math.round(rows.filter((r) => (r.savingExtra ?? 0) < 0).reduce((t, r) => t + Math.abs(r.savingExtra ?? 0), 0) * 100) / 100;
  const extras = Math.round(rows.filter((r) => (r.savingExtra ?? 0) > 0).reduce((t, r) => t + (r.savingExtra ?? 0), 0) * 100) / 100;

  const byStatusMap = new Map<string, { n: number; budget: number; contractValue: number }>();
  for (const r of rows) {
    const b = byStatusMap.get(r.status) ?? { n: 0, budget: 0, contractValue: 0 };
    b.n++;
    b.budget += r.budget;
    b.contractValue += r.contractValue ?? 0;
    byStatusMap.set(r.status, b);
  }
  const byStatus = [...byStatusMap.entries()].map(([status, v]) => ({ status, n: v.n, budget: Math.round(v.budget * 100) / 100, contractValue: Math.round(v.contractValue * 100) / 100 })).sort((a, b) => b.budget - a.budget);

  const headline: PsReport["headline"] = {
    total: rows.length,
    budget,
    instructed,
    withValue: withValue.length,
    withoutValue: rows.length - withValue.length,
    savings,
    extras,
    net: Math.round((extras - savings) * 100) / 100,
  };

  const mv = data.movement;
  const grp = mv?.groups.find((g) => g.key === "provisional_sums");
  const movement =
    mv?.previous && grp
      ? { label: `Since ${mv.previous.label}`, items: [...grp.added.map((i) => `New: ${i.key} ${i.title}${i.amount ? ` (${money(i.amount)})` : ""}`), ...grp.changed.map((i) => `${i.key} ${i.title}: ${i.from} -> ${i.to}${i.delta ? ` (${i.delta > 0 ? "+" : ""}${money(i.delta)})` : ""}`), ...grp.removed.map((i) => `Removed: ${i.key} ${i.title}`)] }
      : null;

  const attention: string[] = [];
  const bigExtras = rows.filter((r) => (r.savingExtra ?? 0) > 0).slice(0, 3);
  if (bigExtras.length) attention.push(`The largest extras against budget are ${list(bigExtras.map((r) => `${r.item} ${money(r.savingExtra ?? 0)}`))} – confirm these are captured as a change if the extra is a scope addition rather than a rate difference.`);
  if (headline.withoutValue) attention.push(`${plural(headline.withoutValue, "provisional sum")} not yet instructed (${list(rows.filter((r) => r.contractValue === null).map((r) => r.item))}) – ${money(rows.filter((r) => r.contractValue === null).reduce((t, r) => t + r.budget, 0))} of budget still to be committed.`);

  const narrative: { heading: string; text: string }[] = [];
  narrative.push({
    heading: "Position at cut-off",
    text:
      rows.length === 0
        ? `No provisional sums are recorded against ${assetName} as at ${formatDate(asOf)}.`
        : `As at ${formatDate(asOf)}, ${plural(rows.length, "provisional sum")} ${rows.length === 1 ? "is" : "are"} held against ${assetName} totalling ${money(budget)} of budget. ${headline.withValue} of ${rows.length} item(s) have been instructed, for ${money(instructed)}. Against budget, the instructed items show ${money(extras)} of extras and ${money(savings)} of savings, a net position of ${headline.net >= 0 ? `${money(headline.net)} above budget` : `${money(-headline.net)} below budget`}.`,
  });
  if (mv?.previous) {
    const n = grp ? grp.added.length + grp.changed.length + grp.removed.length : 0;
    narrative.push({ heading: `Movement since ${mv.previous.label}`, text: n === 0 ? `No movement in the provisional sums register since ${mv.previous.label}.` : `${grp!.added.length ? `${plural(grp!.added.length, "new item")} added. ` : ""}${grp!.changed.length ? `${plural(grp!.changed.length, "item")} changed status or value. ` : ""}${grp!.removed.length ? `${plural(grp!.removed.length, "item")} removed. ` : ""}` });
  }
  narrative.push({
    heading: "Outlook",
    text: headline.withoutValue === 0 ? "Every provisional sum has been instructed; the register is fully resolved." : `${plural(headline.withoutValue, "provisional sum")} worth ${money(rows.filter((r) => r.contractValue === null).reduce((t, r) => t + r.budget, 0))} of budget remains to be instructed – track these against the procurement programme.`,
  });

  return { title: `Provisional Sums Status Report – ${data.period.label}`, asOf, headline, narrative, movement: capMovement(movement), attention, rows, byStatus };
}
