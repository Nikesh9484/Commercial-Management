import type { ReportData } from "./data";
import { claimCostReportAmount } from "../registers/defs/claims";

/**
 * The consolidated "Uncommitted Costs and Early Warnings" table for one reporting period, laid out
 * like the programme-wide "Level 5 – Contracts" sheet: every cost report line with its approved
 * budget, commitments, the uncommitted amounts by kind (VOs under process, EOT and other claims,
 * identified uncommitted scope, plant supply, FF&E), what is uncommitted / not required, the early
 * warnings and the estimate at completion – all read from that report's own registers, so a locked
 * report gives the figures it was issued with. Each early warning behind column L is carried in the
 * column its wording names (EOT claims, other claims, identified uncommitted scope, plant supply,
 * FF&E) and only the rest stays under early warnings; they are listed underneath, contract by
 * contract, as they came in on the Early Warning sheet of the workbook.
 */
const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface UncommittedRow {
  kind: "line" | "category" | "total";
  /** 1TB01031.01.CN.031C15.00 – programme, asset, section and contract, as the consolidated sheet codes them */
  code: string;
  name: string;
  contractor: string;
  category: string;
  budget: number;
  commitments: number;
  voUnderProcess: number;
  eotClaims: number;
  otherClaims: number;
  uncommittedScope: number;
  plantSupply: number;
  ffe: number;
  totalUncommitted: number;
  notRequired: number;
  earlyWarnings: number;
  eac: number;
  /** the early warnings on this line (column L), as on the workbook's Early Warning sheet */
  ews: EwDetail[];
}

/** Where an early warning's amount is carried in the table, read from its wording. */
export type EwBucket = "eotClaims" | "otherClaims" | "uncommittedScope" | "plantSupply" | "ffe" | "earlyWarnings";
export const EW_BUCKET_LABEL: Record<EwBucket, string> = {
  eotClaims: "EOT claims",
  otherClaims: "Other claims",
  uncommittedScope: "Identified uncommitted scope",
  plantSupply: "Plant supply",
  ffe: "FF&E",
  earlyWarnings: "Early warnings (other)",
};

/**
 * "EOT-02 COST – MME – Extension of time" → EOT claims; "Elmar EOT-01 Cost Claim" → EOT claims;
 * "Additional scope of Topographic Survey" / "Additional Slipway" / "MEP works … Survey" → identified
 * uncommitted scope; plant or equipment supply → plant supply; furniture, FF&E, OS&E → FF&E; any other
 * claim → other claims; the rest stays under early warnings.
 */
export function ewBucket(description: string, lineCategory = ""): EwBucket {
  const t = ` ${description} `.toLowerCase();
  if (/\beot\b|extension of time|prolongation|time[- ]related|acceleration|delay (cost|claim|damages)/.test(t)) return "eotClaims";
  if (/\bclaims?\b|dispute|back[- ]?charge|disruption|loss and expense/.test(t)) return "otherClaims";
  if (/ff&e|ff & e|\bffe\b|os&e|\bose\b|furniture|fixtures|loose equipment/.test(t) || /ff&e|os&e/i.test(lineCategory)) return "ffe";
  if (/\bplants?\b(?! ?ing)|machinery|equipment supply|plant supply|free[- ]issue/.test(t) || /plant/i.test(lineCategory)) return "plantSupply";
  if (/additional|add(ition)?\b|extra work|new scope|scope gap|missed|omission|not included|instruct|variation|provisional sum|survey|installation|works\b|upgrade|supply/.test(t)) return "uncommittedScope";
  return "earlyWarnings";
}

export interface EwDetail {
  ewNo: string;
  /** which column of the table carries its amount */
  bucket: EwBucket;
  bucketLabel: string;
  description: string;
  contractor: string;
  status: string;
  likelihood: string;
  /** what the line carries in column L for it: the cost impact while the warning is open and linked */
  amount: number;
  raised: string;
}

export interface UncommittedTable {
  rows: UncommittedRow[];
  total: UncommittedRow;
  /** early warnings not linked to any cost report line (not in column L) */
  unlinkedEws: EwDetail[];
  counts: { lines: number; ews: number; openEws: number };
}

export const UNCOMMITTED_MONEY_KEYS = ["budget", "commitments", "voUnderProcess", "eotClaims", "otherClaims", "uncommittedScope", "plantSupply", "ffe", "totalUncommitted", "notRequired", "earlyWarnings", "eac"] as const;

function blank(kind: UncommittedRow["kind"], code: string, name: string, contractor = "", category = ""): UncommittedRow {
  return { kind, code, name, contractor, category, budget: 0, commitments: 0, voUnderProcess: 0, eotClaims: 0, otherClaims: 0, uncommittedScope: 0, plantSupply: 0, ffe: 0, totalUncommitted: 0, notRequired: 0, earlyWarnings: 0, eac: 0, ews: [] };
}

export function buildUncommittedTable(data: ReportData): UncommittedTable {
  const lines = data.costReport.lines;
  const claims = data.registers.claims?.rows ?? [];
  const ews = data.registers.early_warnings?.rows ?? [];
  const byLine = new Map<number, UncommittedRow>();
  const asset = data.asset?.code ?? `${data.programme.code}.01`;
  for (const l of lines) {
    const row = blank("line", `${l.asset_code || asset}.${l.code}`, l.name, l.contractor, l.category);
    row.budget = l.G;
    row.commitments = l.I;
    row.voUnderProcess = l.J;
    row.uncommittedScope = l.K;
    row.earlyWarnings = l.L;
    row.otherClaims = l.M; // the EOT claims are taken out below, from the claims register
    row.eac = l.N;
    byLine.set(l.id, row);
  }
  for (const c of claims) {
    const row = byLine.get(Number(c.cost_line_id));
    if (!row) continue;
    const amount = claimCostReportAmount(c);
    if (!amount) continue;
    if (c.type_eot === true || c.type_eot === 1 || c.type_prolongation === true || c.type_prolongation === 1) {
      row.eotClaims += amount;
      row.otherClaims -= amount;
    }
  }
  const unlinkedEws: EwDetail[] = [];
  let openEws = 0;
  for (const e of ews) {
    const live = e.status === "Open" && !!e.cost_line_id;
    if (e.status === "Open") openEws++;
    const row = byLine.get(Number(e.cost_line_id));
    const bucket = ewBucket(String(e.description ?? ""), row?.category ?? "");
    const d: EwDetail = { ewNo: String(e.ew_no ?? ""), bucket, bucketLabel: EW_BUCKET_LABEL[bucket], description: String(e.description ?? ""), contractor: String(e.contractor_id__label ?? ""), status: String(e.status ?? ""), likelihood: String(e.likelihood ?? ""), amount: live ? r2(n(e.cost_impact)) : 0, raised: String(e.date_raised ?? "") };
    if (row) {
      row.ews.push(d);
      // the amount moves from column L to the column its wording names; what is left stays under early warnings
      if (bucket !== "earlyWarnings" && d.amount) {
        row[bucket] += d.amount;
        row.earlyWarnings -= d.amount;
      }
    } else unlinkedEws.push(d);
  }
  const finish = (row: UncommittedRow) => {
    row.totalUncommitted = row.voUnderProcess + row.eotClaims + row.otherClaims + row.uncommittedScope + row.plantSupply + row.ffe + row.earlyWarnings;
    row.notRequired = row.budget - row.commitments;
    for (const k of UNCOMMITTED_MONEY_KEYS) row[k] = r2(row[k]);
    row.ews.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  };
  const rows: UncommittedRow[] = [];
  const total = blank("total", data.programme.code, `${data.programme.name} – total`);
  for (const cat of data.costReport.categories) {
    const sub = blank("category", cat.key, cat.label.startsWith(cat.asset_code) ? cat.label : `${cat.asset_code} · ${cat.label}`, "", cat.category);
    const members = cat.lines.map((l) => byLine.get(l.id)!).filter(Boolean);
    if (!members.length) continue;
    for (const m of members) {
      finish(m);
      for (const k of UNCOMMITTED_MONEY_KEYS) if (k !== "totalUncommitted" && k !== "notRequired") sub[k] += m[k];
    }
    finish(sub);
    rows.push(sub, ...members);
    for (const k of UNCOMMITTED_MONEY_KEYS) if (k !== "totalUncommitted" && k !== "notRequired") total[k] += sub[k];
  }
  finish(total);
  return { rows, total, unlinkedEws, counts: { lines: byLine.size, ews: ews.length, openEws } };
}
