import { readPositioned, valueRight, valueBelow, numericRowsAfter, peopleUnder, peopleWithHeadings, moneyOf, findLabel, type PosPage } from "./positioned";
import type { PackValues } from "./shared";

/**
 * What the dashboard reads out of the files uploaded into a pack – no AI, no typing: the last
 * approved pack of the same kind gives the project's particulars, the contract figures, the budget
 * lines, the standard wording and the signatories; the RFC gives the scope, the reason and the
 * contractual basis; the cost assessment gives the value. Every reading is a value placed beside
 * its label on the form, read by position.
 */

export interface Reading {
  values: PackValues;
  /** which file gave each value */
  sources: Record<string, string>;
}

const POSITION = /(director|manager|head of|officer|specialist|engineer|chairman|representative|lead|executive|associate|senior|group|planner|analyst|surveyor|controller|chief|ceo|cfo|coo|partner|consultant)/i;
const money = (s: string) => {
  const n = moneyOf(s);
  return n === null ? "" : String(Math.round(n * 100) / 100);
};
const dateOf = (s: string) => {
  const m = s.match(/(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})/);
  if (!m) return s.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mi = months.indexOf(m[2].toLowerCase().slice(0, 3));
  if (mi < 0) return "";
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};
const set = (r: Reading, key: string, v: string | undefined, source: string) => {
  const t = String(v ?? "").trim();
  if (!t || t === "-" || t === "–") return;
  r.values[key] = t;
  r.sources[key] = source;
};
const lines = (people: { name: string; position: string }[]) => people.map((p) => p.name).join("\n");
const positions = (people: { name: string; position: string }[]) => people.map((p) => p.position).join("\n");

export async function positioned(bytes: Buffer): Promise<PosPage[]> {
  return readPositioned(bytes);
}

export type DocKind = "pvo" | "dvo" | "rfa" | "ear" | "rfc" | "cost" | "unknown";

/** What a PDF is, from the headings on its first pages – so a file in any entry is read the right way. */
export function classifyDoc(pages: PosPage[], slotHint: string): DocKind {
  const head = pages.slice(0, 3).flatMap((p) => p.rows.flatMap((r) => r.cells.map((c) => c.s))).join(" ").toLowerCase();
  const all = pages.slice(0, 6).flatMap((p) => p.rows.flatMap((r) => r.cells.map((c) => c.s))).join(" ").toLowerCase();
  if (/proposed variation order \(pvo\)|rsg-cm-frm-0013/.test(head)) return "pvo";
  if (/determination of variation order|rsg-cm-frm-0014|rgs-cm-frm-0014|pvo to dvo cost movement/.test(head)) return "dvo";
  if (/request for approval form|rsg-pr-frm-0004|trs-pr-frm-0004/.test(head)) return "rfa";
  if (/employer'?s assessment report|extension of time report|revision history/.test(head)) return "ear";
  if (/request for change|change request form|rsg-cm-frm-0011|\brfc\b.*\bform\b/.test(head)) return "rfc";
  if (/grand total|unit price|unite price|\bqty\b|cost proposal|bill of quantit|\bboq\b|rate breakdown/.test(all)) return "cost";
  if (slotHint === "cost" || slotHint === "rfc" || slotHint === "details") return slotHint === "cost" ? "cost" : "rfc";
  return "unknown";
}

/* ------------------------------------------------------------------ */
/* the last approved PVO (RSG-CM-FRM-0013)                             */

const GENERAL: [string, string, (string | RegExp)[]?][] = [
  ["pvo_no", "Proposed Variation Order No", ["Date"]],
  ["rfc_ref", "RFC/CRF Reference", ["Requesting Department"]],
  ["requesting_department", "Requesting Department"],
  ["development_name", "Development Name", ["Development No"]],
  ["development_no", "Development No"],
  ["program_name", "Program Name", ["Program No"]],
  ["program_no", "Program No"],
  ["project_name", "Project Name", ["Project Code"]],
  ["project_code", "Project Code"],
  ["contractor", "Vendor Name", ["EWBS Code"]],
  ["ewbs_code", "EWBS Code"],
  ["works_package", "Works Package", ["ACC Contract No"]],
  ["contract_no", "ACC Contract No"],
  ["destination", "Destination"],
];

export function readReferencePvo(pages: PosPage[]): Reading {
  const r: Reading = { values: {}, sources: {} };
  const src = "previous PVO";
  const form = pages.slice(0, Math.min(3, pages.length));
  for (const [key, label, not] of GENERAL) set(r, key, valueRight(form, label, { notLabels: not }), src);
  if (!r.values.destination) {
    const d = findLabel(form, "Destination");
    if (d) {
      const below = d.page.rows[d.page.rows.indexOf(d.row) + 1]?.cells.find((c) => /amaala/i.test(c.s));
      set(r, "destination", below?.s, src);
    }
  }
  set(r, "title", valueRight(form, "Title of this Variation"), src);
  set(r, "eac_included", valueRight(form, "Is this change included in the latest EAC"), src);
  set(r, "root_cause", valueRight(form, "Root Cause for this change"), src);
  set(r, "scope", valueBelow(form, "Scope of works / services (brief)", ["Contractual basis", "b) Estimated Cost", "a) Reason", "Root Cause", "Explain if"]), src);
  set(r, "reason", valueBelow(form, "a) Reason for Proposed Variation Order", ["Scope of works", "Contractual basis", "Root Cause", "Explain if", "b) Estimated"]), src);
  set(r, "contractual_basis", valueBelow(form, "Contractual basis for variation entitlement", ["b) Estimated Cost", "Basis of ROM", "Reference"]), src);
  const eac = valueBelow(form, "Explain if the topic was included within the EAC", ["Root Cause", "a) Reason", "Scope of works", "Contractual basis"]);
  set(r, "eac_explanation", eac.split("\n")[0], src);
  set(r, "original_contract", money(valueRight(form, "Original Contract Value")), src);
  set(r, "approved_dvos", money(valueRight(form, /^Approved DVOs$/)), src);
  set(r, "approved_pvos", money(valueRight(form, /^Approved PVOs$/)), src);
  set(r, "current_revised", money(valueRight(form, "Current Revised Contract Value")), src);
  set(r, "total_value", money(valueRight(form, "Total Value (in SAR)") || valueRight(form, "This Proposed Variation Order (PVO)")), src);
  set(r, "other_contracts", money(valueRight(form, "Sub-Total (SAR)")), src);
  set(r, "original_completion", dateOf(valueRight(form, "a) Original Contract Completion Date")), src);
  set(r, "approved_eot", (valueRight(form, "b) Approved EOTs (Days)") || "").replace(/\.00$/, ""), src);
  set(r, "current_completion", dateOf(valueRight(form, "c) Current Revised Completion Date")), src);
  set(r, "time_impact", (valueRight(form, "d) Estimated 'time impact' of this variation (Days)") || "").replace(/\.00$/, ""), src);
  set(r, "other_eots", (valueRight(form, "e) Other anticipated EOTs") || "").replace(/\.00$/, ""), src);
  set(r, "time_comments", valueBelow(form, "Comments", ["4. Time Impact", "Prepared", "a) Original"], 3), src);
  // the cost items of the previous PVO: one line per row of the item table
  const items = numericRowsAfter(form, /^Reference$/, "Sub-Total", 1, 12).filter((row) => row.some((c) => /[A-Za-z]{3}/.test(c) && !/^SAR$/i.test(c)));
  if (items.length) set(r, "cost_items", items.map((row, i) => {
    const nums = row.filter((c) => moneyOf(c) !== null);
    const desc = row.find((c) => /[A-Za-z]{3}/.test(c) && !/^SAR$/i.test(c)) ?? "";
    const add = nums.length ? money(nums[nums.length - 1]) : "";
    const omit = nums.length > 1 ? money(nums[0]) : "";
    return `${i + 1} – ${desc} – ${omit || "0"} – ${add || "0"}`;
  }).join("\n"), src);
  // b) package budget position: the row of the contract
  const pkg = numericRowsAfter(form, "b) Package Budget position", "c) Budget Transfer details", 5, 8)[0];
  if (pkg) {
    const nums = pkg.filter((c) => moneyOf(c) !== null || c === "-").map((c) => money(c));
    // A current approved budget, B approved contract, C approved DVOs, D approved PVOs, E remaining, F this PVO, E-F variance
    if (nums.length >= 6) {
      set(r, "approved_contract", nums[1], src);
      set(r, "approved_dvos", nums[2] || r.values.approved_dvos, src);
      set(r, "approved_pvos", nums[3] || r.values.approved_pvos, src);
      set(r, "remaining_budget", nums[4], src);
    }
  }
  // c) budget transfer details: From (hold) and To (this contract)
  const tr = numericRowsAfter(form, "c) Budget Transfer details", "Note: The approval", 2, 6);
  for (const row of tr) {
    const acct = row.find((c) => /^1TB\d{5}\.\d{2}\.[A-Z]{2}\./.test(c)) ?? "";
    const nums = row.filter((c) => moneyOf(c) !== null).map((c) => money(c));
    if (/^from$/i.test(row[0])) {
      set(r, "budget_line", acct, src);
      set(r, "budget_available", nums[0], src);
      set(r, "budget_source", "B) Budget Transfer Required", src);
    } else if (/^to$/i.test(row[0])) set(r, "budget_to_line", acct, src);
  }
  if (!r.values.budget_source) set(r, "budget_source", "A) No Additional Budget or Budget Transfer Required", src);
  if (!r.values.budget_line) {
    const m = eac.match(/(1TB\d{5}\.\d{2}\.[A-Z]{2}\.\S+)\s*=\s*([\d,]+\.\d{2})/);
    if (m) {
      set(r, "budget_line", m[1], src);
      set(r, "budget_available", money(m[2]), src);
    }
  }
  if (!r.values.budget_to_line && r.values.contract_no) set(r, "budget_to_line", `${r.values.contract_no}.00`, src);
  // d) the ACC table by category, kept as read
  const acc = numericRowsAfter(form, "d) Project / Asset Budget position", "Comments", 8, 14).filter((row) => /[A-Za-z]{3}/.test(row[0]));
  if (acc.length) set(r, "acc_table", JSON.stringify(acc.map((row) => [row[0], ...row.slice(1).filter((c) => moneyOf(c) !== null || c === "-").map((c) => money(c) || "0")])), src);
  // the signatories: everything under Prepared, Checked and Approved
  const prepared = peopleUnder(form, "Prepared/Initiated By", ["Checked by", "Approved by"], (s) => POSITION.test(s));
  const checked = peopleUnder(form, "Checked by (Pre-Approval)", ["Approved by"], (s) => POSITION.test(s));
  const approved = peopleUnder(form, /^Approved by/, [/^RSG-CM-FRM/, "Comments"], (s) => POSITION.test(s));
  if (prepared.length) {
    set(r, "prepared_by", lines(prepared), src);
    set(r, "prepared_position", positions(prepared), src);
  }
  if (checked.length) {
    set(r, "checked_by", lines(checked), src);
    set(r, "checked_position", positions(checked), src);
  }
  if (approved.length) {
    set(r, "approved_by", lines(approved), src);
    set(r, "approved_position", positions(approved), src);
  }
  // the VO form in the pack names the representatives
  const erep = peopleUnder(pages, /^Approved and Issued by/i, [/^Received by/i, /^RSG-CM-FRM/], (x) => POSITION.test(x))[0];
  if (erep) {
    set(r, "employer_rep", erep.name, src);
    set(r, "employer_rep_position", erep.position, src);
  }
  const crep = peopleUnder(pages, /^Received by \((Consultant\/)?Contractor'?s Representative\)/i, [/^Approved/i, /^RSG-CM-FRM/], (x) => POSITION.test(x))[0];
  if (crep) {
    set(r, "contractor_rep", crep.name, src);
    set(r, "contractor_rep_position", crep.position, src);
  }
  return r;
}

/* ------------------------------------------------------------------ */
/* the last approved DVO (RSG-CM-FRM-0014 / 0027)                      */

export function readReferenceDvo(pages: PosPage[]): Reading {
  const r: Reading = { values: {}, sources: {} };
  const src = "previous DVO";
  const form = pages.slice(0, Math.min(4, pages.length));
  set(r, "dvo_no", valueRight(form, "Variation Order No", { notLabels: ["Date"] }), src);
  set(r, "program_name", valueRight(form, "Program Name", { notLabels: ["Project Code"] }), src);
  set(r, "project_code", valueRight(form, "Project Code"), src);
  set(r, "project_name", valueRight(form, "Project Name", { notLabels: ["Contract Ref"] }), src);
  set(r, "contract_ref", valueRight(form, "Contract Ref"), src);
  set(r, "works_package", valueRight(form, /^Works Package$/, { notLabels: ["Contractor/Consultant"] }), src);
  set(r, "contractor", valueRight(form, "Contractor/Consultant"), src);
  set(r, "destination", valueRight(form, "Destination"), src);
  set(r, "contract_price", money(valueRight(form, "Contract Price [a]")), src);
  set(r, "commencement_date", dateOf(valueRight(form, "Contract Commencement Date")), src);
  set(r, "previous_dvos", money(valueRight(form, "Sum of Previous Determination of", { nextRow: true })), src);
  set(r, "interim_vos", money(valueRight(form, "account payments) [c]") || valueRight(form, "Sum of Interim Value Variations", { nextRow: true })), src);
  set(r, "dvo_value", money(valueRight(form, "This Variation Order [d]") || valueRight(form, /^Total Value$/)), src);
  set(r, "revised_contract", money(valueRight(form, "Revised Contract Price", { nextRow: true })), src);
  set(r, "vo_pct", valueRight(form, "VO's % Original Contract Price"), src);
  set(r, "original_completion", dateOf(valueRight(form, "Original Contract Completion Date [x]")), src);
  set(r, "previous_eot", (valueRight(form, "Previous Approved Extension of Time (Days) [y]") || "").replace(/\.00$/, ""), src);
  set(r, "this_eot", (valueRight(form, "This Agreed Extension of Time (Days) [z]") || "").replace(/\.00$/, ""), src);
  set(r, "total_eot", (valueRight(form, "Total Extension (Days Difference to the Original") || "").replace(/\.00$/, ""), src);
  set(r, "revised_completion", dateOf(valueRight(form, "Revised Contract Completion Date [x+y+z]") || valueRight(form, "Revised Contract Price")), src);
  set(r, "title", valueBelow(form, "Variation Order Title", ["Reason for Variation Order"], 2).replace(/^DVO[\s-]*\d+\s*-\s*/i, ""), src);
  set(r, "reason", valueBelow(form, "Reason for Variation Order", ["Instruction Reference", "Contract Reconciliation"], 6), src);
  const info = numericRowsAfter(form, "Document Ref. No", "Final Determination", 0, 6);
  void info;
  // the representatives
  for (const pg of form) {
    for (const row of pg.rows) {
      const cells = row.cells;
      if (cells.length >= 2 && /contractor'?s representative/i.test(cells[1].s) && /^[A-Za-z ]{4,40}$/.test(cells[0].s)) {
        set(r, "contractor_rep", cells[0].s.replace(/\b([A-Z])([A-Z]+)/g, (_m, a, b) => a + b.toLowerCase()), src);
        set(r, "contractor_rep_position", cells[1].s.replace(/\s*\(\s*/g, " (").replace(/\s+\)/g, ")"), src);
      }
      if (cells.length >= 2 && /employer'?s representative/i.test(cells[1].s) && /^[A-Za-z ]{4,40}$/.test(cells[0].s)) {
        set(r, "employer_rep", cells[0].s.replace(/\b([A-Z])([A-Z]+)/g, (_m, a, b) => a + b.toLowerCase()), src);
        set(r, "employer_rep_position", cells[1].s.replace(/\s*\(\s*/g, " (").replace(/\s+\)/g, ")"), src);
      }
    }
  }
  // the review panel on the 0027 form
  const panel: string[] = [];
  for (const pg of form) for (const row of pg.rows) {
    const c = row.cells;
    if (c.length >= 2 && /^Employer'?s /i.test(c[1].s) && POSITION.test(c[1].s) && /^[A-Za-z ]{4,40}$/.test(c[0].s)) panel.push(`${c[1].s} – ${c[0].s}`);
    else if (c.length >= 2 && /^Employer'?s /i.test(c[0].s) && POSITION.test(c[0].s) && /^[A-Za-z ]{4,40}$/.test(c[1].s)) panel.push(`${c[0].s} – ${c[1].s}`);
  }
  if (panel.length) set(r, "review_panel", [...new Set(panel)].join("\n"), src);
  // the budget particulars annexure
  const bp = valueRight(pages, "SOURCE OF THE BUDGET");
  if (bp) {
    const m = bp.match(/(1TB\d{5}\.\d{2}\.[A-Z]{2}\.\S+)\s*:?\s*SAR\s*([\d,]+\.\d{2})/);
    if (m) {
      set(r, "budget_line", m[1], src);
      set(r, "budget_available", money(m[2]), src);
    }
  }
  const bd = valueRight(pages, "DESTINATION OF THE BUDGET");
  if (bd) set(r, "budget_to_line", bd.match(/1TB\d{5}\.\d{2}\.[A-Z]{2}\.\S+/)?.[0] ?? "", src);
  return r;
}

/* ------------------------------------------------------------------ */
/* the last approved RFA (RSG-PR-FRM-0004)                             */

export function readReferenceRfa(pages: PosPage[]): Reading {
  const r: Reading = { values: {}, sources: {} };
  const src = "previous RFA";
  set(r, "contact", valueRight(pages, "Contact Information") || valueBelow(pages, "Contact Information", ["RFA Form Reference"], 1), src);
  set(r, "requesting_department", valueRight(pages, "Requesting Department"), src);
  const fund = [valueRight(pages, "Project Budget / Funding Source"), valueBelow(pages, "Project Budget / Funding Source", ["Budget Remaining"], 3)].find((x) => x.length > 8) ?? "";
  set(r, "funding_source", fund.replace(/\n/g, " "), src);
  set(r, "preferred_tenderer", valueRight(pages, "Preferred Tenderer"), src);
  set(r, "contract_price", valueRight(pages, "Contract Price"), src);
  const people: string[] = [];
  let exec = false;
  for (const pg of pages) {
    const start = pg.rows.findIndex((row) => row.cells.some((c) => /^Recommended for Approval$/i.test(c.s)));
    if (start < 0) continue;
    let pendingFn = "";
    for (let i = start + 1; i < pg.rows.length; i++) {
      const cells = pg.rows[i].cells.filter((c) => !/^(function|name|signature|date|sign)$/i.test(c.s) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(c.s));
      if (!cells.length) continue;
      if (/^Executive Approval$/i.test(cells[0].s)) {
        exec = true;
        continue;
      }
      if (exec) {
        if (cells.length >= 2) {
          set(r, "executive_approver", cells[0].s, src);
          set(r, "executive_position", cells[1].s, src);
        } else if (!r.values.executive_approver) set(r, "executive_approver", cells[0].s, src);
        else set(r, "executive_position", cells[0].s, src);
        if (r.values.executive_approver && r.values.executive_position) break;
        continue;
      }
      const isPerson = (x: string) => /^(Mr\.?\s+|Ms\.?\s+|Dr\.?\s+)?[A-Z][a-z'’.-]+(\s+[A-Z][A-Za-z'’.-]+){1,3}$/.test(x) && !POSITION.test(x);
      if (cells.length >= 2 && isPerson(cells[cells.length - 1].s)) {
        const fn = cells.slice(0, -1).map((c) => c.s).join(" ");
        people.push(`${pendingFn ? `${pendingFn} ` : ""}${fn} – ${cells[cells.length - 1].s}`);
        pendingFn = "";
      } else if (isPerson(cells[0].s) && pendingFn) {
        people.push(`${pendingFn} – ${cells[0].s}`);
        pendingFn = "";
      } else pendingFn = pendingFn ? `${pendingFn} ${cells.map((c) => c.s).join(" ")}` : cells.map((c) => c.s).join(" ");
    }
    break;
  }
  // a function that wrapped onto the row after its name ("… – Destination" / "Development Rosanna Chopra") is put back together
  for (let i = 1; i < people.length; i++) {
    const m = people[i].match(/^((?!Executive|Senior|Head|Group|Chief|Director|Associate|Manager|Deputy|General)[A-Z][a-z]+)\s+((?:Executive|Senior|Head|Group|Chief|Director|Associate|Manager)\b.*)$/);
    if (m && /[–-]\s*[A-Za-z]+$/.test(people[i - 1].split(" – ")[0])) {
      const [fn, name] = [people[i - 1].slice(0, people[i - 1].lastIndexOf(" – ")), people[i - 1].slice(people[i - 1].lastIndexOf(" – ") + 3)];
      people[i - 1] = `${fn} ${m[1]} – ${name}`;
      people[i] = m[2];
    }
  }
  if (people.length) set(r, "recommended_by", people.join("\n"), src);
  return r;
}

/* ------------------------------------------------------------------ */
/* the last approved EAR (the issued report)                            */

export function readReferenceEar(pages: PosPage[]): Reading {
  const r: Reading = { values: {}, sources: {} };
  const src = "previous EAR";
  set(r, "template_rev", pages.flatMap((p) => p.rows).flatMap((row) => row.cells).find((c) => /^Template Revision/i.test(c.s))?.s, src);
  const hist = pages.slice(0, 4).find((p) => p.rows.some((row) => row.cells.some((c) => /^Revision History$/i.test(c.s))));
  if (hist) {
    const people = peopleWithHeadings(hist, /^(Prepared|Reviewed|Checked|Approved) by:?$/i, (s) => POSITION.test(s));
    if (people.length) {
      set(r, "revision_history", people.map((p) => `${p.heading} – ${p.name} – ${p.position}`).join("\n"), src);
      const by = (h: RegExp) => people.filter((p) => h.test(p.heading));
      const prep = by(/prepared/i);
      const rev = by(/reviewed|checked/i);
      const app = by(/approved/i);
      if (prep.length) {
        set(r, "prepared_by", prep.map((p) => p.name).join("\n"), src);
        set(r, "prepared_position", prep.map((p) => p.position).join("\n"), src);
      }
      if (rev.length) {
        set(r, "checked_by", rev.map((p) => p.name).join("\n"), src);
        set(r, "checked_position", rev.map((p) => p.position).join("\n"), src);
      }
      if (app.length) {
        set(r, "approved_by", app.map((p) => p.name).join("\n"), src);
        set(r, "approved_position", app.map((p) => p.position).join("\n"), src);
      }
    }
  }
  const cover = pages[0];
  if (cover) {
    const t = cover.rows.map((row) => row.cells.map((c) => c.s).join(" ")).join("\n");
    const m = t.match(/Contract No\.? & Title:?\s*([^\n]+?)\s*-\s*([\s\S]+?)(?=\n\s*Contractor:|\n\s*Date:|$)/i);
    if (m) {
      set(r, "contract_no", m[1].trim(), src);
      set(r, "contract_title", m[2].replace(/\s*\n\s*/g, " ").trim(), src);
    }
    const c = t.match(/Contractor:?\s*\n?([^\n]+)/i);
    if (c) set(r, "contractor", c[1].trim(), src);
  }
  const sig = pages.flatMap((p) => p.rows).find((row) => row.cells.some((c) => /Employer'?s Representative/i.test(c.s) && /\(/.test(c.s)));
  if (sig) set(r, "signatory", sig.cells.map((c) => c.s).join(" "), src);
  return r;
}

/* ------------------------------------------------------------------ */
/* the RFC and the cost assessment                                     */

const RFC_STOPS = [/^(reason|scope|justification|contractual basis|estimated|cost|time impact|budget|root cause|prepared|checked|approved|attachments?|general information|particulars|description|title)/i, /^\d\)\s/, /^[a-e]\)\s/];

/** The RFC: the change's title, scope, reason, contractual basis and root cause, from whichever RSG headings the form uses. */
export function readRfc(pages: PosPage[]): Reading {
  const r: Reading = { values: {}, sources: {} };
  const src = "RFC";
  const flat = pages.flatMap((p) => p.rows.map((row) => row.cells.map((c) => c.s).join(" ")));
  const ref = flat.map((l) => l.match(/\b(1TB\d{5}-\d{3}[A-Z]\d{2}-AMA-(?:RFC|CRF|VOR|EMI|EI)-[A-Z]{2}-\d{4})\b/)?.[1]).find(Boolean);
  set(r, "rfc_ref", ref ?? valueRight(pages, /^(RFC|CRF) (No|Reference|Ref)\.?:?$/i), src);
  set(r, "title", valueRight(pages, /^(Title( of (this|the) (change|variation|request))?|Subject|Change Title|RFC Title):?$/i) || valueBelow(pages, /^(Title( of (this|the) (change|variation|request))?|Subject|Change Title):?$/i, RFC_STOPS, 2), src);
  set(r, "scope", valueBelow(pages, /^(Scope of (works?|services|(the )?change)( \/ services)?( \(brief\))?|Description of (the )?(change|works?)|Proposed (change|scope)|Scope):?$/i, RFC_STOPS, 25), src);
  set(r, "reason", valueBelow(pages, /^(Reason(s)? for (the )?(change|request|variation|proposed variation order)|Reason|Justification( for (the )?change)?|Purpose):?$/i, RFC_STOPS, 25), src);
  set(r, "contractual_basis", valueBelow(pages, /^(Contractual basis( for (variation )?entitlement)?|Contract basis|Basis of entitlement):?$/i, RFC_STOPS, 4), src);
  set(r, "root_cause", valueRight(pages, /^Root Cause( for this change)?:?$/i), src);
  set(r, "initiated_by", valueRight(pages, /^(Initiated by|Change Initiator|Requested by):?$/i), src);
  const rom = valueRight(pages, /^(Estimated cost( impact)?( \(ROM\))?|ROM( estimate)?|Cost impact):?$/i);
  if (money(rom)) set(r, "rom_estimate", money(rom), src);
  const ti = valueRight(pages, /^(Time impact( \(days\))?|Estimated time impact):?$/i);
  if (/^\d+/.test(ti)) set(r, "time_impact", ti.replace(/\D.*$/, ""), src);
  return r;
}

/** The cost assessment: the last "total" row's amount is the value; a bracketed total is an omission. */
export function readCost(pages: PosPage[], title: string): Reading {
  const r: Reading = { values: {}, sources: {} };
  const src = "cost assessment";
  let bestN: number | null = null;
  let bestGrand = false;
  for (const pg of pages) for (const row of pg.rows) {
    const text = row.cells.map((c) => c.s).join(" ");
    if (!/\btotal\b/i.test(text)) continue;
    const nums = row.cells.map((c) => moneyOf(c.s)).filter((n): n is number => n !== null && Math.abs(n) >= 1);
    if (!nums.length) continue;
    const n = nums[nums.length - 1];
    const grand = /grand total|total value|total in sar|total \(sar\)|total for/i.test(text) && !/for one/i.test(text);
    if (bestN === null || grand || (!bestGrand && Math.abs(n) >= Math.abs(bestN))) {
      bestN = n;
      bestGrand = bestGrand || grand;
    }
  }
  if (bestN === null) return r;
  const total = Math.round(bestN * 100) / 100;
  set(r, "total_value", String(Math.abs(total)), src);
  set(r, "dvo_value", String(Math.abs(total)), src);
  set(r, "amount", String(Math.abs(total)), src);
  set(r, "rom_estimate", String(Math.abs(total)), src);
  if (total < 0) set(r, "omit", String(Math.abs(total)), src);
  else set(r, "add", String(total), src);
  set(r, "cost_items", `1 – ${title || "As per the attached cost assessment"} – ${total < 0 ? Math.abs(total) : 0} – ${total < 0 ? 0 : total}`, src);
  const subject = valueRight(pages, /^Subject:?$/i);
  if (subject) set(r, "cost_subject", subject, src);
  return r;
}

/** The approved PVO behind a DVO: its number, value and title. */
export function readApprovedPvoForDvo(pages: PosPage[]): Reading {
  const r = readReferencePvo(pages);
  const out: Reading = { values: {}, sources: {} };
  const src = "approved PVO";
  set(out, "vo_no", r.values.pvo_no ? `VO-${r.values.pvo_no.replace(/\D/g, "").padStart(3, "0")}` : "", src);
  set(out, "pvo_value", r.values.total_value, src);
  set(out, "title", r.values.title, src);
  set(out, "reason", r.values.scope, src);
  for (const k of ["program_name", "project_name", "project_code", "works_package", "contractor", "contract_no", "budget_line", "budget_available", "budget_to_line", "acc_table"]) if (r.values[k]) set(out, k, r.values[k], src);
  set(out, "instruction_ref", r.values.rfc_ref, src);
  return out;
}
