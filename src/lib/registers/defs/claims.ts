import type { FieldDef, RegisterDef } from "../types";

export const CLAIM_STATUSES = ["Pending", "Approved", "Rejected", "Approved incl. in Lump Sum", "Approved (Authority)", "Approved (proceed to ERI)"];

/** Contract time limits (business days). */
export const NOTICE_LIMIT_DAYS = 28;
export const DETAIL_LIMIT_DAYS = 42;

export const CLAIM_TYPES = [
  { key: "type_eot", label: "EOT" },
  { key: "type_prolongation", label: "Prolongation" },
  { key: "type_disruption", label: "Disruption" },
  { key: "type_acceleration", label: "Acceleration" },
  { key: "type_other", label: "Other" },
] as const;

/** The four assessment parties, in order. */
export const ASSESSMENT_PARTIES = [
  { prefix: "contractor", label: "Contractor's Claim", refLabel: "Claim letter ref" },
  { prefix: "engineer", label: "Engineer's Recommendation", refLabel: "Letter ref" },
  { prefix: "employer", label: "Employer's Assessment", refLabel: "Letter ref" },
  { prefix: "determination", label: "Determination / Agreement", refLabel: "Letter / VO ref" },
] as const;

const HEADER = "Claim details";
const NOTICE = "Notice compliance";
const DETAIL = "Detailed claim";

function assessment(prefix: string, label: string, refLabel: string): FieldDef[] {
  const s = `Assessment – ${label}`;
  return [
    { key: `${prefix}_eot_days`, label: "EOT days", type: "number", section: s, hideInTable: true },
    { key: `${prefix}_compensable_days`, label: "Compensable days", type: "number", section: s, hideInTable: true },
    { key: `${prefix}_cost`, label: "Cost (SAR)", type: "money", section: s, hideInTable: true },
    { key: `${prefix}_ref`, label: refLabel, type: "text", section: s, hideInTable: true },
    { key: `${prefix}_date`, label: "Date", type: "date", section: s, hideInTable: true },
  ];
}

export const claims: RegisterDef = {
  key: "claims",
  table: "claims",
  title: "Claims & Disputes",
  singular: "Claim",
  description: "Contractual claims with notice compliance, detailed claim, assessment by each party and determination.",
  displayField: "claim_no",
  displayFields: ["claim_no", "description"],
  scope: "programme",
  snapshot: true,
  defaultSort: { field: "claim_no", dir: "asc" },
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "claim_no", label: "Claim No", type: "text", required: true, unique: true, section: HEADER, width: "7rem" },
    { key: "description", label: "Description", type: "textarea", required: true, section: HEADER },
    { key: "status", label: "Status", type: "select", options: CLAIM_STATUSES, required: true, defaultValue: "Pending", chip: true, section: HEADER, filter: true },
    { key: "claim_types", label: "Claim type", type: "text", virtual: true, readonly: true, hideInForm: true },
    { key: "asset_id", label: "Asset code", type: "lookup", lookup: { register: "assets" }, required: true, section: HEADER, filter: true },
    { key: "contractor_id", label: "Contractor / Consultant", type: "lookup", lookup: { register: "contractors" }, section: HEADER, filter: true },
    { key: "contract_no", label: "Contract No", type: "text", section: HEADER, hideInTable: true },
    { key: "project", label: "Project", type: "text", section: HEADER, hideInTable: true },
    { key: "scope", label: "Scope", type: "textarea", section: HEADER, hideInTable: true },
    { key: "package_id", label: "Package", type: "lookup", lookup: { register: "packages" }, section: HEADER, hideInTable: true, filter: true },
    { key: "cost_line_id", label: "Cost report line", type: "lookup", lookup: { register: "cost_lines" }, section: HEADER, hideInTable: true, help: "Which Level 2 line this claim feeds (column M of the cost report)." },
    { key: "in_cost_report", label: "Carry in cost report (column M)", type: "boolean", defaultValue: true, section: HEADER, hideInTable: true, filter: true, help: "Untick to keep the claim out of the cost report, e.g. when its cost is already carried as an early warning. Claims imported from the Claims Tracker are ticked only once approved." },
    ...CLAIM_TYPES.map<FieldDef>((t) => ({ key: t.key, label: `Claim type: ${t.label}`, type: "boolean", defaultValue: false, section: HEADER, hideInTable: true })),
    { key: "type_other_text", label: "Other – describe", type: "text", section: HEADER, hideInTable: true },

    { key: "notice_aware_date", label: "(A) Date contractor became aware", type: "date", section: NOTICE, hideInTable: true },
    { key: "notice_letter_ref", label: "Notice letter ref", type: "text", section: NOTICE, hideInTable: true },
    { key: "notice_received_date", label: "(B) Date received by RSG", type: "date", section: NOTICE, hideInTable: true },
    { key: "notice_business_days", label: "Business days A → B", type: "number", virtual: true, readonly: true, hideInForm: true, hideInTable: true },
    { key: "notice_complies", label: "Notice within 28 days", type: "text", virtual: true, readonly: true, hideInForm: true, chip: true },
    { key: "notice_response_ref", label: "Engineer / Employer response ref", type: "text", section: NOTICE, hideInTable: true },
    { key: "notice_response_date", label: "Response date", type: "date", section: NOTICE, hideInTable: true },

    { key: "detail_letter_ref", label: "Detailed claim letter ref", type: "text", section: DETAIL, hideInTable: true },
    { key: "detail_received_date", label: "(C) Date detailed claim received", type: "date", section: DETAIL, hideInTable: true },
    { key: "detail_business_days", label: "Business days A → C", type: "number", virtual: true, readonly: true, hideInForm: true, hideInTable: true },
    { key: "detail_complies", label: "Detail within 42 days", type: "text", virtual: true, readonly: true, hideInForm: true, chip: true },
    { key: "detail_response_ref", label: "Engineer / Employer detailed response ref", type: "text", section: DETAIL, hideInTable: true },
    { key: "detail_response_date", label: "Detailed response date", type: "date", section: DETAIL, hideInTable: true },
    { key: "resubmission_ref", label: "Resubmission ref", type: "text", section: DETAIL, hideInTable: true },
    { key: "resubmission_date", label: "Resubmission date", type: "date", section: DETAIL, hideInTable: true },

    ...ASSESSMENT_PARTIES.flatMap((p) => assessment(p.prefix, p.label, p.refLabel)),

    { key: "contractor_eot_days_view", label: "EOT claimed (days)", type: "number", virtual: true, readonly: true, hideInForm: true },
    { key: "determination_eot_days_view", label: "EOT granted (days)", type: "number", virtual: true, readonly: true, hideInForm: true },
    { key: "contractor_cost_view", label: "SAR claimed", type: "money", virtual: true, readonly: true, hideInForm: true },
    { key: "determination_cost_view", label: "SAR determined", type: "money", virtual: true, readonly: true, hideInForm: true },
    { key: "cost_report_amount", label: "Cost report amount (M)", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Determination, else Employer's assessment, else Engineer's recommendation, else Contractor's claim. Zero when Rejected or included in the lump sum." },
    { key: "notes", label: "Notes", type: "textarea", section: "Assessment – Determination / Agreement", hideInTable: true },
  ],
};

export const claimRegisters: RegisterDef[] = [claims];

/** The value carried in the cost report for a claim (see cost_report_amount help text). */
export function claimCostReportAmount(row: Record<string, unknown>): number {
  const status = String(row.status ?? "");
  if (status === "Rejected" || status === "Approved incl. in Lump Sum") return 0;
  if (row.in_cost_report === false || row.in_cost_report === 0) return 0;
  for (const k of ["determination_cost", "employer_cost", "engineer_cost", "contractor_cost"]) {
    const v = row[k];
    if (v !== null && v !== undefined && v !== "") return Number(v);
  }
  return 0;
}
