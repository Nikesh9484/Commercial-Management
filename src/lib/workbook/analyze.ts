import { cellText, type SheetValues } from "./read";
import { allRegisters } from "../registers";
import type { FieldDef, RegisterDef } from "../registers/types";
import { getDb, getSetting } from "../db";

/** Registers a workbook sheet may be mapped to (in report order). */
export const IMPORTABLE: { key: string; label: string }[] = [
  { key: "cost_lines", label: "Cost Report – Level 2 lines (Schedule B)" },
  { key: "changes", label: "Change Management Tracker (Schedule C / EI / DVO)" },
  { key: "claims", label: "Claims & Disputes (Schedule E)" },
  { key: "early_warnings", label: "Early Warnings" },
  { key: "risks", label: "Risks & Opportunities" },
  { key: "provisional_sums", label: "Provisional Sums" },
  { key: "bonds", label: "Bonds & Insurance" },
  { key: "contracts", label: "Contracts – Payment Summary" },
  { key: "payment_applications", label: "IPC Log (payment applications)" },
  { key: "budget_transfers", label: "Budget Transfers" },
  { key: "project_team", label: "Distribution & Project Team" },
  { key: "actions", label: "Meeting items & actions" },
];

/** Extra words your workbook may use for a field (normalised: lowercase, letters and digits only). */
const SYNONYMS: Record<string, Record<string, string[]>> = {
  cost_lines: {
    code: ["costcode", "cbs", "wbs", "budgetcode", "acode", "code"],
    package_id: ["package", "bpackage", "workpackage", "contract"],
    name: ["name", "cname", "descriptionofworks", "description", "scope", "title"],
    contractor_id: ["contractor", "dcontractor", "contractorsubcontractor", "subcontractor", "consultant", "supplier", "vendor"],
    approved_baseline_budget: ["approvedbaselinebudget", "baselinebudget", "approvedbudget", "originalbudget", "budget", "e"],
    opening_transfers: ["budgettransfersbroughtforward", "budgettransfers", "transfers", "f"],
    section: ["section", "status", "committeduncommitted", "type"],
    asset_id: ["asset", "assetcode", "project"],
  },
  changes: {
    item_no: ["itemno", "item", "no", "ref", "changeno", "srno", "sn"],
    description: ["description", "descriptionofchange", "title", "subject"],
    asset_id: ["projectasset", "asset", "project", "assetcode"],
    package_id: ["package"],
    contractor_id: ["contractorconsultant", "contractor", "consultant"],
    project_stage_id: ["projectstage", "stage"],
    change_category_id: ["changecategory", "category"],
    initiated_by_id: ["initiatedby", "initiator", "raisedby"],
    amaala_rep: ["amaalarep", "amaalarepresentative", "rep"],
    action_pending_by: ["actionpendingby", "actionby", "ballincourt", "pendingwith"],
    overall_status_id: ["overallstatus", "status"],
    date_raised: ["dateraised", "raiseddate", "date"],
    rfc_ref: ["rfcref", "rfcno", "rfc", "rfcreference"],
    rfc_date: ["rfcdate"],
    rfc_status_id: ["rfcstatus"],
    rfc_cr_amount: ["rfcamount", "rfcvalue", "rfccostreport", "rfccostreportamount"],
    pvo_ref: ["pvoref", "pvono", "pvo"],
    pvo_date: ["pvodate"],
    pvo_status_id: ["pvostatus"],
    pvo_cr_amount: ["pvoamount", "pvovalue", "pvocostreport"],
    vo_ref: ["voref", "vono", "vo"],
    vo_date: ["vodate"],
    vo_status_id: ["vostatus"],
    vo_cr_amount: ["voamount", "vovalue"],
    ei_ref: ["eiref", "eino", "ei", "engineersinstruction"],
    ei_date: ["eidate"],
    ei_status_id: ["eistatus"],
    dvo_ref: ["dvoref", "dvono", "dvo"],
    dvo_date: ["dvodate"],
    dvo_status_id: ["dvostatus"],
    dvo_cr_amount: ["dvoamount", "dvovalue", "determinedvalue"],
    dvo_avi_ref: ["avidvoref", "aviref", "avi"],
    dvo_deadline: ["deadlinetoclose", "deadline"],
    dvo_closed: ["closed", "closedyesno"],
    ew_ref: ["ewref", "ewno", "earlywarning", "earlywarningref"],
    ew_date: ["ewdate", "earlywarningdate"],
    cost_line_id: ["costreportline", "costline", "costcode", "cbs", "wbs", "budgetline", "budgetcode"],
  },
  claims: {
    claim_no: ["claimno", "claim", "no", "ref", "srno"],
    description: ["description", "claimdescription", "title", "subject"],
    contract_no: ["contractno", "contract"],
    asset_id: ["assetcode", "asset"],
    project: ["project", "projectname"],
    scope: ["scope", "scopeofwork"],
    contractor_id: ["contractorconsultant", "contractor", "consultant", "claimant"],
    status: ["status", "claimstatus"],
    notice_aware_date: ["adatecontractorbecameaware", "datecontractorbecameaware", "dateaware", "awarenessdate", "a"],
    notice_letter_ref: ["noticeletterref", "noticeref", "notice"],
    notice_received_date: ["bdatereceivedbyrsg", "datereceivedbyrsg", "noticereceived", "b"],
    notice_response_ref: ["engineeremployerresponseref", "responseref"],
    notice_response_date: ["responsedate"],
    detail_letter_ref: ["detailedclaimletterref", "detailedclaimref", "detailedclaim"],
    detail_received_date: ["cdatereceived", "detailedclaimreceived", "c"],
    detail_response_ref: ["detailedresponseref"],
    detail_response_date: ["detailedresponsedate"],
    resubmission_ref: ["resubmissionref", "resubmission"],
    resubmission_date: ["resubmissiondate"],
    contractor_eot_days: ["contractorsclaimeotdays", "contractoreot", "eotclaimed", "claimedeot", "eotdaysclaimed"],
    contractor_compensable_days: ["contractorcompensabledays", "compensabledaysclaimed"],
    contractor_cost: ["contractorsclaimcost", "contractorcost", "contractorclaimed", "claimed", "claimedcost", "amountclaimed", "claimedamount", "claimvalue", "claimamount"],
    engineer_eot_days: ["engineersrecommendationeotdays", "engineereot"],
    engineer_cost: ["engineerscost", "engineercost", "engineersrecommendation"],
    employer_eot_days: ["employersassessmenteotdays", "employereot"],
    employer_cost: ["employerscost", "employercost", "employersassessment"],
    determination_eot_days: ["determinationeotdays", "eotgranted", "granteddays", "agreedeot"],
    determination_cost: ["determinationcost", "determinedcost", "agreedcost", "determinedamount", "determination"],
    determination_ref: ["lettervoref", "voref"],
    cost_line_id: ["costreportline", "costline", "costcode", "cbs", "wbs", "budgetline", "budgetcode"],
  },
  early_warnings: {
    ew_no: ["ewno", "no", "ref", "earlywarningno"],
    date_raised: ["dateraised", "date"],
    raised_by: ["raisedby"],
    package_id: ["package"],
    contractor_id: ["contractor", "contractorconsultant"],
    description: ["description", "subject"],
    time_impact_days: ["potentialtimeimpactdays", "timeimpact", "timeimpactdays"],
    cost_impact: ["potentialcostimpactsar", "potentialcostimpact", "costimpact", "amount", "value"],
    likelihood: ["likelihood", "probability"],
    status: ["status"],
    change_id: ["linkedchangeitem", "linkedchange", "changeitem", "rfc"],
    cost_line_id: ["costreportline", "costline", "costcode", "cbs", "wbs", "budgetline", "budgetcode"],
  },
  risks: {
    ro_no: ["no", "ref", "riskno", "id"],
    type: ["type", "riskopportunity"],
    description: ["description", "risk", "opportunity"],
    package_id: ["package"],
    cause: ["cause"],
    mitigation: ["mitigationaction", "mitigation", "action", "response"],
    owner: ["owner"],
    probability: ["probability", "likelihood"],
    cost_impact: ["costimpactsar", "costimpact", "impact"],
    time_impact_days: ["timeimpact", "timeimpactdays"],
    status: ["status"],
    date: ["date", "dateraised"],
  },
  provisional_sums: {
    item: ["item", "itemno", "no", "ref", "psno"],
    description: ["description"],
    status_id: ["status"],
    contractor_id: ["contractor"],
    budget: ["budgetsar", "budget", "allowance", "provisionalsum"],
    contract_value: ["contractvaluesar", "contractvalue", "instructed", "instructedvalue"],
    comments: ["comments", "remarks", "notes"],
  },
  bonds: {
    ref: ["ref", "no", "srno", "reference"],
    contractor_id: ["contractorconsultant", "contractor", "consultant"],
    package_id: ["package"],
    original_contract_sum: ["originalcontractsum", "contractsum", "originalcontract"],
    type_id: ["typeofbondinsurance", "type", "bondtype", "insurancetype"],
    policy_no: ["policyno", "bondno", "policy"],
    requirement_value: ["contractrequirement", "requirement", "contractrequirementsaror", "contractrequirementsar", "requirementsar", "requiredamount", "bondrequired", "requirementamount", "required"],
    requirement_type: ["requirementtype", "contractrequirementtype", "requirementbasis"],
    amount_provided: ["amountprovided", "provided", "bondamount", "value"],
    expiry_date: ["expirydate", "expiry", "validuntil"],
    approved: ["approved", "approvedyesno"],
    bank_verification: ["bankverification", "verified", "bankverificationyesno"],
    comments: ["comments", "remarks"],
  },
  contracts: {
    sr_no: ["srno", "sn", "no"],
    reef_pr_no: ["reefprno", "prno", "pr"],
    reef_po_no: ["reefpono", "pono", "po"],
    acc_ref: ["accref", "acc"],
    contractor_id: ["contractor", "contractorconsultant", "supplier", "vendor"],
    title: ["title", "contract", "contracttitle"],
    scope_of_work: ["scopeofwork", "scope", "description"],
    current_status: ["currentstatus", "status"],
    original_completion_date: ["originalcompletiondate", "completiondate"],
    eot_granted_days: ["eotgranteddays", "eotgranted", "eot"],
    original_contract: ["originalcontractsar", "originalcontract", "contractsum", "originalvalue"],
    final_account_adjustment: ["finalaccountadjustment", "faadjustment"],
    advance_recovery_pct: ["advancerecovery", "advance"],
    retention_pct: ["retention"],
    transaction_no: ["transactionno", "transaction"],
    coding: ["coding", "accountcode"],
    cbs: ["cbs"],
  },
  payment_applications: {
    contract_id: ["contract", "pono", "reefpono", "contractor", "supplier"],
    sr_no: ["sr", "srno", "sn"],
    application_no: ["paymentapplicationno", "applicationno", "pano", "application", "ipa"],
    month: ["month", "period"],
    application_aconex_ref: ["aconexletterref", "applicationaconexref", "letterref"],
    application_date: ["aconexletterdate", "applicationdate", "letterdate", "date"],
    cumulative_claimed: ["cumulativeclaimedexclvat", "cumulativeclaimed", "cumclaimed"],
    ipc_no: ["ipcno", "ipc"],
    ipc_aconex_ref: ["ipcaconexref"],
    ipc_date: ["ipcdate", "ipcaconexdate"],
    cumulative_certified: ["cumulativecertified", "cumcertified"],
    invoice_aconex_ref: ["invoiceapprovalaconexref", "invoiceref"],
    invoice_date: ["invoiceapprovaldate", "invoicedate"],
    paid_date: ["paidbyfinancedate", "paiddate", "paymentdate", "paidon"],
  },
  budget_transfers: {
    item: ["item", "itemno", "no", "ref", "btrno"],
    description: ["description"],
    from_package_id: ["frompackage", "from"],
    to_package_id: ["topackage", "to"],
    amount: ["amountsar", "amount", "value"],
    date: ["date"],
    approval_ref: ["approvalref", "approval", "approvedref"],
    status: ["status"],
  },
  project_team: {
    role: ["role", "position", "roleposition"],
    name: ["name", "personname", "person"],
    organisation: ["organisation", "organization", "company"],
    email: ["email"],
  },
  actions: {
    item_no: ["itemno", "item", "no", "ref"],
    topic: ["topic", "subject", "title"],
    discussion: ["discussion"],
    action: ["action", "actionrequired"],
    owner: ["owner", "actionby", "responsible"],
    due_date: ["duedate", "due", "targetdate"],
    status: ["status"],
  },
};

export function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

export interface ColumnGuess {
  index: number; // 1-based column in the sheet
  header: string;
  field: string | null;
  confidence: "saved" | "high" | "medium" | "none";
}

export interface SheetAnalysis {
  name: string;
  headerRow: number;
  rowCount: number;
  register: string | null;
  registerLabel: string | null;
  score: number;
  columns: ColumnGuess[];
  sample: string[][];
}

export interface WorkbookAnalysis {
  fileId: string;
  fileName: string;
  sheets: SheetAnalysis[];
}

/** Finds the row that looks most like a header: many short text cells, few numbers. */
function findHeaderRow(ws: SheetValues): number {
  let best = 1;
  let bestScore = -1;
  const limit = Math.min(ws.rowCount, 30);
  for (let r = 1; r <= limit; r++) {
    const values = ws.rows.get(r);
    if (!values) continue;
    let text = 0;
    let numbers = 0;
    for (const v of values) {
      const t = cellText(v).trim();
      if (!t) continue;
      if (/^-?[\d,.]+$/.test(t)) numbers++;
      else if (t.length <= 60) text++;
    }
    const score = text - numbers * 2;
    if (text >= 3 && score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function fieldCandidates(def: RegisterDef): FieldDef[] {
  return def.fields.filter((f) => !f.virtual && !f.readonly && f.type !== "password" && !(f.hideInForm && f.key === "programme_id"));
}

/** Every run of consecutive words in a header, joined: "RFC Cost Report" → rfc, rfccost, rfccostreport, cost, costreport, report. */
function spans(header: string): Set<string> {
  const toks = String(header)
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    let acc = "";
    for (let j = i; j < toks.length; j++) {
      acc += toks[j];
      out.add(acc);
    }
  }
  return out;
}

/** Score how well a header matches a field: 3 exact label / synonym, 2 whole-word contains, 1 token overlap. */
function matchScore(header: string, def: RegisterDef, f: FieldDef): number {
  // A header may name the field directly in square brackets, e.g. "RFC date [rfc_date]" – used by the app's own templates.
  const tagged = /\[([a-z0-9_]+)\]\s*$/i.exec(String(header).trim());
  if (tagged) return tagged[1].toLowerCase() === f.key ? 4 : 0;
  const h = norm(header);
  if (!h) return 0;
  const label = norm(f.label);
  const key = norm(f.key.replace(/_id$/, ""));
  const syn = SYNONYMS[def.key]?.[f.key] ?? [];
  if (h === label || h === key || syn.includes(h)) return 3;
  const sp = spans(header);
  if (sp.has(label) || (h.length >= 4 && label.includes(h))) return 2;
  if (syn.some((s) => s.length >= 4 && (sp.has(s) || s.includes(h)))) return 2;
  const ht = new Set(String(header).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const lt = new Set(f.label.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const overlap = [...ht].filter((t) => lt.has(t)).length;
  return overlap >= 2 || (overlap === 1 && lt.size === 1) ? 1 : 0;
}

/** Best column→field mapping for one register (greedy, highest scores first, each field used once). */
function mapColumns(headers: { index: number; header: string }[], def: RegisterDef, saved: Record<string, string> | null): { columns: ColumnGuess[]; score: number } {
  const fields = fieldCandidates(def);
  const pairs: { i: number; f: FieldDef; s: number }[] = [];
  headers.forEach((h, i) => {
    for (const f of fields) {
      const s = matchScore(h.header, def, f);
      if (s > 0) pairs.push({ i, f, s });
    }
  });
  pairs.sort((a, b) => b.s - a.s);
  const usedCols = new Set<number>();
  const usedFields = new Set<string>();
  const columns: ColumnGuess[] = headers.map((h) => ({ index: h.index, header: h.header, field: null, confidence: "none" }));
  if (saved) {
    headers.forEach((h, i) => {
      const f = saved[norm(h.header)];
      if (f && fields.some((x) => x.key === f) && !usedFields.has(f)) {
        columns[i] = { ...columns[i], field: f, confidence: "saved" };
        usedCols.add(i);
        usedFields.add(f);
      }
    });
  }
  let score = 0;
  for (const p of pairs) {
    if (usedCols.has(p.i) || usedFields.has(p.f.key)) continue;
    usedCols.add(p.i);
    usedFields.add(p.f.key);
    columns[p.i] = { ...columns[p.i], field: p.f.key, confidence: p.s >= 3 ? "high" : "medium" };
    score += p.s;
  }
  if (saved) score += 100 * Object.values(saved).length;
  return { columns, score };
}

export function analyzeWorkbook(worksheets: SheetValues[], fileName: string, fileId: string): WorkbookAnalysis {
  const db = getDb();
  const sheets: SheetAnalysis[] = [];
  for (const ws of worksheets) {
    if (ws.rowCount < 2) continue;
    const headerRow = findHeaderRow(ws);
    const headers: { index: number; header: string }[] = [];
    (ws.rows.get(headerRow) ?? []).forEach((v, col) => {
      const t = cellText(v).trim();
      if (col > 0 && t) headers.push({ index: col, header: t });
    });
    if (headers.length < 2) continue;
    let best: { register: RegisterDef; columns: ColumnGuess[]; score: number } | null = null;
    for (const { key } of IMPORTABLE) {
      const def = allRegisters.find((d) => d.key === key)!;
      const savedRaw = getSetting(db, `workbook_map:${key}`);
      const saved = savedRaw ? (JSON.parse(savedRaw) as Record<string, string>) : null;
      const sig = headers.map((h) => norm(h.header)).join("|");
      const savedFor = saved && saved.__signature === sig ? saved : null;
      const { columns, score } = mapColumns(headers, def, savedFor);
      const keyField = importKeyFields(def)[0];
      const hasKey = columns.some((c) => c.field === keyField);
      const adjusted = score + (hasKey ? 3 : 0);
      if (!best || adjusted > best.score) best = { register: def, columns, score: adjusted };
    }
    const mapped = best ? best.columns.filter((c) => c.field).length : 0;
    const useRegister = best && mapped >= 3;
    const sample: string[][] = [];
    for (let r = headerRow + 1; r <= Math.min(ws.rowCount, headerRow + 3); r++) {
      const values = ws.rows.get(r);
      if (values) sample.push(headers.map((h) => cellText(values[h.index]).slice(0, 40)));
    }
    sheets.push({
      name: ws.name,
      headerRow,
      rowCount: Math.max(0, ws.rowCount - headerRow),
      register: useRegister ? best!.register.key : null,
      registerLabel: useRegister ? (IMPORTABLE.find((i) => i.key === best!.register.key)?.label ?? best!.register.title) : null,
      score: best?.score ?? 0,
      columns: useRegister ? best!.columns : headers.map((h) => ({ index: h.index, header: h.header, field: null, confidence: "none" as const })),
      sample,
    });
  }
  return { fileId, fileName, sheets };
}

/** Which field(s) identify an existing record when re-importing. */
export function importKeyFields(def: RegisterDef): string[] {
  if (def.key === "payment_applications") return ["application_no", "contract_id"];
  const unique = def.fields.find((f) => f.unique && !f.virtual);
  return [unique ? unique.key : def.displayField];
}

export { cellText };
