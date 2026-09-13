import { getDb } from "../db";
import { getAppContext } from "../context";
import { allRegisters } from "../registers";
import { recordsForView } from "../view-mode";
import { listRecords } from "../registers/engine";
import { computeCostReport } from "../cost-report/compute";
import { getMovement } from "../dashboard/movement";
import { getDashboard } from "../dashboard/summary";
import { paymentTimeline, computeContracts } from "../payments/compute";
import { getCashflow } from "../cashflow/compute";
import { listReportLibrary } from "../periods";
import { getChecklist } from "../checklist";
import { listDocs, docText, LIBRARY_INFO, LIBRARIES } from "../library/store";
import type { RecordRow, RegisterDef } from "../registers/types";

/**
 * ASK ME: everything the dashboard knows about the current project and reporting period, written
 * out as plain text tables so the assistant can search all of it and answer any question. The pack
 * follows the top-bar period (a locked / earlier report reads its stored copy, like every page).
 */
const MAX_ROWS = 600;
/** Characters per section and for the whole pack (about 4 characters per token). */
const SECTION_CHARS = 70_000;
const MAX_CHARS = 620_000;

/** Keeps a section inside its budget by dropping rows from the end (never mid-row). */
function fit(section: string, cap = SECTION_CHARS): string {
  if (section.length <= cap) return section;
  const cut = section.lastIndexOf("\n", cap);
  const kept = section.slice(0, cut > 0 ? cut : cap);
  const dropped = section.slice(kept.length).split("\n").filter((l) => l.trim()).length;
  return `${kept}\n[… ${dropped} more line(s) not shown – ask for a narrower list, e.g. one contractor or one status …]`;
}

const money = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? "" : Number(v).toLocaleString("en", { maximumFractionDigits: 2 }));
const cell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toLocaleString("en", { maximumFractionDigits: 2 });
  return String(v).replace(/\s+/g, " ").trim().slice(0, 400);
};

/** A register as a pipe table: labelled columns, lookups shown by their label, virtual/derived columns included. */
function registerTable(def: RegisterDef, rows: RecordRow[]): string {
  const fields = def.fields.filter((f) => f.type !== "password" && !["programme_id"].includes(f.key));
  const head = fields.map((f) => f.label).join(" | ");
  const lines = rows.slice(0, MAX_ROWS).map((r) =>
    fields
      .map((f) => {
        if (f.type === "lookup") return cell(r[`${f.key}__label`] ?? r[f.key]);
        if (f.type === "money") return money(r[f.key]);
        return cell(r[f.key]);
      })
      .join(" | "),
  );
  return `### ${def.title} (${rows.length} row${rows.length === 1 ? "" : "s"}${rows.length > MAX_ROWS ? `, first ${MAX_ROWS} shown` : ""})\n${head}\n${lines.join("\n")}`;
}

export interface Pack {
  text: string;
  chars: number;
  project: string;
  period: string;
}

export function buildPack(): Pack {
  const db = getDb();
  const ctx = getAppContext();
  const parts: string[] = [];
  const programme = ctx.programme;
  if (!programme) return { text: "No project selected.", chars: 0, project: "", period: "" };
  const period = ctx.period;

  parts.push(`# PROJECT\nProject / programme: ${programme.code} – ${programme.name}\nAsset in the top bar: ${ctx.asset ? `${ctx.asset.code} – ${ctx.asset.name}` : "–"}\nAll assets of the project: ${ctx.assets.filter((a) => a.programme_id === programme.id).map((a) => `${a.code} ${a.name}`).join("; ")}\nReporting period in the top bar: ${period ? `${period.label} (cut-off ${period.period_end}, status ${period.status})` : "none"}\nPrevious period: ${ctx.previousPeriod?.label ?? "none"}\nAll amounts are SAR. Today is ${new Date().toISOString().slice(0, 10)}.`);

  // Cost report (Level 2 lines with every column) and Level 1 totals
  const report = computeCostReport(programme.id, period?.id ?? null);
  const cols = ["E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S"] as const;
  const colNames: Record<string, string> = { E: "Approved baseline budget", F: "Budget transfers", G: "Latest budget", H: "DVOs (determined VOs)", I: "Committed", J: "PVOs", K: "RFCs", L: "Early warnings", M: "Claims", N: "Anticipated final account", O: "Variance to latest budget", P: "Certified to date", Q: "Works to complete", R: "Previous AFA", S: "Period movement" };
  parts.push(fit(`# COST REPORT – ${report.period?.label ?? "current"}\nColumns: ${cols.map((c) => `${c}=${colNames[c]}`).join("; ")}.\n## Grand total (incl. budget hold)\n${cols.map((c) => `${c} ${money(report.grandTotal[c])}`).join(" | ")}\n## Total excluding budget-hold lines\n${cols.map((c) => `${c} ${money(report.totalsExclHold[c])}`).join(" | ")}\n## Level 1 – by cost category\n${report.level1.map((l) => { const o = l as unknown as Record<string, unknown>; const label = Object.entries(o).filter(([k, v]) => typeof v === "string" && !cols.includes(k as (typeof cols)[number])).map(([, v]) => v).join(" · "); return `${label}: ${cols.map((c) => `${c} ${money(o[c])}`).join(" | ")}`; }).join("\n")}\n## Level 2 lines\nCode | Asset | Package | Name | Contractor | Section | Category | Hold | ${cols.join(" | ")}\n${report.lines.map((l) => [l.code, l.asset_code, l.package, l.name, l.contractor, l.section, l.category, l.is_budget_hold ? "hold" : "", ...cols.map((c) => money((l as unknown as Record<string, unknown>)[c]))].map(cell).join(" | ")).join("\n")}`, 120_000));

  // Movement vs previous report
  const movement = period ? getMovement(db, programme.id, period.id) : null;
  if (movement) {
    parts.push(`# PERIOD MOVEMENT – ${movement.current.label} vs ${movement.previous?.label ?? "no previous report"}${movement.warning ? `\nNote: ${movement.warning}` : ""}\n## Cost report totals\n${movement.kpis.map((k) => `${k.key} ${k.label}: previous ${money(k.prev)} → now ${money(k.now)} (movement ${money(k.delta)})`).join("\n")}\n## Key movements\n${movement.keyMovements.map((m) => `${m.col} ${m.label}: ${money(m.kpiDelta)} – ${m.items.slice(0, 40).map((i) => `${i.key} ${i.title}: ${money(i.prev)} → ${money(i.now)} (${money(i.delta)})${i.note ? ` ${i.note}` : ""}`).join("; ")}`).join("\n")}\n## Change stages (prev → now)\n${movement.statusCounts.map((s) => `${s.stage}: total ${s.total.prev}→${s.total.now}, approved ${s.approved.prev}→${s.approved.now}, pending ${s.pending.prev}→${s.pending.now}, cancelled ${s.cancelled.prev}→${s.cancelled.now}`).join("\n")}\n## DVO ageing\n${movement.dvoAgeing.map((a) => `${a.bucket}: ${a.prev}→${a.now}`).join("; ")}\n## Payment tracker\n${movement.payments.map((p) => `${p.title} (${p.contractor}) ${p.status}: revised ${money(p.revised)}, certified ${money(p.certified)}, this period ${money(p.certifiedPeriod)}, paid ${money(p.paid)}, % certified ${p.pctCertified ?? "–"}, late IPCs ${p.lateIpcs}, late payments ${p.latePayments}`).join("\n")}`);
  }

  // Executive summary figures
  const dash = getDashboard(db, programme.id, period?.id ?? null);
  parts.push(`# EXECUTIVE SUMMARY\nOpen changes ${dash.openChanges}; open claims ${dash.openClaims} (pending value ${money(dash.claimsPendingValue)}); open early warnings ${dash.openEarlyWarnings} (value ${money(dash.ewOpenValue)}); open risks ${dash.openRisks}; checklist ${dash.checklist.done}/${dash.checklist.total}.\nOpen changes by stage: ${dash.openStages.map((s) => `${s.stage} ${s.open}`).join(", ")}.\nBonds & insurance: ${JSON.stringify(dash.bonds)}.\nKey issues this period: ${dash.keyIssues || "(none written)"}\nOpen actions: ${dash.actions.map((a) => `${cell(a.item_no)} ${cell(a.topic)} – ${cell(a.action)} (owner ${cell(a.owner)}, due ${cell(a.due_date)}, ${cell(a.status)})`).join("; ") || "none"}`);

  // Contracts & payments computed view, cash flow
  try {
    const computed = computeContracts(db, programme.id);
    parts.push(fit(`# CONTRACTS – PAYMENT POSITION (computed per contract)\n${[...computed.contracts.values()].map((c) => JSON.stringify(c)).join("\n")}`));
    const timeline = paymentTimeline(db, programme.id);
    parts.push(`# PAYMENT TIMELINE (by month)\n${timeline.map((t) => `${t.date}: claimed ${money(t.claimed)}, certified ${money(t.certified)}, paid ${money(t.paid)}`).join("\n")}`);
  } catch {
    /* payments not available */
  }
  try {
    const cf = getCashflow(db, programme.id);
    parts.push(fit(`# CASH FLOW\n${JSON.stringify(cf)}`, 40_000));
  } catch {
    /* cash flow not available */
  }

  // Report library and checklist
  try {
    const lib = listReportLibrary();
    parts.push(`# REPORT LIBRARY (monthly reports of this project)\n${lib.map((r) => `${r.label}: cut-off ${r.period_end}, ${r.status}${r.locked_at ? ` (locked ${r.locked_at} by ${r.locked_by})` : ""}, source ${r.source}${r.source_file ? ` ${r.source_file}` : ""}, data ${r.data}, ${r.snapshot_records} stored records${r.current ? " – selected in the top bar" : ""}`).join("\n")}`);
    if (period) parts.push(`# MONTH-END CHECKLIST – ${period.label}\n${getChecklist(period.id).map((c) => `${c.title}: ${c.done ? `done ${c.done_at ?? ""} by ${c.done_by ?? ""}` : "not done"}${c.comment ? ` – ${c.comment}` : ""}`).join("\n")}`);
  } catch {
    /* library not available */
  }

  // Document libraries: EOT (EARs) and contract documents – summaries and key points, plus an excerpt of the text
  for (const key of LIBRARIES) {
    const docs = listDocs(programme.id, key);
    if (!docs.length) continue;
    parts.push(`# ${LIBRARY_INFO[key].title.toUpperCase()} (${docs.length} documents)\n${docs
      .map((d) => {
        let pts: string[] = [];
        try {
          pts = JSON.parse(d.key_points || "[]");
        } catch {
          pts = [];
        }
        return `## ${d.title || d.name} [${d.doc_type}] – file ${d.rel_path}\nContractor: ${d.contractor ?? "–"}; contract code: ${d.contract_code ?? "–"}${d.contract_title ? ` (${d.contract_title})` : ""}; PO: ${d.po_no ?? "–"}; reference: ${d.reference || "–"}; date: ${d.doc_date ?? "–"}; claim: ${d.claim_ref || "–"}; EOT claimed ${d.eot_days_claimed ?? "–"} days, assessed ${d.eot_days_assessed ?? "–"} days; cost claimed ${money(d.cost_claimed)}, assessed ${money(d.cost_assessed)}.\nSummary: ${d.summary}\n${pts.map((p) => `- ${p}`).join("\n")}`;
      })
      .join("\n\n")}`);
  }

  // Every register, as the top-bar period sees it
  const skip = new Set(["users", "reporting_periods"]);
  for (const def of allRegisters) {
    if (skip.has(def.key)) continue;
    let rows: RecordRow[];
    try {
      rows = def.snapshot ? recordsForView(def, db) : listRecords(def);
    } catch {
      continue;
    }
    if (!rows.length) continue;
    parts.push(fit(`# REGISTER: ${def.title.toUpperCase()}${def.description ? `\n${def.description}` : ""}\n${registerTable(def, rows)}`));
  }


  let text = parts.join("\n\n");
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "\n\n[… the pack was cut here to fit the assistant's reading budget …]";
  // register definitions help the assistant explain what each column means
  const glossary = allRegisters
    .filter((d) => !skip.has(d.key))
    .map((d) => `${d.title}: ${d.fields.filter((f) => f.help).map((f) => `${f.label} – ${f.help}`).join("; ")}`)
    .filter((s) => s.includes("–"))
    .join("\n");
  text += `\n\n# GLOSSARY (what the fields mean)\n${glossary}`;
  return { text, chars: text.length, project: `${programme.code} – ${programme.name}`, period: period?.label ?? "" };
}

/** Full text of the library documents that a question seems to be about (searched by name / contractor / code words). */
export function documentTexts(question: string, maxChars = 250_000): string {
  const ctx = getAppContext();
  if (!ctx.programme) return "";
  const words = question.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const out: string[] = [];
  let used = 0;
  for (const key of LIBRARIES) {
    for (const d of listDocs(ctx.programme.id, key)) {
      const hay = `${d.name} ${d.title} ${d.contractor ?? ""} ${d.contract_code ?? ""} ${d.reference} ${d.claim_ref} ${d.doc_type}`.toLowerCase();
      const hits = words.filter((w) => hay.includes(w)).length;
      if (!hits) continue;
      const text = docText(d.id);
      if (!text) continue;
      const share = Math.min(text.length, Math.max(20_000, Math.floor(maxChars / 4)));
      if (used + share > maxChars) break;
      out.push(`## FULL TEXT – ${d.title || d.name} (${LIBRARY_INFO[key].short}, ${d.contractor ?? "–"} ${d.contract_code ?? ""})\n${text.slice(0, share)}${text.length > share ? "\n[… truncated …]" : ""}`);
      used += share;
    }
  }
  return out.join("\n\n");
}
