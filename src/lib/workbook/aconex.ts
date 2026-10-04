/**
 * The Aconex control account export ("control-account-export.csv"): the project's WBS as the
 * finance / cost system holds it – one row per contract (type "wbs", coded
 * 1TB01031.01.CN.031C15) with its control accounts underneath (.00 contract, .01 provisional sums,
 * .02 variations, .03 withholding tax) and the budget-hold control accounts (…PS.98). Uploaded on
 * its own, per project, whenever a check against the dashboard is wanted; the reconciliation report
 * then lists every difference line by line.
 */
import type { SheetValues } from "./read";
import { cellText } from "./read";
import { cols, findHeaderRow, rows, txt, type ConvertedSheet, type Sheet } from "./marina";
import { codeFrag } from "./claims-tracker";
import { programmeCodeOf } from "./recovery";

/** A CSV file as the same sheet shape the workbook reader produces, so the converters need not care. */
export function csvToSheets(text: string, name: string): SheetValues[] {
  const src = text.replace(/^﻿/, "");
  const out = new Map<number, unknown[]>();
  let row: unknown[] = [null];
  let field = "";
  let quoted = false;
  let r = 1;
  const endField = () => {
    const t = field;
    field = "";
    const n = t.trim();
    // numbers as Aconex writes them: "1,234.50", "-1,234.50", " -3,303,617.61"
    if (/^-?[\d,]+(\.\d+)?$/.test(n) && n !== "") row.push(Number(n.replace(/,/g, "")));
    else row.push(t === "" ? null : t);
  };
  const endRow = () => {
    endField();
    if (row.some((v, i) => i > 0 && v !== null && v !== "")) out.set(r, row);
    r++;
    row = [null];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") endField();
    else if (ch === "\n") endRow();
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 1) endRow();
  return [{ name: name.replace(/\.csv$/i, "") || "Sheet1", rows: out, rowCount: r - 1, truncated: false }];
}

export function looksLikeAconexExport(sheets: SheetValues[]): boolean {
  const s = sheets[0];
  return !!s && findHeaderRow(s, "parent code", "control budget", "estimate at completion") !== null;
}

export interface AconexContext {
  programmeCode: string;
  programmeName: string;
  /** cost lines by contract code fragment (031C15) */
  linesByFrag: Map<string, { code: string; contractor: string }>;
  /** the budget-hold cost lines by "asset.section" ("1TB01006.01.PS") */
  holdLinesByKey: Map<string, string>;
  fileName: string;
  today: string;
}

export interface AconexResult {
  sheets: ConvertedSheet[];
  notes: string[];
  total: number;
  kept: number;
}

// the standard Aconex Cost columns, then RSG's own columns (Estimate At Completion RSG 1115 is the budget less the
// approved early warnings; 1040 the certification view) – read where the export carries them
const RSG_COLS = ["Estimate At Completion RSG 1115", "At Completion Variance RSG 1115", "Approved Early Warnings RSG", "Pending Early Warnings RSG", "Potential Change / Early Warning", "Pending Contract Changes (PVOs)", "AMA Potential ETC", "Remaining To Certify RSG 1040", "Paid To Date", "Deductions (Non-Repayable)", "Deductions (Repayable)"] as const;
const COLS = ["Baseline Budget", "Approved Budget Changes", "Approved Budget Transfers", "Approved Budget", "Pending Budget", "Current Commitments", "Approved Downstream Contracts", "Approved Downstream Contract Changes", "Pending Downstream Contract Changes", "Current Downstream Contracts", "Estimate at Completion", "Potential EAC", "Incurred to Date", "Direct Actuals to Date", "At Completion Variance", ...RSG_COLS] as const;

export function convertAconexExport(sheets: SheetValues[], ctx: AconexContext): AconexResult {
  const s: Sheet = sheets[0];
  const notes: string[] = [];
  const hdr = findHeaderRow(s, "parent code", "control budget", "estimate at completion") ?? 1;
  const head = (s.rows.get(hdr) ?? []).map((v) => cellText(v).trim().toLowerCase());
  const col = (label: string) => head.indexOf(label.toLowerCase());
  const ix = { parent: col("Parent Code"), type: col("Type"), level: col("Level"), name: col("Name"), code: col("Code"), desc: col("Description") };
  const money = new Map<string, number>();
  for (const c of COLS) money.set(c, col(c));
  const num = (v: unknown[], c: string) => {
    const i = money.get(c) ?? -1;
    const x = i >= 0 ? v[i] : null;
    return typeof x === "number" ? Math.round(x * 100) / 100 : null;
  };
  const out: unknown[][] = [];
  let total = 0;
  let kept = 0;
  let linked = 0;
  for (const [r, v] of rows(s)) {
    if (r <= hdr) continue;
    const code = txt(v, ix.code);
    const type = txt(v, ix.type);
    if (!code || code.startsWith("[")) continue; // the technical key row under the header
    total++;
    if (programmeCodeOf(code) !== ctx.programmeCode.toUpperCase()) continue;
    const parts = code.split(".");
    const last = parts[parts.length - 1];
    // kept: the contract rows (a WBS row whose last segment is a contract code, e.g. 031C15) and the
    // budget-hold control accounts (…98); the .00/.01/.02 control accounts roll up into their contract
    const isContract = type === "wbs" && !!codeFrag(code) && /^\d{3}[A-Z]\d{2,3}$/i.test(last);
    const isHold = type === "controlAccount" && last === "98";
    if (!isContract && !isHold) continue;
    kept++;
    const frag = isContract ? codeFrag(code) : null;
    const line = frag ? ctx.linesByFrag.get(frag) : isHold ? { code: ctx.holdLinesByKey.get(parts.slice(0, -1).join(".")) ?? "", contractor: "" } : undefined;
    if (line?.code) linked++;
    out.push([
      code,
      code,
      txt(v, ix.name),
      txt(v, ix.desc),
      isContract ? "Contract" : "Budget hold",
      txt(v, ix.level),
      txt(v, ix.parent),
      line?.code || null,
      ctx.today,
      num(v, "Baseline Budget"),
      num(v, "Approved Budget Changes"),
      num(v, "Approved Budget Transfers"),
      num(v, "Approved Budget"),
      num(v, "Pending Budget"),
      num(v, "Approved Downstream Contracts"),
      num(v, "Approved Downstream Contract Changes"),
      num(v, "Pending Downstream Contract Changes"),
      num(v, "Current Commitments"),
      num(v, "Estimate at Completion"),
      num(v, "Potential EAC"),
      num(v, "Incurred to Date"),
      num(v, "Direct Actuals to Date"),
      num(v, "At Completion Variance"),
      ...RSG_COLS.map((c) => num(v, c)),
    ]);
  }
  const rsgPresent = RSG_COLS.filter((c) => (money.get(c) ?? -1) >= 0);
  notes.push(rsgPresent.length ? `RSG columns read as well: ${rsgPresent.join(", ")}.` : "No RSG columns (Estimate At Completion RSG 1115, early warnings, PVOs) in this export – the standard Aconex figures are compared.");
  notes.push(`Aconex control account export: ${kept} contract and budget-hold rows of ${ctx.programmeName} (${ctx.programmeCode}) out of ${total} rows in the file; ${linked} tied to a cost report line by contract code.`);
  if (kept && linked < kept) notes.push(`${kept - linked} row(s) have no cost report line with the same contract code – they are listed in the reconciliation as "not on the dashboard".`);
  return {
    sheets: [
      {
        name: "Aconex Control Accounts",
        register: "aconex_control_accounts",
        columns: cols([
          ["Tracker key", "tracker_key"],
          ["WBS code", "code"],
          ["Name", "name"],
          ["Description", "description"],
          ["Row type", "row_type"],
          ["Level", "level"],
          ["Parent code", "parent_code"],
          ["Cost report line", "cost_line_id"],
          ["Export uploaded", "tracker_date"],
          ["Baseline budget", "baseline_budget"],
          ["Approved budget changes", "approved_budget_changes"],
          ["Approved budget transfers", "approved_budget_transfers"],
          ["Approved budget", "approved_budget"],
          ["Pending budget", "pending_budget"],
          ["Approved contracts (awarded)", "approved_contracts"],
          ["Approved contract changes (DVO)", "approved_changes"],
          ["Pending contract changes (PVO)", "pending_changes"],
          ["Current commitments", "current_commitments"],
          ["Estimate at completion", "eac"],
          ["Potential EAC", "potential_eac"],
          ["Incurred to date", "incurred_to_date"],
          ["Direct actuals to date", "actuals_to_date"],
          ["At completion variance", "at_completion_variance"],
          ["Estimate at completion (RSG 1115)", "eac_rsg"],
          ["At completion variance (RSG 1115)", "at_completion_variance_rsg"],
          ["Approved early warnings (RSG)", "approved_early_warnings_rsg"],
          ["Pending early warnings (RSG)", "pending_early_warnings_rsg"],
          ["Potential change / early warning", "potential_change_ew"],
          ["Pending contract changes (PVOs, RSG)", "pending_pvos_rsg"],
          ["AMA potential ETC", "potential_etc_ama"],
          ["Remaining to certify (RSG 1040)", "remaining_to_certify_rsg"],
          ["Paid to date", "paid_to_date"],
          ["Deductions (non-repayable)", "deductions_non_repayable"],
          ["Deductions (repayable)", "deductions_repayable"],
        ]),
        rows: out,
      },
    ],
    notes,
    total,
    kept,
  };
}

/* ------------------------------------------------------------------ */
/* The change-event export                                             */
/* ------------------------------------------------------------------ */

export function looksLikeAconexChangeEvents(sheets: SheetValues[]): boolean {
  const s = sheets[0];
  return !!s && findHeaderRow(s, "event no", "budget status", "total cost impact") !== null;
}

/** "031C02-PVO-0013", "031D04-PVO 0001", "031C02-PVO-0010-Cancelled", "1TB01031.01.CN.98-BTR-0001" */
export function parseEventNo(no: string): { frag: string | null; kind: string; number: number | null } {
  const t = no.trim().toUpperCase();
  const m = t.match(/^(?:(\d{3}[A-Z]\d{2,3})|(?:[A-Z0-9.]+))[-\s]+([A-Z]{2,4})[-\s]*(\d+)?/);
  const kind = m?.[2] ?? "";
  return { frag: m?.[1] ?? null, kind: ["PVO", "BTR", "RFC", "ADJ"].includes(kind) ? kind : "Other", number: m?.[3] !== undefined ? Number(m[3]) : null };
}

const EVENT_COLS = ["Total Budget Impact", "Approved Total Budget Impact", "Total Cost Impact", "Approved Total Cost Impact", "Potential Total Cost Impact", "Budget Transfer From", "Budget Transfer To", "Net Budget Transfer", "Approved Downstream Contract Changes", "Pending Downstream Contract Changes", "Approved Downstream Contract Change Events", "Potential Downstream Contract Change Events"] as const;

export function convertAconexChangeEvents(sheets: SheetValues[], ctx: AconexContext): AconexResult {
  const s: Sheet = sheets[0];
  const notes: string[] = [];
  const hdr = findHeaderRow(s, "event no", "budget status", "total cost impact") ?? 1;
  const head = (s.rows.get(hdr) ?? []).map((v) => cellText(v).trim().toLowerCase());
  const col = (label: string) => head.findIndex((h) => h === label.toLowerCase() || h.replace(/\s*\*$/, "") === label.toLowerCase());
  const ix = { no: col("Event No."), internal: col("Internal Event No."), name: col("Name"), desc: col("Description"), date: col("Event Date"), budget: col("Budget Status"), cost: col("Cost Status"), type: col("Change Event Type") };
  const money = new Map<string, number>();
  for (const c of EVENT_COLS) money.set(c, col(c));
  const num = (v: unknown[], c: string) => {
    const i = money.get(c) ?? -1;
    const x = i >= 0 ? v[i] : null;
    if (typeof x === "number") return Math.round(x * 100) / 100;
    const n = Number(String(x ?? "").replace(/[,\s]/g, ""));
    return x !== null && x !== "" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  const out: unknown[][] = [];
  let total = 0;
  let kept = 0;
  let linked = 0;
  let other = 0;
  for (const [r, v] of rows(s)) {
    if (r <= hdr) continue;
    const no = txt(v, ix.no);
    if (!no || no.startsWith("[")) continue;
    total++;
    // a code naming another project's programme belongs to that project's export
    const prog = programmeCodeOf(no);
    if (prog && prog !== ctx.programmeCode.toUpperCase()) {
      other++;
      continue;
    }
    const { frag, kind } = parseEventNo(no);
    const line = frag ? ctx.linesByFrag.get(frag) : undefined;
    if (line?.code) linked++;
    kept++;
    const date = txt(v, ix.date).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
    out.push([
      no,
      no,
      kind,
      frag,
      txt(v, ix.name),
      txt(v, ix.desc),
      txt(v, ix.internal),
      date,
      txt(v, ix.budget),
      txt(v, ix.cost),
      txt(v, ix.type),
      line?.code || null,
      line?.contractor || null,
      ctx.today,
      num(v, "Total Cost Impact"),
      num(v, "Approved Total Cost Impact"),
      num(v, "Potential Total Cost Impact"),
      num(v, "Total Budget Impact"),
      num(v, "Approved Total Budget Impact"),
      num(v, "Budget Transfer From"),
      num(v, "Budget Transfer To"),
      num(v, "Net Budget Transfer"),
      num(v, "Approved Downstream Contract Changes"),
      num(v, "Pending Downstream Contract Changes"),
      num(v, "Approved Downstream Contract Change Events"),
      num(v, "Potential Downstream Contract Change Events"),
    ]);
  }
  notes.push(`Aconex change-event export: ${kept} events of ${ctx.programmeName} (${ctx.programmeCode}) out of ${total} rows in the file; ${linked} tied to a cost report line (and its contractor) by the contract code in the event number.${other ? ` ${other} row(s) naming another project were left out.` : ""}`);
  if (kept && linked < kept) notes.push(`${kept - linked} event(s) carry no contract code the cost report knows (budget-hold transfers, say) – they are listed under "no contractor" in the check.`);
  return {
    sheets: [
      {
        name: "Aconex Change Events",
        register: "aconex_change_events",
        columns: cols([
          ["Tracker key", "tracker_key"],
          ["Event no", "event_no"],
          ["Kind", "kind"],
          ["Contract", "contract_frag"],
          ["Name", "name"],
          ["Description", "description"],
          ["Internal event no", "internal_no"],
          ["Event date", "event_date"],
          ["Budget status", "budget_status"],
          ["Cost status", "cost_status"],
          ["Change event type", "event_type"],
          ["Cost report line", "cost_line_id"],
          ["Contractor", "contractor_id"],
          ["Export uploaded", "tracker_date"],
          ["Total cost impact", "total_cost_impact"],
          ["Approved cost impact", "approved_cost_impact"],
          ["Potential cost impact", "potential_cost_impact"],
          ["Total budget impact", "total_budget_impact"],
          ["Approved budget impact", "approved_budget_impact"],
          ["Budget transfer from", "budget_transfer_from"],
          ["Budget transfer to", "budget_transfer_to"],
          ["Net budget transfer", "net_budget_transfer"],
          ["Approved contract changes", "approved_contract_changes"],
          ["Pending contract changes", "pending_contract_changes"],
          ["Approved change events", "approved_change_events"],
          ["Potential change events", "potential_change_events"],
        ]),
        rows: out,
      },
    ],
    notes,
    total,
    kept,
  };
}
