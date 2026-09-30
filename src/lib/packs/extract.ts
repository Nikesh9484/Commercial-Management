import { fieldForLabel, normLabel, type PackType, type PackValues } from "./shared";

/**
 * What the dashboard reads out of the files uploaded into a pack – without any AI: the last
 * approved pack of the same kind (its form values, wording and signatories), the RFC (the scope and
 * reason of the change) and the cost proposal (its total). Every value read this way only fills a
 * field that is still blank, and stays editable on the pack.
 */

/** The text of a PDF, page by page, with the lines kept in reading order. */
export async function extractPdfText(bytes: Buffer): Promise<string[]> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const r = await parser.getText();
      const pages: string[] = [];
      for (let i = 1; i <= (r.total ?? 0); i++) pages.push(r.getPageText(i));
      return pages;
    } finally {
      await parser.destroy?.();
    }
  } catch {
    return [];
  }
}

const lines = (text: string) => text.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

/** Is this line a value rather than another label? (labels end with ":" or are short title-case words the form uses) */
function looksLikeValue(l: string, type: PackType): boolean {
  if (!l || /:$/.test(l)) return false;
  if (/^(name|position|signature|date|sign|page \d|-|–|—|…\.*|\.{3,})$/i.test(l)) return false;
  return !fieldForLabel(type, l);
}

/** A value read from a form is taken only when it looks like what the field holds – the text of an RSG form PDF comes out in a jumbled order. */
const VALID: Record<string, RegExp> = {
  destination: /^AMAALA( Destination)?$/i,
  program_name: /^Program \d{1,2} ?- ?[A-Za-z][A-Za-z ]{2,40}$/,
  program_no: /^\d{1,2}$/,
  project_name: /^(?!(Code|Name|Date|Title|Description|Reference|Program|Project)$)[A-Z][A-Za-z&' ]{3,60}$/,
  project_code: /^[A-Z]\d{2}$|^1TB\d{5}(\.\d{2})?$/,
  development_name: /^[A-Z][A-Za-z ]{2,30}$/,
  development_no: /^[A-Z]{1,4}$/,
  contract_no: /^(1TB\d{5}(\.\d{2}\.[A-Z]{2}\.)?|TB01|1TB01)[-.]?\d{3}[A-Z]\d{2}(-\d{4})?$/,
  contract_ref: /^(1TB\d{5}|TB01|1TB01)[-.]?\d{3}[A-Z]\d{2}(-\d{4})?$/,
  ewbs_code: /^[A-Z]\.TB\.\d{2}\.[A-Z]\d{2}( \(.*\))?$|^[A-Z]{2}\.\d{3}[A-Z]\d{2}(\.\d{2})?$/,
  works_package: /^[A-Z][A-Za-z0-9&,'/ -]{8,120}$/,
  contractor: /^[A-Z][A-Za-z0-9&.,' -]{4,80}(LLC|Ltd|Co\.?|Company|Limited|Inc\.?|Contracting|Engineering|Industries|Group|Consultants?|Services)\.?$/i,
  requesting_department: /^[A-Z][A-Za-z ]{3,40}$/,
  rom_basis: /^(Existing Contract BoQ rates|New Rates|Mix of both)$/i,
  budget_source: /^[ABC]\)/,
  root_cause: /^[A-Z][A-Za-z ]+ [–-] [A-Za-z ]+( [–-] [A-Za-z /]+)?$/,
  eac_included: /^(Yes|No)$/i,
  clauses: /clause/i,
  determination_clause: /clause/i,
  template_rev: /^Template Revision/i,
  contractor_address: /\d/,
};

/**
 * The values of the last approved pack: for every field, the line that follows its label on the
 * form ("Program Name:" → "Program 01 - Marina Village"), kept only when it reads as that field
 * does. Values that name the earlier pack itself (its number, date, title, amounts) are never
 * taken – only the pattern is: the project's particulars, the standard wording and the signatories.
 */
export function valuesFromReference(pages: string[], type: PackType): PackValues {
  const out: PackValues = {};
  const all = pages.flatMap(lines);
  for (let i = 0; i < all.length; i++) {
    const f = fieldForLabel(type, all[i]);
    if (!f || !VALID[f.key] || out[f.key]) continue;
    const same = all[i].match(/^[^:]{2,60}:\s*(.+)$/);
    const candidates = [same?.[1] ?? "", all[i + 1] ?? ""].map((x) => x.trim()).filter(Boolean);
    const v = candidates.find((c) => looksLikeValue(c, type) && c.length <= 160 && VALID[f.key].test(c));
    if (v) out[f.key] = v;
  }
  // the RSG PVO / DVO forms come out of a PDF in a jumbled order, so only their representatives are
  // taken from the signature area; the reports and the RFA list their signatories in reading order
  const sig = signatories(all);
  if (type.key === "pvo" || type.key === "dvo" || type.key === "vo" || type.key === "rfc") for (const k of ["prepared_by", "prepared_position", "checked_by", "checked_position", "approved_by", "approved_position"]) delete sig[k];
  if (type.key === "rfa" && sig.approved_by) {
    sig.executive_approver = sig.approved_by;
    sig.executive_position = sig.approved_position;
    delete sig.approved_by;
    delete sig.approved_position;
  }
  Object.assign(out, sig);
  const basis = all.find((l) => /^pursuant to (contract )?(sub-)?clause/i.test(l) && l.length < 240);
  if (basis && type.fields.some((f) => f.key === "contractual_basis")) out.contractual_basis = basis;
  if (type.fields.some((f) => f.key === "revision_history")) {
    const hist = revisionHistory(all);
    if (hist) out.revision_history = hist;
  }
  if (type.fields.some((f) => f.key === "review_panel")) {
    const panel = reviewPanel(all);
    if (panel) out.review_panel = panel;
  }
  if (type.fields.some((f) => f.key === "recommended_by")) {
    const rec = recommendedBy(all);
    if (rec) out.recommended_by = rec;
  }
  return out;
}

const POSITION = /(director|manager|head of|officer|specialist|engineer|chairman|representative|lead|executive|associate|senior|group|planner|analyst|surveyor|controller|chief|ceo|cfo|coo)/i;

const NAME_WORD = "(?:Mr\\.?|Ms\\.?|Mrs\\.?|Dr\\.?|Al|El|De|Van|Von|Bin|Abdul|(?![A-Z]{2,}(?:\\s|$))[A-Z][A-Za-z'’.-]+)";
const PERSON = new RegExp(`^${NAME_WORD}(?:\\s+${NAME_WORD}){1,3}$`);
const POSITION_START = /^(Sr\.?|Senior|Head|Group|Associate|Executive|Chief|Director|Manager|Specialist|Chairman|Lead|Planning|Commercial|Project|Programme|Program|Junior|Principal|Assistant|General|Employer'?s|Contractor'?s|Deputy|Vice|President|Partner|Consultant|Engineer|Quantity|Cost|Contracts?|Claims?|Legal|Finance|Financial|Technical|Design|Construction|Development|Operations?|Aviation|Site|Resident)\b/i;

/** Two to four title-case words ("Stuart Prosser", "Fahad AlBalawi", "Tareq El Emam") – not a form label, not all capitals. */
const isPersonName = (l: string) => PERSON.test(l) && !POSITION.test(l) && !/\b(Destination|Amaala|Contract|Project|Program|Budget|Total|Value|Name|Position|Signature|Date|Section|Description|Reference|Document|Title|Revision|Marina|Village|Triple|Bay|Island|Jetty|Boardwalk|Hotel|Note|Form|Order|Variation|Approval|Function|Details)\b/i.test(l);

/**
 * "Rufino Bautista Sr. Commercial Manager" → name and position (the shortest name followed by a
 * position word); "Blake Lombard" + next line "Associate Director - Commercial" likewise. A position
 * that wraps onto the following line ("… Head of Cost, Commercial &" / "Procurement") is joined.
 */
function namePosition(line: string, next: string): { name: string; position: string } | null {
  const clean = (x: string) => x.replace(/\s*(Name|Position|Signature|Date)(\s|$).*$/i, "").trim();
  const cont = (pos: string) => (/[&\/,'’-]$|'s$|\bof$|\band$/.test(pos) || (next && next.split(/\s+/).length <= 3 && !/[:\d]/.test(next) && !isPersonName(next) && !/^(prepared|reviewed|checked|approved|recommended|executive)/i.test(next) && /^[A-Z(]/.test(next)) ? `${pos} ${next}`.trim() : pos);
  const words = line.trim().split(/\s+/);
  for (let n = 2; n <= Math.min(4, words.length - 1); n++) {
    const name = words.slice(0, n).join(" ");
    const rest = words.slice(n).join(" ");
    if (isPersonName(name) && POSITION_START.test(rest) && POSITION.test(rest)) return { name, position: clean(cont(rest)) };
  }
  if (isPersonName(line.trim()) && next && POSITION.test(next) && next.length < 90) return { name: line.trim(), position: clean(next) };
  return null;
}

/** "Executive Director - Development Bradley Vercoe" → the position and the name that ends the line. */
function positionName(line: string): { position: string; name: string } | null {
  const words = line.trim().split(/\s+/);
  for (let n = 2; n <= Math.min(4, words.length - 1); n++) {
    const name = words.slice(words.length - n).join(" ");
    const pos = words.slice(0, words.length - n).join(" ");
    if (isPersonName(name) && POSITION.test(pos)) return { position: pos.replace(/[\s–-]+$/, ""), name };
  }
  return null;
}

/** The pairs of name and position that follow "Prepared", "Checked / Reviewed" and "Approved" (or the executive approval of an RFA). */
function signatories(all: string[]): PackValues {
  const out: PackValues = {};
  const heads: [RegExp, string, string][] = [
    [/^prepared\s*\/?\s*(initiated)?\s*by/i, "prepared_by", "prepared_position"],
    [/^checked by|^reviewed by/i, "checked_by", "checked_position"],
    [/^approved by|^approved and issued by|^executive approval|^final determination by the employer/i, "approved_by", "approved_position"],
  ];
  for (let i = 0; i < all.length; i++) {
    for (const [re, nameKey, posKey] of heads) {
      if (!re.test(all[i]) || out[nameKey]) continue;
      for (let j = i + 1; j < Math.min(all.length, i + 6); j++) {
        if (/^note/i.test(all[j])) continue;
        const np = namePosition(all[j], all[j + 1] ?? "");
        if (np && isPersonName(np.name)) {
          out[nameKey] = np.name;
          out[posKey] = np.position;
          break;
        }
      }
    }
  }
  // the representatives on a DVO
  const titleCase = (x: string) => x.replace(/\S+/g, (w) => (w === w.toUpperCase() && w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w));
  const rep = all.findIndex((l) => /contractor'?s representative\)?$/i.test(l) && /chairman|director|manager|general|representative/i.test(l));
  if (rep > 0) {
    const prev = titleCase(all[rep - 1]);
    const np = namePosition(prev, all[rep]) ?? (isPersonName(prev) ? { name: prev, position: all[rep] } : null);
    if (np && isPersonName(np.name)) {
      out.contractor_rep = np.name;
      out.contractor_rep_position = np.position;
    }
  }
  const emp = all.findIndex((l) => /employer'?s representative\)?$/i.test(l) && /head of|director/i.test(l));
  if (emp > 0) {
    const prev = titleCase(all[emp - 1]);
    const np = namePosition(prev, all[emp]) ?? (isPersonName(prev) ? { name: prev, position: all[emp] } : null);
    if (np && isPersonName(np.name)) {
      out.employer_rep = np.name;
      out.employer_rep_position = np.position;
    }
  }
  return out;
}

/** The revision history of an EAR: every name / position under "Prepared by:", "Reviewed by:" and "Approved by:" until the table of contents. */
function revisionHistory(all: string[]): string {
  const start = all.findIndex((l) => /^revision history$/i.test(l));
  if (start < 0) return "";
  const end = all.findIndex((l, i) => i > start && /^table of contents$/i.test(l));
  const block = all.slice(start + 1, end > 0 ? end : start + 80);
  const rows: string[] = [];
  let role = "";
  for (let i = 0; i < block.length; i++) {
    const l = block[i];
    const r = l.match(/^(prepared by|reviewed by|checked by|approved by):?$/i);
    if (r) {
      role = r[1].replace(/\b\w/g, (c) => c.toUpperCase());
      continue;
    }
    if (!role) continue;
    const np = namePosition(l, block[i + 1] ?? "");
    if (np && isPersonName(np.name) && !rows.some((x) => x.includes(`– ${np.name} –`))) {
      rows.push(`${role} – ${np.name} – ${np.position}`);
      if (np.position.endsWith(block[i + 1] ?? "\u0000")) i++;
    }
  }
  return rows.join("\n");
}

/** The review and recommendation panel of a DVO: "Employer's Planning Director" … with the names beside them. */
function reviewPanel(all: string[]): string {
  const rows: string[] = [];
  const positions = all.map((l, i) => [l, i] as const).filter(([l]) => /^employer'?s (associate |senior |planning |projects? )?(director|manager|head)/i.test(l) && l.length < 70);
  for (const [pos, i] of positions) {
    const near = all.slice(Math.max(0, i - 4), i + 5).find((l) => isPersonName(l));
    rows.push(`${pos} – ${near ?? ""}`);
  }
  return [...new Set(rows)].join("\n");
}

/** The "Recommended for Approval" list of an RFA: the function and the name that ends its line, wrapped functions joined. */
function recommendedBy(all: string[]): string {
  const start = all.findIndex((l) => /^recommended for approval$/i.test(l));
  if (start < 0) return "";
  const rows: string[] = [];
  let fn: string[] = [];
  for (let i = start + 1; i < Math.min(all.length, start + 80); i++) {
    const l = all[i];
    if (/^executive approval/i.test(l) || /^sign$/i.test(l)) break;
    if (/^(function|name|signature|date)(\s+(name|signature|date))*$/i.test(l)) continue;
    const pn = positionName(l);
    if (pn) {
      rows.push(`${[...fn, pn.position].join(" ")} – ${pn.name}`);
      fn = [];
    } else if (isPersonName(l)) {
      if (fn.length) rows.push(`${fn.join(" ")} – ${l}`);
      fn = [];
    } else if (l.length < 60 && !/\d{2}\/\d{2}/.test(l)) fn.push(l);
  }
  return rows.join("\n");
}

/** The paragraph under a heading of the RFC ("Scope of works", "Reason", "Justification") up to the next heading. */
function sectionAfter(all: string[], heads: RegExp, stop: RegExp, max = 12): string {
  const i = all.findIndex((l) => heads.test(l));
  if (i < 0) return "";
  const same = all[i].replace(heads, "").replace(/^[:\s-]+/, "").trim();
  const body: string[] = same ? [same] : [];
  for (let j = i + 1; j < Math.min(all.length, i + 1 + max); j++) {
    const l = all[j];
    if (stop.test(l) || /:$/.test(l)) break;
    if (/^page \d+ of \d+$/i.test(l) || /^rsg-|^trs-|^#classification/i.test(l)) continue;
    body.push(l);
  }
  return body.join("\n").trim();
}

const RFC_STOP = /^(reason|scope|justification|contractual basis|estimated|cost|time impact|budget|root cause|prepared|checked|approved|attachments?|\d\)|[a-e]\)|general information|particulars)/i;

/** The scope, reason and contractual basis as the RFC states them – they are written into the PVO. */
export function valuesFromRfc(pages: string[]): PackValues {
  const all = pages.flatMap(lines);
  const out: PackValues = {};
  const scope = sectionAfter(all, /^(scope of (works?|services|change)|description of (the )?change|proposed change|scope)\b/i, RFC_STOP);
  const reason = sectionAfter(all, /^(reason for (the )?(change|request|variation)|reason|justification for (the )?change|justification)\b/i, RFC_STOP);
  const basis = sectionAfter(all, /^(contractual basis( for (variation )?entitlement)?|contract basis)\b/i, RFC_STOP, 4);
  const root = all.find((l) => /^root cause/i.test(l));
  const good = (t: string) => t.length >= 25 && /[a-z]{3}/i.test(t) && !/^[\/:.,\-–]/.test(t);
  if (good(scope)) out.scope = scope;
  if (good(reason)) out.reason = reason;
  if (good(basis)) out.contractual_basis = basis;
  if (root) {
    const v = root.replace(/^root cause( for this change)?:?\s*/i, "").trim();
    const next = all[all.indexOf(root) + 1] ?? "";
    const rc = v || (/–|-/.test(next) && next.length < 80 ? next : "");
    if (rc && /^[A-Z][A-Za-z ]+ [–-] /.test(rc)) out.root_cause = rc;
  }
  const rfcRef = all.map((l) => l.match(/\b(1TB\d{5}-\d{3}[A-Z]\d{2}-AMA-(?:RFC|CRF|VOR|EMI)-[A-Z]{2}-\d{4})\b/)?.[1]).find(Boolean);
  if (rfcRef) out.rfc_ref = rfcRef;
  return out;
}

/** The total of a cost proposal: the amount on the last "Total" line (grand total, total value, total in SAR). */
export function totalFromCost(pages: string[]): string | null {
  const all = pages.flatMap(lines);
  const money = /\(?-?\d{1,3}(?:,\d{3})+(?:\.\d{2})?\)?|\(?-?\d+\.\d{2}\)?/g;
  let best: number | null = null;
  for (const l of all) {
    if (!/\b(grand total|total value|total \(sar\)|total in sar|sub-?total|total)\b/i.test(l)) continue;
    const nums = (l.match(money) ?? []).map((m) => {
      const neg = /^\(|-/.test(m);
      const n = Number(m.replace(/[(),\s-]/g, ""));
      return neg ? -n : n;
    }).filter((n) => Number.isFinite(n) && Math.abs(n) >= 1);
    if (!nums.length) continue;
    const grand = /grand total|total value|total in sar|total \(sar\)/i.test(l);
    const n = nums[nums.length - 1];
    if (best === null || grand || Math.abs(n) > Math.abs(best)) best = n;
  }
  return best === null ? null : String(Math.round(best * 100) / 100);
}

/** Only fields still blank take a read value; returns the keys that were filled. */
export function mergeBlank(current: PackValues, read: PackValues, type: PackType): { values: PackValues; filled: string[] } {
  const known = new Set(type.fields.map((f) => f.key));
  const values = { ...current };
  const filled: string[] = [];
  for (const [k, v] of Object.entries(read)) {
    if (!known.has(k) || !v || String(current[k] ?? "").trim()) continue;
    values[k] = String(v).slice(0, 4000);
    filled.push(k);
  }
  return { values, filled };
}

export { normLabel };
