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
  /** how many numbered "Other attachment" slots the pack starts with (more can be added on the pack) */
  otherSlots: number;
  /** the sections of the form, in order (group names of the fields) */
  groups: string[];
  /** what the compiled pack is made of, in order – for the category page */
  packOrder: string[];
}

/** The numbered upload slots of one pack: the fixed ones, then "Other attachment n" (baseline plus what was added). */
export function slotsFor(type: PackType, extra = 0): PackSlot[] {
  const fixed = type.slots.filter((s) => !s.key.startsWith("other_"));
  const n = Math.max(0, type.otherSlots + Math.max(0, extra));
  const others: PackSlot[] = [];
  for (let i = 1; i <= n; i++) others.push({ key: `other_${i}`, no: fixed.length + i, label: `Other attachment ${i}`, hint: "Any further file or folder that belongs in the pack" });
  return [...fixed, ...others];
}

/** The slot the last approved document of the same kind goes in – the reference the new one is patterned on. */
export const REFERENCE_SLOT = "reference";

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
    otherSlots: 1,
    packOrder: ["RFC form", "Attachments in their numbered parts"],
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
    description: "The Proposed Variation Order (Stage Gate 3 to 9), built the way the approved PVO packs are: the two-page PVO form, the index of annexures, the draft VO and Employer's Instruction letter, the change assessment pack, the contractual basis, the cost and time particulars, the budget particulars and the change log.",
    source: "changes",
    sourceLabel: "change on the Change Management register",
    otherSlots: 1,
    groups: ["General information", "Particulars of this change", "Estimated cost impact", "Budget particulars", "Contract reconciliation", "Time impact", "Signatures"],
    packOrder: ["PVO form (2 pages)", "Index of annexures", "Annexure 1 – Draft Variation Order and Employer's Instruction letter", "Annexure 2 – Change assessment pack (RFC and revise-and-resubmit updates)", "Annexure 3 – Contractual basis for variation entitlement", "Annexure 4 – Particulars of estimated cost and time impact (cost proposal, drawings)", "Annexure 5 – Budget particulars", "Annexure 6 – Change log", "Other attachments"],
    fields: [
      ...general([text("pvo_no", "Proposed Variation Order no", "General information", true, ["proposed variation order no", "pvo no", "pvo number", "pvo ref"]), text("rfc_ref", "RFC / CRF reference", "General information", true, ["rfc/crf reference", "rfc reference", "crf reference"]), text("item_no", "Dashboard item", "General information", true, ["item no"]), text("revision", "Rev. no", "General information", false, ["rev. no", "rev no", "revision"], "00, 01 …")]),
      text("title", "Title of this variation", "Particulars of this change", true, ["title of this variation", "title", "variation title"]),
      text("eac_included", "Included in the latest EAC?", "Particulars of this change", false, ["is this change included in the latest eac", "included in eac"], "Yes / No"),
      long("scope", "Scope of works / services (brief)", "Particulars of this change", ["scope of works / services", "scope of works", "scope"]),
      long("reason", "Reason for the Proposed Variation Order", "Particulars of this change", ["reason for proposed variation order", "reason"]),
      long("contractual_basis", "Contractual basis for variation entitlement", "Particulars of this change", ["contractual basis for variation entitlement", "contractual basis"], "e.g. Pursuant to Contract Sub-Clause 12.1 [Right to Vary] & 12.3 [Variation Proposal]"),
      long("eac_explanation", "If not in the EAC, the reasoning", "Particulars of this change", ["explain if the topic was included within the eac"]),
      text("root_cause", "Root cause for this change", "Particulars of this change", false, ["root cause for this change", "root cause"], "e.g. Project Management – Scope – gap / omission"),
      text("rom_basis", "Basis of ROM estimate", "Estimated cost impact", false, ["basis of rom estimate", "basis of estimate"], "Existing Contract BoQ rates / New Rates / Mix of both"),
      long("cost_items", "Cost items (reference – description – omit – add)", "Estimated cost impact", ["cost items", "items"], "One item per line, e.g. 1 – Design, engineering and construction of the stairs – 0 – 1,361,487.38"),
      money("omit", "Omit (SAR)", "Estimated cost impact", false, ["omit"]),
      money("add", "Add (SAR)", "Estimated cost impact", true, ["add"]),
      money("total_value", "Total value of this PVO (SAR)", "Estimated cost impact", true, ["total value", "total value (in contract currency)", "total value (in sar)", "this proposed variation order (pvo)", "pvo value"]),
      money("other_contracts", "Impact on other contracts (SAR)", "Estimated cost impact", false, ["sub total (impact on other contracts)", "impact on other contracts"]),
      text("on_account_pct", "Recommended % for on-account payment", "Estimated cost impact", false, ["recommended % for 'on-account' payment for this pvo", "recommended %", "on-account %"]),
      text("on_account_criteria", "RFA criteria for on-account fully met?", "Estimated cost impact", false, ["are the criteria set out in the approved rfa for 'on account' fully met"], "Yes / No / -"),
      text("budget_source", "Budget source", "Budget particulars", false, ["budget source"], "A) No additional budget or budget transfer · B) Budget transfer required · C) Additional budget required"),
      text("budget_line", "From – control account (budget hold)", "Budget particulars", true, ["from", "control account", "budget line", "source of the budget"]),
      money("budget_available", "Current budget available on hold (SAR)", "Budget particulars", true, ["current budget available", "budget available", "current budget"]),
      text("budget_to_line", "To – control account (this contract)", "Budget particulars", true, ["to", "destination of the budget"]),
      money("approved_contract", "Approved contract (SAR)", "Budget particulars", true, ["approved contract"]),
      money("approved_dvos", "Approved DVOs (SAR)", "Budget particulars", true, ["approved dvos"]),
      money("approved_pvos", "Approved PVOs pending DVO (SAR)", "Budget particulars", true, ["approved pvos", "approved pvos (pending dvos)"]),
      money("remaining_budget", "Remaining budget before this PVO (SAR)", "Budget particulars", true, ["remaining budget before this pvo", "remaining budget"]),
      money("revised_budget", "Revised budget after this PVO (SAR)", "Budget particulars", true, ["revised budget"]),
      money("original_contract", "Original contract value (SAR)", "Contract reconciliation", true, ["original contract value", "original contract price", "contract price"]),
      money("current_revised", "Current revised contract value (SAR)", "Contract reconciliation", true, ["current revised contract value", "revised contract value"]),
      money("potential_revised", "Potential revised contract value after this PVO (SAR)", "Contract reconciliation", true, ["potential revised contract value (after this pvo)", "potential revised contract value"]),
      date("original_completion", "Original contract completion date", "Time impact", true, ["original contract completion date", "original completion date"]),
      num("approved_eot", "Approved EOTs (days)", "Time impact", true, ["approved eots (days)", "approved eots", "approved eot"]),
      date("current_completion", "Current revised completion date", "Time impact", true, ["current revised completion date", "revised completion date", "anticipated revised contract completion date"]),
      num("time_impact", "Estimated time impact of this variation (days)", "Time impact", true, ["estimated 'time impact' of this variation (days)", "time impact", "time impact (days)"]),
      num("other_eots", "Other anticipated / un-agreed EOTs (days)", "Time impact", false, ["other anticipated eots / un-agreed eots of the previous pvo/dvo (days)", "other anticipated eots"]),
      long("time_comments", "Comments on time", "Time impact", ["comments"]),
      long("change_log", "Change log (RFC – PVO – VO – DVO – value)", "Contract reconciliation", ["change log"], "Filled from the register: one change per line"),
      text("employer_rep", "Employer's Representative – name (signs the VO)", "Signatures", false, ["employer's representative", "approved and issued by"]),
      text("employer_rep_position", "Employer's Representative – position", "Signatures", false, ["employer's representative position"], "e.g. Head of Construction"),
      text("contractor_rep", "Contractor's Representative – name (receives the VO)", "Signatures", false, ["contractor's representative", "received by"]),
      text("contractor_rep_position", "Contractor's Representative – position", "Signatures", false, ["contractor's representative position"]),
      ...signatures(),
    ],
    slots: [
      { key: "resubmit", no: 1, label: "Revise-and-resubmit updates (if any)", hint: "The workflow comments and the updates made after a revise-and-resubmit" },
      { key: "reference", no: 2, label: "PVO pack template – last approved PVO", hint: "The last approved PVO pack (PDF): its structure, wording and signatories pattern this one" },
      { key: "rfc", no: 3, label: "RFC – Request for Change", hint: "The approved RFC: the scope of work and reason are read from it" },
      { key: "cost", no: 4, label: "Cost proposal – price impact (+ / −)", hint: "The contractor's proposal or the Employer's ROM build-up; the total is read from it" },
      { key: "drawings", no: 5, label: "Drawings", hint: "Marked-up drawings, sketches and specifications" },
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
    otherSlots: 1,
    packOrder: ["Employer's Instruction letter", "VO form", "Attachments in their numbered parts"],
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
    description: "The Employer's determination, built the way the approved DVO packs are: the PVO-to-DVO cost movement summary, the DVO form, the review and recommendation form, the index of annexures, the approved PVO and VO with their workflow approvals, the cost assessment, the budget particulars and the change log.",
    source: "changes",
    sourceLabel: "change on the Change Management register",
    otherSlots: 1,
    groups: ["General information", "Variation", "Determination", "Contract reconciliation", "Extension of time", "Information provided", "Review and recommendation panel", "Signatures"],
    packOrder: ["PVO to DVO cost movement summary", "DVO form (RSG-CM-FRM-0014)", "Review and recommendation form (RSG-CM-FRM-0027)", "Index of annexures", "Annexure 1 – Approved PVO and VO: cover pages and workflow approvals", "Annexure 2 – Cost impact: Employer's assessment and determination (cost proposal, drawings)", "Annexure 3 – Budget particulars", "Annexure 4 – Change log", "Other attachments"],
    fields: [
      ...general([text("dvo_no", "Determination no", "General information", true, ["variation order no", "dvo no", "dvo ref", "determination no"]), text("vo_no", "Variation Order no", "General information", true, ["vo no", "vo ref"]), text("instruction_ref", "Instruction reference (VO letter)", "General information", true, ["instruction reference", "instruction ref", "letter ref"]), text("contract_ref", "Contract ref (ACC)", "General information", true, ["contract ref", "contract ref."]), text("item_no", "Dashboard item", "General information", true, ["item no"]), text("revision", "Rev. no", "General information", false, ["rev. no", "rev no", "revision"])]),
      text("title", "Variation Order title", "Variation", true, ["variation order title", "title"]),
      long("description", "Description of the determination", "Variation", ["description"], "e.g. This DVO 007 confirms the change associated with the following instruction issued: 1. Variation Order No. 07 Ref … dated … for …"),
      long("reason", "Reason for the Variation Order", "Variation", ["reason for variation order", "reason"]),
      long("cost_items", "Cost items (reference – description – omit – add)", "Determination", ["cost items", "items"], "One item per line"),
      money("omit", "Omit (SAR)", "Determination", false, ["omit"]),
      money("add", "Add (SAR)", "Determination", true, ["add"]),
      money("dvo_value", "This Variation Order [d] – determined value (SAR)", "Determination", true, ["this variation order", "total value", "sub-total", "dvo value", "avv"]),
      money("pvo_value", "Approved PVO value (SAR)", "Determination", true, ["pvo value", "approved pvo value"]),
      long("movement_note", "Cost movement note", "Determination", ["cost movement", "movement"], "e.g. The DVO value is lower than the approved PVO value, with a variance of SAR …"),
      money("contract_price", "Contract Price [a] (SAR)", "Contract reconciliation", true, ["contract price", "contract price [a]", "original contract price"]),
      date("commencement_date", "Contract commencement date", "Contract reconciliation", true, ["contract commencement date", "commencement date"]),
      money("previous_dvos", "Sum of previous Determinations [b] (SAR)", "Contract reconciliation", true, ["sum of previous determination of variation orders", "previous dvos", "sum of previous determination of variation orders / adjustments"]),
      money("interim_vos", "Sum of interim value variations [c] (SAR)", "Contract reconciliation", false, ["sum of interim value variations", "interim value variations"]),
      money("revised_contract", "Revised Contract Price [e] (SAR)", "Contract reconciliation", true, ["revised contract price", "revised contract sum"]),
      text("vo_pct", "VO % of original Contract Price [(e−a)/a]", "Contract reconciliation", true, ["vo's % original contract price", "vo % original contract price"]),
      date("original_completion", "Original Contract Completion Date [x]", "Extension of time", true, ["original contract completion date", "original completion date"]),
      num("previous_eot", "Previous approved extension of time (days) [y]", "Extension of time", true, ["previous approved extension of time", "previous eot"]),
      num("this_eot", "This agreed extension of time (days) [z]", "Extension of time", true, ["this agreed extension of time", "this eot", "time impact"]),
      num("total_eot", "Total extension (days) [y+z]", "Extension of time", true, ["total extension", "total extension (days difference to the original contract completion date)"]),
      date("revised_completion", "Revised Contract Completion Date [x+y+z]", "Extension of time", true, ["revised contract completion date", "revised completion date"]),
      long("information_provided", "Information provided with this Determination", "Information provided", ["information provided with this determination of variation order form", "annexure", "document title"], "One document per line: ref – title – rev – date"),
      text("budget_line", "Source of the budget (control account)", "Information provided", true, ["source of the budget", "from"]),
      money("budget_available", "Budget available on hold (SAR)", "Information provided", true, ["budget available", "current budget available"]),
      text("budget_to_line", "Destination of the budget (control account)", "Information provided", true, ["destination of the budget", "to"]),
      long("change_log", "Change log (RFC – PVO – VO – DVO – value)", "Information provided", ["change log"], "Filled from the register: one change per line"),
      long("review_panel", "Review and recommendation panel", "Review and recommendation panel", ["review and recommendation panel", "panel"], "One per line: Position – Name, e.g. Employer's Associate Director - Commercial – Blake Lombard"),
      text("contractor_rep", "Contractor's Representative – name", "Signatures", false, ["contractor's representative", "agreement for final determination", "received by"]),
      text("contractor_rep_position", "Contractor's Representative – position", "Signatures", false, ["contractor's representative position"]),
      text("employer_rep", "Employer's Representative – name", "Signatures", false, ["employer's representative", "final determination by the employer"]),
      text("employer_rep_position", "Employer's Representative – position", "Signatures", false, ["employer's representative position"]),
      ...signatures(),
    ],
    slots: [
      { key: "resubmit", no: 1, label: "Revise-and-resubmit updates (if any)", hint: "The workflow comments and the updates made after a revise-and-resubmit" },
      { key: "reference", no: 2, label: "DVO pack template – last approved DVO", hint: "The last approved DVO pack (PDF): its structure, wording and signatories pattern this one" },
      { key: "pvo", no: 3, label: "Approved PVO of this DVO", hint: "The approved PVO pack: its cover pages and workflow approvals go into Annexure 1" },
      { key: "cost", no: 4, label: "DVO cost proposal – price impact (+ / −)", hint: "The contractor's final proposal and the Employer's assessment; the total is read from it" },
      { key: "drawings", no: 5, label: "Drawings", hint: "Shop drawings, marked-ups and specifications" },
    ],
  },
  {
    key: "rfa",
    label: "RFA – Request for Approval",
    short: "RFA",
    formRef: "RSG-PR-FRM-0004",
    description: "The Request for Approval form as the approved RFAs are laid out: general information and the DoA items, the recommended-for-approval signatories, the description (background, justification, next steps), the attachments list and the appendices.",
    source: "changes",
    sourceLabel: "change on the Change Management register",
    otherSlots: 3,
    groups: ["General information", "Request", "Description", "Recommended for approval", "Signatures"],
    packOrder: ["RFA form – general information and DoA items", "Recommended for approval", "Description – background, justification, next steps", "Attachments list", "Appendices – details, cost details and the other attachments"],
    fields: [
      ...general([text("rfa_no", "RFA form reference", "General information", true, ["rfa form reference", "rfa reference", "rfa no", "reference"]), date("submittal_date", "Submittal date", "General information", true, ["submittal date"]), text("contact", "Contact information", "General information", true, ["contact information", "contact"], "Name (email) Position"), text("item_no", "Dashboard item", "General information", true, ["item no"])]),
      text("subject", "Subject", "Request", true, ["subject", "title", "item"]),
      long("purpose", "Purpose of Request for Approval", "Request", ["purpose of request for approval", "purpose", "description"]),
      long("requested_approvals", "Requested approvals", "Request", ["requested approvals", "approvals requested"], "One per line"),
      text("funding_source", "Project budget / funding source", "Request", true, ["project budget / funding source", "funding source", "budget source"]),
      money("amount", "Amount requested (SAR)", "Request", true, ["amount requested", "amount", "value", "capex"]),
      text("budget_remaining", "Budget remaining to date", "Request", true, ["budget remaining to date", "budget remaining"]),
      text("preferred_tenderer", "Preferred tenderer", "Request", false, ["preferred tenderer"]),
      text("contract_price", "Contract price", "Request", false, ["contract price"], "e.g. Subject to tender and award"),
      long("background", "Background", "Description", ["background"]),
      long("justification", "Justification", "Description", ["justification", "justification for new site", "evaluation"]),
      long("options", "Options considered", "Description", ["options considered", "options"]),
      long("next_steps", "Next steps", "Description", ["next steps"], "One per line"),
      long("attachments", "Attachments", "Description", ["attachments", "appendices"], "One per line: Appendix 1 – title"),
      long("recommended_by", "Recommended for approval", "Recommended for approval", ["recommended for approval", "function"], "One per line: Function – Name, e.g. Executive Director – Commercial – Shane Fairfield"),
      text("executive_approver", "Executive approval – name", "Recommended for approval", false, ["executive approval", "approved by"]),
      text("executive_position", "Executive approval – position", "Recommended for approval", false, ["executive approval position"], "e.g. Group Chief Executive Officer"),
      ...signatures(),
    ],
    slots: [
      { key: "details", no: 1, label: "Details of the RFA", hint: "The brief, the options and the background papers" },
      { key: "reference", no: 2, label: "RFA template – last approved RFA", hint: "The last approved RFA (PDF): its layout, wording and signatories pattern this one" },
      { key: "cost", no: 3, label: "Cost details", hint: "The estimate, the funding agreement or the budget position" },
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
    otherSlots: 1,
    packOrder: ["Stage 2 summary and one-page bridge", "Attachments in their numbered parts"],
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
    description: "The Employer's Assessment Report on a claim for an extension of time, laid out as the issued reports are: cover letter, cover page, revision history, table of contents and the seven numbered sections, with the contractor's submission and the references as appendices.",
    source: "claims",
    sourceLabel: "claim on the Claims & Disputes register",
    otherSlots: 3,
    groups: ["General information", "Cover letter", "Revision history", "Claim", "Report sections", "Signatures"],
    packOrder: ["Cover letter to the contractor (Aconex LTR)", "Report cover page", "Revision history", "Table of contents", "1.0 Executive summary · 2.0 Project summary · 3.0 Relevant contract provisions · 4.0 The Contractor's claim · 5.0 The Employer's assessment · 6.0 Cost assessment · 7.0 Conclusion and recommendation", "Appendices – the contractor's submission, the references and the other attachments"],
    fields: [
      ...general([text("claim_no", "Claim no", "General information", true, ["claim no", "claim ref"]), text("eot_no", "EOT / claim reference", "General information", true, ["eot no", "eot", "claim reference"]), text("revision", "Revision", "General information", false, ["revision", "rev"], "00, 01 …"), text("previous_revision", "Supersedes", "General information", false, ["supersedes"], "e.g. Revision 00 dated 19 July 2026"), text("report_ref", "Report reference (Aconex RPT)", "General information", false, ["report reference", "rpt"], "e.g. 1TB01031-031C15-AMA-RPT-PM-0002"), text("contract_ref", "Contract ref (ACC)", "General information", true, ["contract ref", "contract ref."], "e.g. 1TB01-031C15-7030")]),
      text("letter_ref", "Letter reference (Aconex LTR)", "Cover letter", false, ["letter ref", "letter reference", "ref"], "e.g. 1TB01031-031C15-AMA-LTR-0025"),
      date("letter_date", "Letter date", "Cover letter", true, ["letter date"]),
      long("contractor_address", "Contractor's address", "Cover letter", ["address", "contractor's address"]),
      text("attention", "Attention", "Cover letter", false, ["attention"], "e.g. Mr. Marios Economides, Chairman (Contractor's Representative)"),
      text("claim_letter_ref", "Contractor's claim letter ref", "Cover letter", true, ["claim letter ref", "contractor's letter reference", "detailed claim letter ref", "submission ref"]),
      date("claim_letter_date", "Contractor's claim letter date", "Cover letter", true, ["claim letter date", "detailed claim received", "submission date"]),
      text("clauses", "Clauses relied on", "Cover letter", false, ["clauses", "in accordance with clause"], "e.g. Clause 8.4 and 19.1"),
      text("determination_clause", "Determination clause", "Cover letter", false, ["determination clause"], "e.g. Clause 3.5 [Determinations]"),
      text("signatory", "Letter signed by", "Cover letter", false, ["yours faithfully", "signed by"], "e.g. Fahad Albalawi (Head of Construction), Employer's Representative"),
      long("revision_history", "Revision history", "Revision history", ["revision history", "prepared by", "reviewed by"], "One per line: Prepared by / Reviewed by / Approved by – Name – Position"),
      text("template_rev", "Template revision", "Revision history", false, ["template revision"], "e.g. Template Revision Sep-2025"),
      text("title", "Claim title", "Claim", true, ["claim title", "title"]),
      num("days_claimed", "Days claimed", "Claim", true, ["days claimed", "eot claimed", "contractor eot claimed"]),
      num("days_assessed", "Days assessed", "Claim", true, ["days assessed", "eot assessed", "extension of time assessed"]),
      money("contract_price", "Contract price (SAR)", "Claim", true, ["contract price", "original contract price"]),
      text("contract_date", "Contract dated", "Claim", true, ["contract dated", "contract date"]),
      date("completion_date", "Time for completion (original)", "Claim", true, ["contract completion date", "time for completion", "original completion date"]),
      date("revised_completion_date", "Revised time for completion (previous EOTs)", "Claim", true, ["revised completion date", "revised time for completion"]),
      date("assessed_completion_date", "Assessed time for completion", "Claim", false, ["assessed completion date", "assessed time for completion"]),
      text("notice_ref", "Notice letter ref", "Claim", true, ["notice letter ref", "notice ref", "notice"]),
      date("notice_date", "Notice received", "Claim", true, ["notice received", "notice date"]),
      long("delay_events", "Delay events and their validity", "Claim", ["delay events", "delay event"], "One per line: DE01 – title – clause – valid in principle? – remark"),
      long("executive_summary", "1.0 Executive summary", "Report sections", ["executive summary", "1.0 executive summary"]),
      long("project_summary", "2.0 Project summary", "Report sections", ["project summary", "2.0 project summary"]),
      long("contract_provisions", "3.0 Relevant contract provisions", "Report sections", ["relevant contract provisions", "contract provisions", "3.0 relevant contract provisions"]),
      long("contractor_claim", "4.0 The Contractor's claim", "Report sections", ["the contractor's claim", "contractor's claim", "4.0 the contractor's claim"]),
      long("employer_assessment", "5.0 The Employer's assessment", "Report sections", ["the employer's assessment", "employer's assessment", "assessment", "5.0 the employer's assessment"]),
      long("cost_assessment", "6.0 Cost assessment", "Report sections", ["cost assessment", "6.0 cost assessment"]),
      long("conclusion", "7.0 Conclusion and recommendation", "Report sections", ["conclusion and recommendation", "conclusion", "recommendation", "7.0 conclusion and recommendation"]),
      ...signatures(),
    ],
    slots: [
      { key: "submission", no: 1, label: "Contractor's EOT claim submission", hint: "The claim narrative and its appendices – files or a folder" },
      { key: "reference", no: 2, label: "RSG template – last approved EAR", hint: "The last approved Employer's Assessment Report (PDF): its structure, wording and signatories pattern this one" },
      { key: "previous", no: 3, label: "Old approved EOTs for reference", hint: "Earlier assessments or awards on this contract" },
      { key: "other_asset", no: 4, label: "Approved EOT from another asset or package", hint: "A reference from another contract, for consistency" },
    ],
  },
  {
    key: "cost_ear",
    label: "Cost EAR – Employer's Assessment Report (cost)",
    short: "Cost EAR",
    formRef: "Employer's Assessment Report – Cost",
    description: "The Employer's Assessment Report on a cost claim (prolongation, disruption, acceleration), laid out as the issued reports are: cover letter, cover page, revision history, table of contents and the numbered sections, with the contractor's submission and the references as appendices.",
    source: "claims",
    sourceLabel: "claim on the Claims & Disputes register",
    otherSlots: 3,
    groups: ["General information", "Cover letter", "Revision history", "Claim", "Report sections", "Signatures"],
    packOrder: ["Cover letter to the contractor (Aconex LTR)", "Report cover page", "Revision history", "Table of contents", "1.0 Executive summary · 2.0 Project summary · 3.0 Relevant contract provisions · 4.0 The Contractor's claim · 5.0 The Employer's assessment · 6.0 Cost assessment · 7.0 Conclusion and recommendation", "Appendices – the contractor's submission, the references and the other attachments"],
    fields: [
      ...general([text("claim_no", "Claim no", "General information", true, ["claim no", "claim ref"]), text("eot_no", "EOT / claim reference", "General information", true, ["eot no", "eot", "claim reference"]), text("revision", "Revision", "General information", false, ["revision", "rev"], "00, 01 …"), text("previous_revision", "Supersedes", "General information", false, ["supersedes"], "e.g. Revision 00 dated 19 July 2026"), text("report_ref", "Report reference (Aconex RPT)", "General information", false, ["report reference", "rpt"], "e.g. 1TB01031-031C15-AMA-RPT-PM-0002"), text("contract_ref", "Contract ref (ACC)", "General information", true, ["contract ref", "contract ref."], "e.g. 1TB01-031C15-7030")]),
      text("letter_ref", "Letter reference (Aconex LTR)", "Cover letter", false, ["letter ref", "letter reference", "ref"], "e.g. 1TB01031-031C15-AMA-LTR-0025"),
      date("letter_date", "Letter date", "Cover letter", true, ["letter date"]),
      long("contractor_address", "Contractor's address", "Cover letter", ["address", "contractor's address"]),
      text("attention", "Attention", "Cover letter", false, ["attention"], "e.g. Mr. Marios Economides, Chairman (Contractor's Representative)"),
      text("claim_letter_ref", "Contractor's claim letter ref", "Cover letter", true, ["claim letter ref", "contractor's letter reference", "detailed claim letter ref", "submission ref"]),
      date("claim_letter_date", "Contractor's claim letter date", "Cover letter", true, ["claim letter date", "detailed claim received", "submission date"]),
      text("clauses", "Clauses relied on", "Cover letter", false, ["clauses", "in accordance with clause"], "e.g. Clause 8.4 and 19.1"),
      text("determination_clause", "Determination clause", "Cover letter", false, ["determination clause"], "e.g. Clause 3.5 [Determinations]"),
      text("signatory", "Letter signed by", "Cover letter", false, ["yours faithfully", "signed by"], "e.g. Fahad Albalawi (Head of Construction), Employer's Representative"),
      long("revision_history", "Revision history", "Revision history", ["revision history", "prepared by", "reviewed by"], "One per line: Prepared by / Reviewed by / Approved by – Name – Position"),
      text("template_rev", "Template revision", "Revision history", false, ["template revision"], "e.g. Template Revision Sep-2025"),
      text("title", "Claim title", "Claim", true, ["claim title", "title"]),
      text("claim_type", "Claim type", "Claim", true, ["claim type", "type"]),
      money("amount_claimed", "Amount claimed (SAR)", "Claim", true, ["amount claimed", "claimed"]),
      money("amount_assessed", "Amount assessed (SAR)", "Claim", true, ["amount assessed", "assessed", "determination"]),
      money("contract_price", "Contract price (SAR)", "Claim", true, ["contract price", "original contract price"]),
      text("contract_date", "Contract dated", "Claim", true, ["contract dated", "contract date"]),
      text("notice_ref", "Notice letter ref", "Claim", true, ["notice letter ref", "notice ref"]),
      date("notice_date", "Notice received", "Claim", true, ["notice received", "notice date"]),
      long("heads_of_claim", "Heads of claim and entitlement", "Claim", ["heads of claim", "entitlement"], "One per line: head – claimed – assessed – basis"),
      long("executive_summary", "1.0 Executive summary", "Report sections", ["executive summary", "1.0 executive summary"]),
      long("project_summary", "2.0 Project summary", "Report sections", ["project summary", "2.0 project summary"]),
      long("contract_provisions", "3.0 Relevant contract provisions", "Report sections", ["relevant contract provisions", "contract provisions", "3.0 relevant contract provisions"]),
      long("contractor_claim", "4.0 The Contractor's claim", "Report sections", ["the contractor's claim", "contractor's claim", "4.0 the contractor's claim"]),
      long("employer_assessment", "5.0 The Employer's assessment", "Report sections", ["the employer's assessment", "employer's assessment", "assessment", "5.0 the employer's assessment"]),
      long("cost_assessment", "6.0 Cost assessment", "Report sections", ["cost assessment", "6.0 cost assessment"]),
      long("conclusion", "7.0 Conclusion and recommendation", "Report sections", ["conclusion and recommendation", "conclusion", "recommendation", "7.0 conclusion and recommendation"]),
      ...signatures(),
    ],
    slots: [
      { key: "submission", no: 1, label: "Contractor's cost claim submission", hint: "The claim narrative and its appendices – files or a folder" },
      { key: "reference", no: 2, label: "RSG template – last approved EAR", hint: "The last approved Employer's Assessment Report (PDF): its structure, wording and signatories pattern this one" },
      { key: "previous", no: 3, label: "Old approved assessments for reference", hint: "Earlier assessments or awards on this contract" },
      { key: "other_asset", no: 4, label: "Approved assessment from another asset or package", hint: "A reference from another contract, for consistency" },
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
  /** "Other attachment" slots added beyond the category's baseline */
  extra_slots: number;
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
