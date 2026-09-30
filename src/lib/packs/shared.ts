/**
 * Document Packs – the catalogue of RSG document packs the dashboard prepares, one category each:
 * RFC, PVO, VO, DVO, RFA, Stage 2 conversion, EOT EAR and Cost EAR. Every pack has the fields its
 * RSG form carries (filled from the registers, the rest typed in), the numbered upload slots of the
 * compiled PDF, and the file name the head office expects. Nothing here touches the server – it is
 * shared with the browser.
 */

export type PackTypeKey = "rfc" | "pvo" | "vo" | "dvo" | "rfa" | "stage2" | "eot_ear" | "cost_ear";
export type PackSource = "changes" | "claims" | "contracts";

export interface PackField {
  key: string;
  label: string;
  kind: "text" | "money" | "date" | "number" | "long";
  /** the section of the form the field sits in */
  group: string;
  /** filled from the registers when the pack is created (still editable) */
  auto?: boolean;
  /** other wordings the RSG template may use for this cell – matched against the label cell next to a blank one */
  aliases?: string[];
  hint?: string;
}

export interface PackSlot {
  key: string;
  no: number;
  label: string;
  hint: string;
}

export interface PackType {
  key: PackTypeKey;
  label: string;
  short: string;
  /** the RSG form reference printed on the document */
  formRef: string;
  description: string;
  source: PackSource;
  /** what the register item is called when one is picked */
  sourceLabel: string;
  fields: PackField[];
  slots: PackSlot[];
  /** the sections of the form, in order (group names of the fields) */
  groups: string[];
}

export const PACK_STATUSES = ["Draft", "For approval", "Issued", "Superseded"] as const;

/* ------------------------------------------------------------------ */
/* the fields every RSG form shares                                    */

const general = (extra: PackField[] = []): PackField[] => [
  { key: "destination", label: "Destination", kind: "text", group: "General information", auto: true, aliases: ["destination"] },
  { key: "program_name", label: "Program name", kind: "text", group: "General information", auto: true, aliases: ["program name", "programme name", "program"] },
  { key: "program_no", label: "Program no", kind: "text", group: "General information", auto: true, aliases: ["program no", "programme no", "program number"] },
  { key: "project_name", label: "Project name", kind: "text", group: "General information", auto: true, aliases: ["project name", "project"] },
  { key: "project_code", label: "Project code", kind: "text", group: "General information", auto: true, aliases: ["project code", "asset code"] },
  { key: "development_name", label: "Development name", kind: "text", group: "General information", auto: true, aliases: ["development name", "development"] },
  { key: "development_no", label: "Development no", kind: "text", group: "General information", auto: true, aliases: ["development no", "development number"] },
  { key: "contract_no", label: "Contract no (ACC)", kind: "text", group: "General information", auto: true, aliases: ["contract no", "acc contract no", "contract ref", "contract reference", "contract number"] },
  { key: "contract_title", label: "Contract name", kind: "text", group: "General information", auto: true, aliases: ["contract name", "contract title"] },
  { key: "works_package", label: "Works package", kind: "text", group: "General information", auto: true, aliases: ["works package", "work package", "package"] },
  { key: "ewbs_code", label: "EWBS code", kind: "text", group: "General information", auto: true, aliases: ["ewbs code", "ewbs", "control account", "cost code"] },
  { key: "contractor", label: "Contractor / Consultant", kind: "text", group: "General information", auto: true, aliases: ["contractor", "consultant", "vendor name", "vendor", "contractor/consultant", "contractor / consultant", "supplier"] },
  { key: "requesting_department", label: "Requesting department", kind: "text", group: "General information", auto: true, aliases: ["requesting department", "department"] },
  { key: "date", label: "Date", kind: "date", group: "General information", auto: true, aliases: ["date"] },
  ...extra,
];

const signatures = (group = "Signatures"): PackField[] => [
  { key: "prepared_by", label: "Prepared by – name", kind: "text", group, auto: true, aliases: ["prepared by", "prepared/initiated by", "prepared / initiated by", "initiated by", "prepared by name"] },
  { key: "prepared_position", label: "Prepared by – position", kind: "text", group, auto: true, aliases: ["prepared by position", "position"] },
  { key: "checked_by", label: "Checked by – name", kind: "text", group, aliases: ["checked by", "checked by (pre-approval)", "reviewed by"] },
  { key: "checked_position", label: "Checked by – position", kind: "text", group, aliases: ["checked by position"] },
  { key: "approved_by", label: "Approved by – name", kind: "text", group, aliases: ["approved by", "approved and issued by", "final determination by"] },
  { key: "approved_position", label: "Approved by – position", kind: "text", group, aliases: ["approved by position"] },
];

const money = (key: string, label: string, group: string, auto = false, aliases: string[] = []): PackField => ({ key, label, kind: "money", group, auto, aliases: [label.toLowerCase(), ...aliases] });
const text = (key: string, label: string, group: string, auto = false, aliases: string[] = [], hint?: string): PackField => ({ key, label, kind: "text", group, auto, aliases: [label.toLowerCase(), ...aliases], hint });
const date = (key: string, label: string, group: string, auto = false, aliases: string[] = []): PackField => ({ key, label, kind: "date", group, auto, aliases: [label.toLowerCase(), ...aliases] });
const num = (key: string, label: string, group: string, auto = false, aliases: string[] = []): PackField => ({ key, label, kind: "number", group, auto, aliases: [label.toLowerCase(), ...aliases] });
const long = (key: string, label: string, group: string, aliases: string[] = [], hint?: string): PackField => ({ key, label, kind: "long", group, aliases: [label.toLowerCase(), ...aliases], hint });

/* ------------------------------------------------------------------ */

export const PACK_TYPES: PackType[] = [
  {
    key: "rfc",
    label: "RFC – Request for Change",
    short: "RFC",
    formRef: "RSG-CM-FRM-0011",
    description: "The request that opens a change: what is asked for, why, the contractual basis, the rough order of magnitude and where the budget sits.",
    source: "changes",
    sourceLabel: "change on the Change Management register",
    groups: ["General information", "Particulars of the change", "Estimated cost and time", "Budget", "Signatures"],
    fields: [
      ...general([text("rfc_ref", "RFC / CRF reference", "General information", true, ["rfc reference", "crf reference", "rfc/crf reference", "rfc no", "crf no"]), text("item_no", "Dashboard item", "General information", true, ["item no"])]),
      text("title", "Title of the change", "Particulars of the change", true, ["title", "title of this variation", "title of the change", "subject"]),
      long("scope", "Scope of works / services (brief)", "Particulars of the change", ["scope of works", "scope of works / services", "scope", "description"]),
      long("reason", "Reason for the change", "Particulars of the change", ["reason", "reason for change", "reason for proposed variation order"]),
      long("contractual_basis", "Contractual basis for entitlement", "Particulars of the change", ["contractual basis", "contractual basis for variation entitlement", "clause"]),
      text("root_cause", "Root cause", "Particulars of the change", false, ["root cause", "root cause for this change"], "e.g. Project Management – Scope – new"),
      text("initiated_by", "Initiated by", "Particulars of the change", true, ["initiated by", "change initiator"]),
      money("rom_estimate", "Estimated cost impact (ROM)", "Estimated cost and time", true, ["rom", "estimated cost impact", "rom estimate", "estimated cost"]),
      long("rom_basis", "Basis of the ROM estimate", "Estimated cost and time", ["basis of rom estimate", "basis of estimate"]),
      num("time_impact", "Time impact (days)", "Estimated cost and time", true, ["time impact", "time impact (days)", "eot"]),
      text("eac_included", "Included in the latest EAC?", "Budget", false, ["is this change included in the latest eac", "included in eac", "eac"], "Yes / No"),
      long("eac_explanation", "If not in the EAC, the reasoning", "Budget", ["explain if the topic was included within the eac"]),
      text("budget_source", "Budget source", "Budget", false, ["budget source"], "A) No additional budget · B) Budget transfer required · C) Additional budget required"),
      money("budget_available", "Budget available on the package", "Budget", true, ["budget available", "remaining budget", "current budget available"]),
      ...signatures(),
    ],
    slots: [
      { key: "drawings", no: 1, label: "Marked-up drawings and scope particulars", hint: "The drawings, sketches or specifications that show the change" },
      { key: "estimate", no: 2, label: "ROM cost build-up", hint: "The estimate behind the ROM figure" },
      { key: "correspondence", no: 3, label: "Instruction and correspondence", hint: "The letter, mail or instruction that triggered the request" },
      { key: "approval", no: 4, label: "Aconex approval workflow", hint: "The workflow transmittal that approved the RFC, with its review history" },
    ],
  },
  {
    key: "pvo",
    label: "PVO – Proposed Variation Order",
    short: "PVO",
    formRef: "RSG-CM-FRM-0013",
    description: "The Proposed Variation Order (Stage Gate 3 to 9): particulars of the change, the value by item, the budget particulars and the approvals.",
    source: "changes",
    sourceLabel: "change on the Change Management register",
    groups: ["General information", "Particulars of this change", "Value", "Budget particulars", "Signatures"],
    fields: [
      ...general([text("pvo_no", "Proposed Variation Order no", "General information", true, ["proposed variation order no", "pvo no", "pvo number", "pvo ref"]), text("rfc_ref", "RFC / CRF reference", "General information", true, ["rfc/crf reference", "rfc reference", "crf reference"]), text("item_no", "Dashboard item", "General information", true, ["item no"])]),
      text("title", "Title of this variation", "Particulars of this change", true, ["title of this variation", "title", "variation title"]),
      text("eac_included", "Included in the latest EAC?", "Particulars of this change", false, ["is this change included in the latest eac", "included in eac"], "Yes / No"),
      long("scope", "Scope of works / services (brief)", "Particulars of this change", ["scope of works / services", "scope of works", "scope"]),
      long("reason", "Reason for the Proposed Variation Order", "Particulars of this change", ["reason for proposed variation order", "reason"]),
      long("contractual_basis", "Contractual basis for variation entitlement", "Particulars of this change", ["contractual basis for variation entitlement", "contractual basis"]),
      long("eac_explanation", "If not in the EAC, the reasoning", "Particulars of this change", ["explain if the topic was included within the eac"]),
      text("root_cause", "Root cause for this change", "Particulars of this change", false, ["root cause for this change", "root cause"], "e.g. Project Management – Scope – new"),
      long("rom_basis", "Basis of the estimate", "Value", ["basis of rom estimate", "basis of estimate"]),
      money("omit", "Omit (SAR)", "Value", false, ["omit"]),
      money("add", "Add (SAR)", "Value", true, ["add"]),
      money("total_value", "Total value (SAR)", "Value", true, ["total value", "total value (in contract currency)", "total value (in sar)", "pvo value"]),
      num("time_impact", "Time impact (days)", "Value", true, ["time impact", "time impact (days)"]),
      text("budget_source", "Budget source", "Budget particulars", false, ["budget source"], "A) No additional budget or budget transfer · B) Budget transfer required · C) Additional budget required"),
      text("budget_line", "Budget control account", "Budget particulars", true, ["control account", "budget line", "from"]),
      money("approved_contract", "Approved contract (SAR)", "Budget particulars", true, ["approved contract"]),
      money("approved_dvos", "Approved DVOs (SAR)", "Budget particulars", true, ["approved dvos"]),
      money("approved_pvos", "Approved PVOs (SAR)", "Budget particulars", true, ["approved pvos"]),
      money("remaining_budget", "Remaining budget before this PVO (SAR)", "Budget particulars", true, ["remaining budget before this pvo", "remaining budget"]),
      money("revised_budget", "Revised budget after this PVO (SAR)", "Budget particulars", true, ["revised budget"]),
      ...signatures(),
    ],
    slots: [
      { key: "rfc", no: 1, label: "RFC / CRF form (approved)", hint: "The approved Request for Change behind this PVO" },
      { key: "proposal", no: 2, label: "Contractor's proposal and pricing", hint: "The contractor's quotation or cost proposal" },
      { key: "assessment", no: 3, label: "Employer's cost assessment", hint: "The commercial team's build-up of the PVO value" },
      { key: "drawings", no: 4, label: "Marked-up drawings and particulars", hint: "Annexure – drawings, sketches, specifications" },
      { key: "approval", no: 5, label: "Aconex approval workflow", hint: "The workflow transmittal that approved the PVO, with its review history" },
    ],
  },
  {
    key: "vo",
    label: "VO – Variation Order",
    short: "VO",
    formRef: "AMA-CM-FRM-0013",
    description: "The Variation Order issued to the contractor under Sub-Clause 13.1 [Employer's Right to Vary] and 3.4 [Employer's Instruction].",
    source: "changes",
    sourceLabel: "change on the Change Management register",
    groups: ["General information", "Instruction", "Information provided", "Signatures"],
    fields: [
      ...general([text("vo_no", "Variation Order no", "General information", true, ["variation order no", "vo no", "vo number", "vo ref"]), text("pvo_no", "Proposed Variation Order no", "General information", true, ["pvo no", "proposed variation order no"]), text("instruction_ref", "Instruction reference", "General information", true, ["instruction reference", "instruction ref", "letter ref"]), text("item_no", "Dashboard item", "General information", true, ["item no"])]),
      text("title", "Variation title", "Instruction", true, ["title", "variation order title", "variation title"]),
      long("instruction", "The Contractor is instructed to proceed with", "Instruction", ["instructs the contractor to proceed with", "description", "instruction"]),
      text("clauses", "Contract clauses relied on", "Instruction", false, ["clauses", "pursuant to"], "Sub-Clause 13.1 [Employer's Right to Vary] & 3.4 [Employer's Instruction]"),
      money("vo_value", "Variation value (SAR)", "Instruction", true, ["vo value", "variation value", "total value", "value"]),
      num("time_impact", "Time impact (days)", "Instruction", true, ["time impact", "time impact (days)"]),
      long("information_provided", "Information provided with this Variation Order", "Information provided", ["information provided with this variation order", "documents", "document title"], "One document per line: ref – title – rev – date"),
      text("received_by", "Received by – name (Contractor's Representative)", "Signatures", false, ["received by", "received by (contractor's representative)", "contractor's representative"]),
      text("received_position", "Received by – position", "Signatures", false, ["received by position"]),
      ...signatures(),
    ],
    slots: [
      { key: "pvo", no: 1, label: "Approved PVO form", hint: "The Proposed Variation Order this VO gives effect to" },
      { key: "pvo_approval", no: 2, label: "PVO Aconex approval", hint: "The workflow transmittal that approved the PVO" },
      { key: "drawings", no: 3, label: "Marked-up drawings and scope particulars", hint: "What the contractor is instructed to build" },
      { key: "issue", no: 4, label: "Aconex VO issue letter", hint: "The letter or mail that issued the VO to the contractor" },
    ],
  },
  {
    key: "dvo",
    label: "DVO – Determination of Variation Order",
    short: "DVO",
    formRef: "RSG-CM-FRM-0014",
    description: "The Employer's final determination of a Variation Order: the determined value, the contract reconciliation and the extension of time, with its annexures.",
    source: "changes",
    sourceLabel: "change on the Change Management register",
    groups: ["General information", "Variation", "Determination", "Contract reconciliation", "Extension of time", "Information provided", "Signatures"],
    fields: [
      ...general([text("dvo_no", "Determination no", "General information", true, ["variation order no", "dvo no", "dvo ref", "determination no"]), text("vo_no", "Variation Order no", "General information", true, ["vo no", "vo ref"]), text("instruction_ref", "Instruction reference", "General information", true, ["instruction reference", "instruction ref"]), text("item_no", "Dashboard item", "General information", true, ["item no"]), text("revision", "Rev. no", "General information", false, ["rev. no", "rev no", "revision"])]),
      text("title", "Variation Order title", "Variation", true, ["variation order title", "title"]),
      long("description", "Description of the determination", "Variation", ["description"]),
      long("reason", "Reason for the Variation Order", "Variation", ["reason for variation order", "reason"]),
      money("omit", "Omit (SAR)", "Determination", false, ["omit"]),
      money("add", "Add (SAR)", "Determination", true, ["add"]),
      money("dvo_value", "This Variation Order [d] (SAR)", "Determination", true, ["this variation order", "total value", "sub-total", "dvo value", "avv"]),
      money("contract_price", "Contract Price [a] (SAR)", "Contract reconciliation", true, ["contract price", "contract price [a]", "original contract price"]),
      money("previous_dvos", "Sum of previous Determinations [b] (SAR)", "Contract reconciliation", true, ["sum of previous determination of variation orders", "previous dvos", "sum of previous determination of variation orders / adjustments"]),
      money("interim_vos", "Sum of interim value variations [c] (SAR)", "Contract reconciliation", false, ["sum of interim value variations", "interim value variations"]),
      money("revised_contract", "Revised Contract Price [e] (SAR)", "Contract reconciliation", true, ["revised contract price", "revised contract sum"]),
      text("vo_pct", "VO % of original Contract Price", "Contract reconciliation", true, ["vo's % original contract price", "vo % original contract price"]),
      date("original_completion", "Original Contract Completion Date [x]", "Extension of time", true, ["original contract completion date", "original completion date", "contract commencement date"]),
      num("previous_eot", "Previous approved extension of time (days) [y]", "Extension of time", true, ["previous approved extension of time", "previous eot"]),
      num("this_eot", "This agreed extension of time (days) [z]", "Extension of time", true, ["this agreed extension of time", "this eot", "time impact"]),
      num("total_eot", "Total extension (days) [y+z]", "Extension of time", true, ["total extension", "total extension (days difference to the original contract completion date)"]),
      long("information_provided", "Information provided with this Determination", "Information provided", ["information provided with this determination of variation order form", "annexure", "document title"], "One document per line: Annexure – title – rev – date"),
      ...signatures(),
    ],
    slots: [
      { key: "annex1", no: 1, label: "Annexure 01 – Cost breakdown and particulars", hint: "The build-up of the determined value" },
      { key: "annex2", no: 2, label: "Annexure 02 – Contract reconciliation", hint: "The previous determinations and the revised contract price" },
      { key: "vo", no: 3, label: "Variation Order issued", hint: "The VO letter and form this determination closes" },
      { key: "submission", no: 4, label: "Contractor's submission and agreement", hint: "The contractor's pricing, correspondence and any agreement" },
      { key: "approval", no: 5, label: "Aconex approval workflow", hint: "The workflow transmittal that approved the DVO, with its review history" },
    ],
  },
  {
    key: "rfa",
    label: "RFA – Request for Approval",
    short: "RFA",
    formRef: "RSG-CM-FRM-RFA",
    description: "The request put to the approver: the subject, the background, the commercial evaluation, the recommendation and the budget it draws on.",
    source: "changes",
    sourceLabel: "change on the Change Management register",
    groups: ["General information", "Request", "Recommendation", "Budget", "Signatures"],
    fields: [
      ...general([text("rfa_no", "RFA reference", "General information", true, ["rfa reference", "rfa no", "reference"]), text("item_no", "Dashboard item", "General information", true, ["item no"]), text("approver", "Approval sought from", "General information", false, ["approval sought from", "approver", "to"])]),
      text("subject", "Subject", "Request", true, ["subject", "title"]),
      long("background", "Background", "Request", ["background", "purpose"]),
      long("evaluation", "Commercial evaluation", "Request", ["commercial evaluation", "evaluation", "assessment"]),
      long("options", "Options considered", "Request", ["options considered", "options"]),
      long("recommendation", "Recommendation", "Recommendation", ["recommendation", "recommended action"]),
      money("amount", "Amount requested (SAR)", "Recommendation", true, ["amount requested", "amount", "value"]),
      text("budget_source", "Budget source", "Budget", false, ["budget source"], "A) No additional budget or budget transfer · B) Budget transfer required · C) Additional budget required"),
      money("budget_available", "Budget available (SAR)", "Budget", true, ["budget available", "remaining budget"]),
      ...signatures(),
    ],
    slots: [
      { key: "memo", no: 1, label: "Background and supporting memo", hint: "The papers that explain the request" },
      { key: "evaluation", no: 2, label: "Commercial evaluation", hint: "Comparisons, quotations, the build-up of the amount" },
      { key: "budget", no: 3, label: "Budget position", hint: "The cost report line or budget statement drawn on" },
      { key: "approval", no: 4, label: "Approvals", hint: "The Aconex workflow or signed approval" },
    ],
  },
  {
    key: "stage2",
    label: "Stage 2 – Two-stage contract conversion",
    short: "Stage 2",
    formRef: "Stage 2 price movement summary",
    description: "The bridge from the Stage 1 contract price to the Stage 2 revised price for a two-stage contract, with the root causes of the movement and the one-page summary.",
    source: "contracts",
    sourceLabel: "contract on the Payment Tracking register",
    groups: ["General information", "Contract", "Price bridge", "Narrative", "Signatures"],
    fields: [
      ...general([text("item_no", "Contract SR no", "General information", true, ["sr no"])]),
      text("contract_date", "Contract dated", "Contract", true, ["contract dated", "contract date"]),
      date("addendum_date", "Addendum dated", "Contract", false, ["addendum dated", "addendum date"]),
      text("status", "Status", "Contract", false, ["status"], "Signed / Agreed, not signed / NOT AGREED"),
      text("review_date", "Contract review date", "Contract", false, ["contract review date", "review date"]),
      money("stage1_price", "Original contract price (Stage 1)", "Price bridge", true, ["original contract price", "original contract price (stage 1)", "stage 1"]),
      money("descope", "Descope – scope removed from the contract", "Price bridge", false, ["descope"]),
      money("ps_adjustment", "PS adjustment – provisional sums", "Price bridge", false, ["ps adjustment", "provisional sums"]),
      money("retained_value", "Stage 1 value of the scope retained", "Price bridge", false, ["stage 1 value of the scope retained", "retained"]),
      money("quantity_adjustment", "Quantity adjustment – remeasure of retained items", "Price bridge", false, ["quantity adjustment"]),
      money("rate_adjustment", "Rate adjustment – Stage 2 rate revisions", "Price bridge", false, ["rate adjustment"]),
      money("design_development", "Design development / change", "Price bridge", false, ["design development", "design development / change"]),
      money("procurement_gap", "Procurement / scope gap – not carried at Stage 1", "Price bridge", false, ["procurement / scope gap", "procurement gap", "scope gap"]),
      money("additional_rsg", "Additional scope – RSG instructed", "Price bridge", false, ["additional scope - rsg instructed", "rsg instructed"]),
      money("additional_operator", "Additional scope – Operator request", "Price bridge", false, ["additional scope - operator request", "operator request"]),
      money("stage2_price", "Revised contract price (Stage 2)", "Price bridge", true, ["revised contract price", "revised contract price (stage 2)", "stage 2"]),
      long("summary", "Summary of the movement", "Narrative", ["summary", "executive summary"]),
      long("largest_movements", "Largest single movements", "Narrative", ["largest single movements", "largest movements"], "One per line: item – bill – movement (SAR) – root cause"),
      long("position", "Agreement position", "Narrative", ["agreement position", "position"]),
      ...signatures(),
    ],
    slots: [
      { key: "boq", no: 1, label: "Stage 2 BOQ (Appendix A)", hint: "The priced Stage 2 bill" },
      { key: "addendum", no: 2, label: "Contract addendum", hint: "The addendum that converted the contract" },
      { key: "workings", no: 3, label: "Root-cause workings", hint: "The bridge workbook and the bill-by-bill analysis" },
      { key: "correspondence", no: 4, label: "Correspondence and agreement", hint: "Letters, minutes and the contractor's agreement" },
    ],
  },
  {
    key: "eot_ear",
    label: "EOT EAR – Employer's Assessment Report (time)",
    short: "EOT EAR",
    formRef: "Employer's Assessment Report – Extension of Time",
    description: "The Employer's Assessment Report on a contractor's claim for an extension of time: the claim, the contract provisions, the delay events, the assessment and the recommendation.",
    source: "claims",
    sourceLabel: "claim on the Claims & Disputes register",
    groups: ["General information", "Claim", "Submission", "Assessment", "Conclusion", "Signatures"],
    fields: [
      ...general([text("claim_no", "Claim no", "General information", true, ["claim no", "claim ref"]), text("eot_no", "EOT no", "General information", true, ["eot no", "eot"]), text("revision", "Revision", "General information", false, ["revision", "rev"], "00, 01 …"), text("previous_revision", "Supersedes", "General information", false, ["supersedes"], "e.g. Revision 00 dated 19 July 2026")]),
      text("title", "Claim title", "Claim", true, ["claim title", "title"]),
      long("claim_summary", "The Contractor's claim", "Claim", ["the contractor's claim", "contractor's claim", "claim"]),
      num("days_claimed", "Days claimed", "Claim", true, ["days claimed", "eot claimed", "contractor eot claimed"]),
      date("completion_date", "Contract completion date", "Claim", true, ["contract completion date", "time for completion", "original completion date"]),
      date("revised_completion_date", "Revised completion date (previous EOTs)", "Claim", true, ["revised completion date", "revised contract time for completion"]),
      text("notice_ref", "Notice letter ref", "Submission", true, ["notice letter ref", "notice ref", "notice"]),
      date("notice_date", "Notice received", "Submission", true, ["notice received", "notice date"]),
      text("submission_ref", "Detailed claim letter ref", "Submission", true, ["detailed claim letter ref", "submission ref", "claim letter ref"]),
      date("submission_date", "Detailed claim received", "Submission", true, ["detailed claim received", "submission date"]),
      long("contract_provisions", "Relevant contract provisions", "Assessment", ["relevant contract provisions", "contract provisions"]),
      long("delay_events", "Delay events and their validity", "Assessment", ["delay events", "delay event"], "One per line: DE01 – title – clause – valid in principle? – remark"),
      long("assessment", "The Employer's assessment", "Assessment", ["the employer's assessment", "employer's assessment", "assessment"]),
      num("days_assessed", "Days assessed", "Conclusion", true, ["days assessed", "eot assessed", "extension of time assessed"]),
      date("assessed_completion_date", "Assessed completion date", "Conclusion", false, ["assessed completion date", "revised time for completion"]),
      long("conclusion", "Conclusion and recommendation", "Conclusion", ["conclusion and recommendation", "conclusion", "recommendation"]),
      ...signatures(),
    ],
    slots: [
      { key: "submission", no: 1, label: "Contractor's EOT submission", hint: "The claim narrative and its appendices" },
      { key: "notices", no: 2, label: "Notices and correspondence", hint: "The notice, the detailed claim letter and the Employer's responses" },
      { key: "programme", no: 3, label: "Programme and delay analysis", hint: "Baseline, updates and the delay analysis relied on" },
      { key: "previous", no: 4, label: "Previous EAR / EOT award", hint: "The earlier assessment or award this one follows" },
      { key: "approval", no: 5, label: "Aconex approval workflow", hint: "The workflow transmittal that approved the EAR, with its review history" },
    ],
  },
  {
    key: "cost_ear",
    label: "Cost EAR – Employer's Assessment Report (cost)",
    short: "Cost EAR",
    formRef: "Employer's Assessment Report – Cost",
    description: "The Employer's Assessment Report on a contractor's cost claim (prolongation, disruption, acceleration): the claim, the entitlement, the assessed amount and the recommendation.",
    source: "claims",
    sourceLabel: "claim on the Claims & Disputes register",
    groups: ["General information", "Claim", "Submission", "Assessment", "Conclusion", "Signatures"],
    fields: [
      ...general([text("claim_no", "Claim no", "General information", true, ["claim no", "claim ref"]), text("revision", "Revision", "General information", false, ["revision", "rev"], "00, 01 …"), text("previous_revision", "Supersedes", "General information", false, ["supersedes"])]),
      text("title", "Claim title", "Claim", true, ["claim title", "title"]),
      text("claim_type", "Claim type", "Claim", true, ["claim type", "type"]),
      long("claim_summary", "The Contractor's claim", "Claim", ["the contractor's claim", "contractor's claim", "claim"]),
      money("amount_claimed", "Amount claimed (SAR)", "Claim", true, ["amount claimed", "claimed"]),
      text("notice_ref", "Notice letter ref", "Submission", true, ["notice letter ref", "notice ref"]),
      date("notice_date", "Notice received", "Submission", true, ["notice received", "notice date"]),
      text("submission_ref", "Detailed claim letter ref", "Submission", true, ["detailed claim letter ref", "submission ref"]),
      date("submission_date", "Detailed claim received", "Submission", true, ["detailed claim received", "submission date"]),
      long("contract_provisions", "Relevant contract provisions", "Assessment", ["relevant contract provisions", "contract provisions"]),
      long("heads_of_claim", "Heads of claim and entitlement", "Assessment", ["heads of claim", "entitlement"], "One per line: head – claimed – assessed – basis"),
      long("assessment", "The Employer's assessment", "Assessment", ["the employer's assessment", "employer's assessment", "assessment"]),
      money("amount_assessed", "Amount assessed (SAR)", "Conclusion", true, ["amount assessed", "assessed", "determination"]),
      long("conclusion", "Conclusion and recommendation", "Conclusion", ["conclusion and recommendation", "conclusion", "recommendation"]),
      ...signatures(),
    ],
    slots: [
      { key: "submission", no: 1, label: "Contractor's cost claim submission", hint: "The claim narrative and its appendices" },
      { key: "buildup", no: 2, label: "Cost build-up and substantiation", hint: "Invoices, payroll, plant records, the contractor's calculations" },
      { key: "notices", no: 3, label: "Notices and correspondence", hint: "The notice, the detailed claim letter and the Employer's responses" },
      { key: "previous", no: 4, label: "Previous EAR", hint: "The earlier assessment this one follows" },
      { key: "approval", no: 5, label: "Aconex approval workflow", hint: "The workflow transmittal that approved the EAR, with its review history" },
    ],
  },
];

export const PACK_TYPE_MAP: Record<PackTypeKey, PackType> = Object.fromEntries(PACK_TYPES.map((t) => [t.key, t])) as Record<PackTypeKey, PackType>;

export function packType(key: string): PackType | null {
  return (PACK_TYPE_MAP as Record<string, PackType>)[key] ?? null;
}

export type PackValues = Record<string, string>;

export interface PackCase {
  id: number;
  pack_type: PackTypeKey;
  programme_id: number;
  source_table: PackSource;
  source_id: number | null;
  ref: string;
  title: string;
  revision: string;
  status: (typeof PACK_STATUSES)[number];
  values_json: string;
  file_name: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

export interface PackDoc {
  id: number;
  case_id: number;
  slot: string;
  name: string;
  rel_path: string;
  disk_path: string;
  size: number;
  mime: string;
  sort_order: number;
  page_count: number;
  pages: string;
  page_kinds: string;
  created_at: string;
  created_by: string;
}

export interface PackTemplate {
  id: number;
  pack_type: PackTypeKey;
  name: string;
  disk_path: string;
  size: number;
  mime: string;
  /** JSON: { placeholders: string[], labels: { label: string; field: string | null }[] } */
  fields_json: string;
  created_at: string;
  created_by: string;
}

export interface TemplateInspection {
  /** {{key}} placeholders found in the file */
  placeholders: string[];
  /** label cells found next to a blank cell, and the field each one maps to */
  labels: { label: string; field: string | null }[];
  /** fields nothing in the template will take */
  unmatched: string[];
}

/** "PVO 05", or the ref alone when it already names the document ("PVO 013" → "PVO 013", "DVO-001" → "DVO-001"). */
export function packRefLabel(short: string, ref: string): string {
  const r = String(ref ?? "").trim();
  if (!r) return short;
  const head = short.toLowerCase().replace(/\s+/g, "");
  const first = r.toLowerCase().replace(/[\s\-–_]+/g, "").slice(0, head.length);
  return first === head ? r : `${short} ${r}`;
}

/** "1TB01006-006C45 PVO 05 – Rectification work…" – the head office style file name for a pack. */
export function defaultPackFileName(type: PackType, values: PackValues, ref: string, title: string): string {
  const contract = (values.contract_no || values.project_code || "").replace(/\s+/g, "");
  const vendor = String(values.contractor || "")
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !/^(the|of|and|for|co|company|ltd|llc|limited|contracting|trading|est)$/i.test(w))
    .slice(0, 2)
    .join(" ");
  const base = [contract, packRefLabel(type.short, ref), vendor, title].filter(Boolean).join(" - ");
  return base.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 140);
}

/** Normalises a template label for matching: "Contract No.:" → "contract no". */
export function normLabel(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[:.*_…]+$/g, "")
    .replace(/[^a-z0-9'&/\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:.]+$/, "")
    .trim();
}

/** Which field of the pack a template label refers to, if any. */
export function fieldForLabel(type: PackType, label: string): PackField | null {
  const n = normLabel(label);
  if (!n || n.length > 90) return null;
  let best: PackField | null = null;
  let bestLen = 0;
  for (const f of type.fields) {
    const names = [f.label.toLowerCase(), ...(f.aliases ?? [])].map(normLabel);
    for (const a of names) {
      if (!a) continue;
      if (a === n || (n.length >= 4 && (n === a.replace(/\s*\(.*$/, "") || n.replace(/\?$/, "") === a))) {
        if (a.length > bestLen) {
          best = f;
          bestLen = a.length;
        }
      }
    }
  }
  return best;
}
