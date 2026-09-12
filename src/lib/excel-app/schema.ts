/**
 * The Excel edition's sheets and tables – the single description used by the workbook generator
 * (build.ts) and mirrored by the VBA modules (which address columns by these header names).
 * `key` is the website register field the column is seeded from; `formula` (a structured-reference
 * formula) makes it a calculated column, re-applied by the VBA after every import.
 */
export type ColType = "text" | "money" | "number" | "date" | "bool" | "pct";
export interface Col {
  h: string;
  key?: string;
  type?: ColType;
  width?: number;
  formula?: string;
  /** dropdown list name on the Lists sheet */
  list?: string;
}
export interface TableSpec {
  sheet: string;
  table: string;
  title: string;
  /** website register the rows come from */
  register?: string;
  cols: Col[];
}

const DEAD = (col: string) => `OR([@[${col}]]="Cancelled",[@[${col}]]="Rejected",[@[${col}]]="Superseded",[@[${col}]]="Transferred")`;
const HAS = (p: string) => `OR([@[${p} ref]]<>"",[@[${p} date]]<>"",[@[${p} status]]<>"",[@[${p} amount]]<>"")`;
const LIVE = (p: string) => `AND(${HAS(p)},NOT(${DEAD(`${p} status`)}))`;

export const LEVEL2: TableSpec = {
  sheet: "Level 2",
  table: "tblLevel2",
  title: "Cost Report – Level 2 (Detailed)",
  register: "cost_lines",
  cols: [
    { h: "Code", key: "code", width: 16 },
    { h: "Package", key: "package_id", width: 26 },
    { h: "Name", key: "name", width: 40 },
    { h: "Contractor", key: "contractor_id", width: 28 },
    { h: "Section", key: "section", width: 12, list: "Section" },
    { h: "Category", key: "category_id", width: 22, list: "Category" },
    { h: "Budget hold", key: "is_budget_hold", type: "bool", width: 9, list: "YesNo" },
    { h: "Order", key: "sort_order", type: "number", width: 7 },
    { h: "E", key: "approved_baseline_budget", type: "money" },
    { h: "Opening transfers", key: "opening_transfers", type: "money" },
    { h: "F", type: "money", formula: `=N([@[Opening transfers]])+SUMIFS(tblTransfers[Amount],tblTransfers[To line],[@Code],tblTransfers[Status],"Approved")-SUMIFS(tblTransfers[Amount],tblTransfers[From line],[@Code],tblTransfers[Status],"Approved")` },
    { h: "G", type: "money", formula: `=N([@E])+[@F]` },
    { h: "H", type: "money", formula: `=SUMIFS(tblChanges[Feed amount],tblChanges[Cost line],[@Code],tblChanges[Feed column],"H")` },
    { h: "I", type: "money", formula: `=[@G]+[@H]` },
    { h: "J", type: "money", formula: `=SUMIFS(tblChanges[Feed amount],tblChanges[Cost line],[@Code],tblChanges[Feed column],"J")` },
    { h: "K", type: "money", formula: `=SUMIFS(tblChanges[Feed amount],tblChanges[Cost line],[@Code],tblChanges[Feed column],"K")` },
    { h: "L", type: "money", formula: `=SUMIFS(tblEW[Cost impact],tblEW[Cost line],[@Code],tblEW[Status],"Open")` },
    { h: "M", type: "money", formula: `=SUMIFS(tblClaims[CR amount],tblClaims[Cost line],[@Code])` },
    { h: "N", type: "money", formula: `=[@I]+[@J]+[@K]+[@L]+[@M]` },
    { h: "O", type: "money", formula: `=[@N]-[@G]` },
    { h: "P", type: "money", formula: `=SUMIFS(tblContracts[Latest certified],tblContracts[Cost line],[@Code])` },
    { h: "Q", type: "money", formula: `=[@N]-[@P]` },
    { h: "R", type: "money", formula: `=SUMIFS(tblSnapshots[N],tblSnapshots[Report No],PrevReportNo,tblSnapshots[Code],[@Code])` },
    { h: "S", type: "money", formula: `=[@N]-[@R]` },
    { h: "Notes", key: "notes", width: 30 },
  ],
};

export const CHANGES: TableSpec = {
  sheet: "Changes",
  table: "tblChanges",
  title: "Change Management Tracker",
  register: "changes",
  cols: [
    { h: "Item No", key: "item_no", width: 10 },
    { h: "Description", key: "description", width: 44 },
    { h: "Overall status", key: "overall_status_id", width: 14, list: "Approval status" },
    { h: "Date raised", key: "date_raised", type: "date" },
    { h: "Package", key: "package_id", width: 24 },
    { h: "Contractor", key: "contractor_id", width: 26 },
    { h: "Cost line", key: "cost_line_id", width: 14 },
    { h: "Project stage", key: "project_stage_id", width: 20 },
    { h: "Category", key: "change_category_id", width: 16 },
    { h: "Initiated by", key: "initiated_by_id", width: 12 },
    { h: "Amaala rep", key: "amaala_rep", width: 14 },
    { h: "Action pending by", key: "action_pending_by", width: 16 },
    { h: "Closed date", key: "closed_date", type: "date" },
    { h: "EW ref", key: "ew_ref", width: 12 },
    { h: "EW date", key: "ew_date", type: "date" },
    { h: "RFC ref", key: "rfc_ref", width: 14 },
    { h: "RFC date", key: "rfc_date", type: "date" },
    { h: "RFC status", key: "rfc_status_id", width: 12, list: "Approval status" },
    { h: "RFC time impact", key: "rfc_time_impact", type: "number" },
    { h: "RFC tracker amount", key: "rfc_tracker_amount", type: "money" },
    { h: "RFC amount", key: "rfc_cr_amount", type: "money" },
    { h: "PVO ref", key: "pvo_ref", width: 14 },
    { h: "PVO date", key: "pvo_date", type: "date" },
    { h: "PVO status", key: "pvo_status_id", width: 12, list: "Approval status" },
    { h: "PVO time impact", key: "pvo_time_impact", type: "number" },
    { h: "PVO tracker amount", key: "pvo_tracker_amount", type: "money" },
    { h: "PVO amount", key: "pvo_cr_amount", type: "money" },
    { h: "VO ref", key: "vo_ref", width: 14 },
    { h: "VO date", key: "vo_date", type: "date" },
    { h: "VO status", key: "vo_status_id", width: 12, list: "Approval status" },
    { h: "VO amount", key: "vo_cr_amount", type: "money" },
    { h: "EI ref", key: "ei_ref", width: 14 },
    { h: "EI date", key: "ei_date", type: "date" },
    { h: "DVO ref", key: "dvo_ref", width: 14 },
    { h: "DVO date", key: "dvo_date", type: "date" },
    { h: "DVO status", key: "dvo_status_id", width: 12, list: "Approval status" },
    { h: "DVO tracker amount", key: "dvo_tracker_amount", type: "money" },
    { h: "DVO amount", key: "dvo_cr_amount", type: "money" },
    { h: "DVO closed", key: "dvo_closed", type: "bool", list: "YesNo" },
    { h: "Notes", key: "notes", width: 36 },
    { h: "Feed column", width: 8, formula: `=IF(${DEAD("Overall status")},"",IF(OR([@[DVO status]]="Approved",[@[DVO status]]="Review Complete"),"H",IF(${LIVE("VO")},"J",IF(${LIVE("PVO")},"J",IF(${LIVE("RFC")},"K","")))))` },
    { h: "Feed amount", type: "money", formula: `=IF([@[Feed column]]="H",N([@[DVO amount]]),IF([@[Feed column]]="J",IF(${LIVE("VO")},N([@[VO amount]]),N([@[PVO amount]])),IF([@[Feed column]]="K",N([@[RFC amount]]),0)))` },
    { h: "Closed", width: 7, formula: `=IF(OR([@[DVO closed]]="Yes",[@[Overall status]]="Approved",[@[Overall status]]="Rejected",[@[Overall status]]="Cancelled",[@[Overall status]]="Superseded",[@[Overall status]]="Transferred",[@[Overall status]]="Review Complete"),"Yes","No")` },
  ],
};

export const CLAIMS: TableSpec = {
  sheet: "Claims",
  table: "tblClaims",
  title: "Claims & Disputes",
  register: "claims",
  cols: [
    { h: "Claim No", key: "claim_no", width: 10 },
    { h: "Description", key: "description", width: 44 },
    { h: "Status", key: "status", width: 12, list: "Claim status" },
    { h: "Contractor", key: "contractor_id", width: 26 },
    { h: "Contract No", key: "contract_no", width: 14 },
    { h: "Project", key: "project", width: 16 },
    { h: "Scope", key: "scope", width: 24 },
    { h: "Package", key: "package_id", width: 22 },
    { h: "Cost line", key: "cost_line_id", width: 14 },
    { h: "In cost report", key: "in_cost_report", type: "bool", list: "YesNo" },
    { h: "EOT", key: "type_eot", type: "bool", list: "YesNo" },
    { h: "Prolongation", key: "type_prolongation", type: "bool", list: "YesNo" },
    { h: "Disruption", key: "type_disruption", type: "bool", list: "YesNo" },
    { h: "Acceleration", key: "type_acceleration", type: "bool", list: "YesNo" },
    { h: "Other", key: "type_other", type: "bool", list: "YesNo" },
    { h: "Other – describe", key: "type_other_text", width: 16 },
    { h: "(A) Aware date", key: "notice_aware_date", type: "date" },
    { h: "Notice letter ref", key: "notice_letter_ref", width: 18 },
    { h: "(B) Received date", key: "notice_received_date", type: "date" },
    { h: "Response ref", key: "notice_response_ref", width: 18 },
    { h: "Response date", key: "notice_response_date", type: "date" },
    { h: "Detailed claim ref", key: "detail_letter_ref", width: 18 },
    { h: "(C) Detail received date", key: "detail_received_date", type: "date" },
    { h: "Detailed response ref", key: "detail_response_ref", width: 18 },
    { h: "Detailed response date", key: "detail_response_date", type: "date" },
    { h: "Resubmission ref", key: "resubmission_ref", width: 16 },
    { h: "Resubmission date", key: "resubmission_date", type: "date" },
    { h: "Contractor EOT days", key: "contractor_eot_days", type: "number" },
    { h: "Contractor comp. days", key: "contractor_compensable_days", type: "number" },
    { h: "Contractor cost", key: "contractor_cost", type: "money" },
    { h: "Contractor ref", key: "contractor_ref", width: 16 },
    { h: "Contractor date", key: "contractor_date", type: "date" },
    { h: "Engineer EOT days", key: "engineer_eot_days", type: "number" },
    { h: "Engineer comp. days", key: "engineer_compensable_days", type: "number" },
    { h: "Engineer cost", key: "engineer_cost", type: "money" },
    { h: "Engineer ref", key: "engineer_ref", width: 16 },
    { h: "Engineer date", key: "engineer_date", type: "date" },
    { h: "Employer EOT days", key: "employer_eot_days", type: "number" },
    { h: "Employer comp. days", key: "employer_compensable_days", type: "number" },
    { h: "Employer cost", key: "employer_cost", type: "money" },
    { h: "Employer ref", key: "employer_ref", width: 16 },
    { h: "Employer date", key: "employer_date", type: "date" },
    { h: "Determination EOT days", key: "determination_eot_days", type: "number" },
    { h: "Determination comp. days", key: "determination_compensable_days", type: "number" },
    { h: "Determination cost", key: "determination_cost", type: "money" },
    { h: "Determination ref", key: "determination_ref", width: 16 },
    { h: "Determination date", key: "determination_date", type: "date" },
    { h: "Notes", key: "notes", width: 36 },
    { h: "CR amount", type: "money", formula: `=IF(OR([@Status]="Rejected",[@Status]="Approved incl. in Lump Sum",[@[In cost report]]="No"),0,IF([@[Determination cost]]<>"",N([@[Determination cost]]),IF([@[Employer cost]]<>"",N([@[Employer cost]]),IF([@[Engineer cost]]<>"",N([@[Engineer cost]]),N([@[Contractor cost]])))))` },
  ],
};

export const EW: TableSpec = {
  sheet: "Early Warnings",
  table: "tblEW",
  title: "Early Warnings",
  register: "early_warnings",
  cols: [
    { h: "EW No", key: "ew_no", width: 10 },
    { h: "Date raised", key: "date_raised", type: "date" },
    { h: "Raised by", key: "raised_by", width: 14, list: "Raised by" },
    { h: "Package", key: "package_id", width: 24 },
    { h: "Contractor", key: "contractor_id", width: 26 },
    { h: "Description", key: "description", width: 48 },
    { h: "Time impact (days)", key: "time_impact_days", type: "number" },
    { h: "Cost impact", key: "cost_impact", type: "money" },
    { h: "Likelihood", key: "likelihood", width: 10, list: "Likelihood" },
    { h: "Status", key: "status", width: 12, list: "EW status" },
    { h: "Linked change", key: "change_id", width: 12 },
    { h: "Cost line", key: "cost_line_id", width: 14 },
    { h: "Notes", key: "notes", width: 30 },
  ],
};

export const RISKS: TableSpec = {
  sheet: "Risks",
  table: "tblRisks",
  title: "Risks & Opportunities",
  register: "risks",
  cols: [
    { h: "No", key: "ro_no", width: 10 },
    { h: "Type", key: "type", width: 12, list: "Risk type" },
    { h: "Description", key: "description", width: 48 },
    { h: "Package", key: "package_id", width: 22 },
    { h: "Cause", key: "cause", width: 24 },
    { h: "Mitigation", key: "mitigation", width: 30 },
    { h: "Owner", key: "owner", width: 14 },
    { h: "Probability %", key: "probability", type: "number" },
    { h: "Cost impact", key: "cost_impact", type: "money" },
    { h: "Time impact (days)", key: "time_impact_days", type: "number" },
    { h: "Status", key: "status", width: 12, list: "Risk status" },
    { h: "Date", key: "date", type: "date" },
    { h: "Notes", key: "notes", width: 30 },
    { h: "Expected value", type: "money", formula: `=IF(ISNUMBER([@[Probability %]]),N([@[Cost impact]])*[@[Probability %]]/100,N([@[Cost impact]])*0.5)` },
  ],
};

export const PS: TableSpec = {
  sheet: "Provisional Sums",
  table: "tblPS",
  title: "Provisional Sums",
  register: "provisional_sums",
  cols: [
    { h: "Item", key: "item", width: 8 },
    { h: "Description", key: "description", width: 44 },
    { h: "Status", key: "status_id", width: 12, list: "PS status" },
    { h: "Contractor", key: "contractor_id", width: 26 },
    { h: "Package", key: "package_id", width: 22 },
    { h: "Budget", key: "budget", type: "money" },
    { h: "Contract value", key: "contract_value", type: "money" },
    { h: "Comments", key: "comments", width: 30 },
    { h: "(Saving) / extra", type: "money", formula: `=IF([@[Contract value]]="","",[@[Contract value]]-N([@Budget]))` },
  ],
};

export const BONDS: TableSpec = {
  sheet: "Bonds",
  table: "tblBonds",
  title: "Bonds & Insurance",
  register: "bonds",
  cols: [
    { h: "Ref", key: "ref", width: 8 },
    { h: "Contractor", key: "contractor_id", width: 26 },
    { h: "Package", key: "package_id", width: 22 },
    { h: "Cost line", key: "cost_line_id", width: 14 },
    { h: "Type", key: "type_id", width: 24, list: "Bond type" },
    { h: "Policy no", key: "policy_no", width: 16 },
    { h: "Issuer", key: "issuer", width: 20 },
    { h: "Original contract sum", key: "original_contract_sum", type: "money" },
    { h: "Requirement type", key: "requirement_type", width: 16, list: "Requirement type" },
    { h: "Requirement value", key: "requirement_value", type: "number" },
    { h: "Amount provided", key: "amount_provided", type: "money" },
    { h: "Start date", key: "start_date", type: "date" },
    { h: "Expiry date", key: "expiry_date", type: "date" },
    { h: "Contract closed", key: "contract_closed", type: "bool", list: "YesNo" },
    { h: "Approved", key: "approved", type: "bool", list: "YesNo" },
    { h: "Bank verification", key: "bank_verification", type: "bool", list: "YesNo" },
    { h: "Comments", key: "comments", width: 30 },
    { h: "Revised contract value", type: "money", formula: `=IF([@[Cost line]]="",N([@[Original contract sum]]),IF(COUNTIF(tblContracts[Cost line],[@[Cost line]])>0,SUMIFS(tblContracts[Revised value],tblContracts[Cost line],[@[Cost line]]),IF([@[Original contract sum]]<>"",[@[Original contract sum]],SUMIFS(tblLevel2[I],tblLevel2[Code],[@[Cost line]]))))` },
    { h: "Required amount", type: "money", formula: `=IF([@[Requirement value]]="","",IF([@[Requirement type]]="Fixed SAR amount",[@[Requirement value]],[@[Revised contract value]]*[@[Requirement value]]/100))` },
    { h: "Variance", type: "money", formula: `=IF(OR([@[Required amount]]="",[@[Amount provided]]=""),"",[@[Amount provided]]-[@[Required amount]])` },
    { h: "Days to expiry", type: "number", formula: `=IF([@[Expiry date]]="","",[@[Expiry date]]-TODAY())` },
    { h: "Released", width: 8, formula: `=IF(OR([@[Contract closed]]="Yes",IF([@[Cost line]]="",FALSE,COUNTIFS(tblFA[Cost line],[@[Cost line]],tblFA[Status],"Closed")+COUNTIFS(tblFA[Cost line],[@[Cost line]],tblFA[Status],"Not Required")+COUNTIFS(tblFA[Cost line],[@[Cost line]],tblFA[Status],"Direct Payment – No FA")+COUNTIFS(tblContracts[Cost line],[@[Cost line]],tblContracts[Status],"Closed")>0)),"Yes","No")` },
    { h: "Status", width: 22, formula: `=IF([@Released]="Yes","Released (contract closed)",IF([@[Days to expiry]]="","Active",IF([@[Days to expiry]]<0,"Expired",IF([@[Days to expiry]]<=ExpiryAmberDays,"Expiring","Active"))))` },
  ],
};

export const CONTRACTS: TableSpec = {
  sheet: "Contracts",
  table: "tblContracts",
  title: "Contracts – payment summary",
  register: "contracts",
  cols: [
    { h: "SR No", key: "sr_no", type: "number", width: 6 },
    { h: "Title", key: "title", width: 36 },
    { h: "PR No", key: "reef_pr_no", width: 10 },
    { h: "PO No", key: "reef_po_no", width: 12 },
    { h: "ACC ref", key: "acc_ref", width: 10 },
    { h: "Contractor", key: "contractor_id", width: 26 },
    { h: "Package", key: "package_id", width: 22 },
    { h: "Cost line", key: "cost_line_id", width: 14 },
    { h: "Scope", key: "scope_of_work", width: 30 },
    { h: "Status", key: "current_status", width: 10, list: "Contract status" },
    { h: "Original completion", key: "original_completion_date", type: "date" },
    { h: "EOT days", key: "eot_granted_days", type: "number" },
    { h: "Original contract", key: "original_contract", type: "money" },
    { h: "FA adjustment", key: "final_account_adjustment", type: "money" },
    { h: "Advance %", key: "advance_recovery_pct", type: "number" },
    { h: "Retention %", key: "retention_pct", type: "number" },
    { h: "VAT %", key: "vat_pct", type: "number" },
    { h: "IPC days", key: "ipc_days", type: "number" },
    { h: "Payment days", key: "payment_days", type: "number" },
    { h: "Transaction No", key: "transaction_no", width: 14 },
    { h: "Coding", key: "coding", width: 12 },
    { h: "CBS", key: "cbs", width: 10 },
    { h: "Notes", key: "notes", width: 30 },
    { h: "Revised completion", type: "date", formula: `=IF([@[Original completion]]="","",[@[Original completion]]+N([@[EOT days]]))` },
    { h: "Approved VOs", type: "money", formula: `=IF([@[Cost line]]="",0,SUMIFS(tblChanges[Feed amount],tblChanges[Cost line],[@[Cost line]],tblChanges[Feed column],"H"))` },
    { h: "Approved claims", type: "money", formula: `=IF([@[Cost line]]="",0,SUMIFS(tblClaims[Determination cost],tblClaims[Cost line],[@[Cost line]],tblClaims[Status],"Approved*")-SUMIFS(tblClaims[Determination cost],tblClaims[Cost line],[@[Cost line]],tblClaims[Status],"Approved incl. in Lump Sum"))` },
    { h: "Revised value", type: "money", formula: `=N([@[Original contract]])+[@[Approved VOs]]+[@[Approved claims]]+N([@[FA adjustment]])` },
    { h: "Latest claimed", type: "money", formula: `=IF(COUNTIF(tblIPC[Contract],[@[PO No]])=0,0,MAXIFS(tblIPC[Cum. claimed],tblIPC[Contract],[@[PO No]]))` },
    { h: "Latest certified", type: "money", formula: `=IF(COUNTIF(tblIPC[Contract],[@[PO No]])=0,0,MAXIFS(tblIPC[Cum. certified],tblIPC[Contract],[@[PO No]]))` },
    { h: "% certified", type: "pct", formula: `=IF([@[Revised value]]>0,[@[Latest certified]]/[@[Revised value]],"")` },
    { h: "Net paid", type: "money", formula: `=SUMIFS(tblIPC[Net payment],tblIPC[Contract],[@[PO No]],tblIPC[Paid date],"<>")` },
    { h: "Applications", type: "number", formula: `=COUNTIF(tblIPC[Contract],[@[PO No]])` },
  ],
};

const CONTRACT_PARAM = (col: string, dflt: number) => `IFERROR(INDEX(tblContracts[${col}],MATCH([@Contract],tblContracts[PO No],0)),${dflt})`;

export const IPC: TableSpec = {
  sheet: "IPCs",
  table: "tblIPC",
  title: "IPC log – payment applications",
  register: "payment_applications",
  cols: [
    { h: "Contract", key: "contract_id", width: 12 },
    { h: "SR", key: "sr_no", type: "number", width: 5 },
    { h: "Application No", key: "application_no", width: 14 },
    { h: "Month", key: "month", width: 9 },
    { h: "Application ref", key: "application_aconex_ref", width: 22 },
    { h: "Application date", key: "application_date", type: "date" },
    { h: "Cum. claimed", key: "cumulative_claimed", type: "money" },
    { h: "IPC No", key: "ipc_no", width: 8 },
    { h: "IPC ref", key: "ipc_aconex_ref", width: 22 },
    { h: "IPC date", key: "ipc_date", type: "date" },
    { h: "Cum. certified", key: "cumulative_certified", type: "money" },
    { h: "Invoice ref", key: "invoice_aconex_ref", width: 22 },
    { h: "Invoice date", key: "invoice_date", type: "date" },
    { h: "Paid date", key: "paid_date", type: "date" },
    { h: "Comments", key: "comments", width: 24 },
    { h: "Gross claimed", type: "money", formula: `=IF([@[Cum. claimed]]="","",[@[Cum. claimed]]-IFERROR(MAXIFS([Cum. claimed],[Contract],[@Contract],[Application date],"<"&[@[Application date]]),0))` },
    { h: "Gross certified", type: "money", formula: `=IF([@[Cum. certified]]="","",[@[Cum. certified]]-IFERROR(MAXIFS([Cum. certified],[Contract],[@Contract],[Application date],"<"&[@[Application date]]),0))` },
    { h: "Net certified", type: "money", formula: `=IF([@[Gross certified]]="","",[@[Gross certified]]*(1-${CONTRACT_PARAM("Advance %", 0)}/100-${CONTRACT_PARAM("Retention %", 0)}/100))` },
    { h: "VAT", type: "money", formula: `=IF([@[Net certified]]="","",[@[Net certified]]*${CONTRACT_PARAM("VAT %", 15)}/100)` },
    { h: "Final amount", type: "money", formula: `=IF([@[Net certified]]="","",[@[Net certified]]+[@VAT])` },
    { h: "Net payment", type: "money", formula: `=IF([@[Net certified]]="",0,[@[Net certified]])` },
    { h: "IPC due", type: "date", formula: `=IF([@[Application date]]="","",[@[Application date]]+${CONTRACT_PARAM("IPC days", 28)})` },
    { h: "IPC days late", type: "number", formula: `=IF(OR([@[IPC due]]="",[@[IPC date]]=""),"",[@[IPC date]]-[@[IPC due]])` },
    { h: "Payment due", type: "date", formula: `=IF([@[IPC date]]="","",[@[IPC date]]+${CONTRACT_PARAM("Payment days", 30)})` },
    { h: "Payment days late", type: "number", formula: `=IF(OR([@[Payment due]]="",[@[Paid date]]=""),"",[@[Paid date]]-[@[Payment due]])` },
  ],
};

export const FA: TableSpec = {
  sheet: "Final Accounts",
  table: "tblFA",
  title: "Final Account Status",
  register: "final_accounts",
  cols: [
    { h: "ACC code", key: "acc_ref", width: 14 },
    { h: "Description", key: "description", width: 36 },
    { h: "Contractor", key: "contractor_id", width: 26 },
    { h: "Type", key: "type", width: 12, list: "Party type" },
    { h: "Cost line", key: "cost_line_id", width: 14 },
    { h: "Contract", key: "contract_id", width: 12 },
    { h: "Responsible", key: "responsible", width: 14 },
    { h: "Forecast closure", key: "forecast_closure_date", type: "date" },
    { h: "Status", key: "status", width: 20, list: "FA status" },
    { h: "FA statement ref", key: "fa_statement_ref", width: 20 },
    { h: "Closed date", key: "closed_date", type: "date" },
    { h: "Comments", key: "comments", width: 30 },
    { h: "Committed (I)", type: "money", formula: `=IF([@[Cost line]]="","",SUMIFS(tblLevel2[I],tblLevel2[Code],[@[Cost line]]))` },
    { h: "AFA (N)", type: "money", formula: `=IF([@[Cost line]]="","",SUMIFS(tblLevel2[N],tblLevel2[Code],[@[Cost line]]))` },
    { h: "Uncommitted (N−I)", type: "money", formula: `=IF([@[Cost line]]="","",[@[AFA (N)]]-[@[Committed (I)]])` },
    { h: "Days remaining", type: "number", formula: `=IF([@[Forecast closure]]="","",[@[Forecast closure]]-TODAY())` },
  ],
};

export const TRANSFERS: TableSpec = {
  sheet: "Transfers",
  table: "tblTransfers",
  title: "Budget Transfers",
  register: "budget_transfers",
  cols: [
    { h: "Item", key: "item", width: 8 },
    { h: "Description", key: "description", width: 40 },
    { h: "Status", key: "status", width: 10, list: "Transfer status" },
    { h: "From package", key: "from_package_id", width: 24 },
    { h: "From line", key: "from_cost_line_id", width: 14 },
    { h: "To package", key: "to_package_id", width: 24 },
    { h: "To line", key: "to_cost_line_id", width: 14 },
    { h: "Amount", key: "amount", type: "money" },
    { h: "Date", key: "date", type: "date" },
    { h: "Approval ref", key: "approval_ref", width: 18 },
    { h: "Notes", key: "notes", width: 30 },
  ],
};

export const CASHFLOW: TableSpec = {
  sheet: "Cash Flow",
  table: "tblCashFlow",
  title: "Cash Flow – forecast vs actual",
  cols: [
    { h: "Month", type: "date", width: 10 },
    { h: "Forecast", type: "money" },
    { h: "Actual", type: "money", formula: `=SUMIFS(tblIPC[Net payment],tblIPC[Paid date],">="&[@Month],tblIPC[Paid date],"<"&EDATE([@Month],1))` },
    { h: "Difference", type: "money", formula: `=[@Actual]-N([@Forecast])` },
    { h: "Cum. forecast", type: "money", formula: `=SUMIFS([Forecast],[Month],"<="&[@Month])` },
    { h: "Cum. actual", type: "money", formula: `=SUMIFS([Actual],[Month],"<="&[@Month])` },
  ],
};

export const ACTIONS: TableSpec = {
  sheet: "Actions",
  table: "tblActions",
  title: "Minutes of meeting – items and actions",
  register: "actions",
  cols: [
    { h: "Item No", key: "item_no", width: 12 },
    { h: "Meeting", key: "meeting_id", width: 14 },
    { h: "Topic", key: "topic", width: 24 },
    { h: "Discussion", key: "discussion", width: 40 },
    { h: "Action", key: "action", width: 40 },
    { h: "Owner", key: "owner", width: 16 },
    { h: "Due date", key: "due_date", type: "date" },
    { h: "Status", key: "status", width: 12, list: "Action status" },
    { h: "Closed date", key: "closed_date", type: "date" },
    { h: "Latest update", key: "update", width: 30 },
  ],
};

export const PERIODS: TableSpec = {
  sheet: "Periods",
  table: "tblPeriods",
  title: "Reporting periods",
  register: "reporting_periods",
  cols: [
    { h: "Report No", key: "report_no", type: "number", width: 9 },
    { h: "Label", key: "label", width: 30 },
    { h: "Period start", key: "period_start", type: "date" },
    { h: "Period end", key: "period_end", type: "date" },
    { h: "Status", key: "status", width: 9, list: "Period status" },
    { h: "Locked at", key: "locked_at", width: 18 },
    { h: "Locked by", key: "locked_by", width: 18 },
    { h: "Source file", key: "source_file", width: 30 },
    { h: "Imported at", key: "imported_at", width: 18 },
    { h: "Imported by", key: "imported_by", width: 18 },
    { h: "Key issues", key: "key_issues", width: 40 },
    { h: "Prepared by", key: "prepared_by", width: 16 },
    { h: "Reviewed by", key: "reviewed_by", width: 16 },
    { h: "Approved by", key: "approved_by", width: 16 },
    { h: "Aconex ref", key: "aconex_ref", width: 18 },
  ],
};

export const SNAPSHOTS: TableSpec = {
  sheet: "Snapshots",
  table: "tblSnapshots",
  title: "Stored copies of the cost report (one block per issued report)",
  cols: [
    { h: "Report No", type: "number", width: 9 },
    // every Level 2 column, as values (formula columns are re-applied when a report is loaded back)
    ...LEVEL2.cols.map((c) => ({ h: c.h, type: c.type, width: c.width })),
  ],
};

export const USERS: TableSpec = {
  sheet: "Users",
  table: "tblUsers",
  title: "Users",
  cols: [
    { h: "Name", width: 24 },
    { h: "Email", width: 30 },
    { h: "Role", width: 12, list: "Role" },
    { h: "Active", width: 8, list: "YesNo" },
    { h: "Password hash", width: 40 },
    { h: "Must change", width: 10, list: "YesNo" },
    { h: "Last login", width: 18 },
  ],
};

export const ACTIVITY: TableSpec = {
  sheet: "Activity",
  table: "tblActivity",
  title: "Activity log",
  cols: [
    { h: "When", width: 18 },
    { h: "User", width: 22 },
    { h: "Action", width: 24 },
    { h: "Details", width: 80 },
  ],
};

export const FORMULAS: TableSpec = {
  sheet: "Lists",
  table: "tblFormulas",
  title: "Calculated columns (applied by the workbook after each import)",
  cols: [
    { h: "Table", width: 16 },
    { h: "Column", width: 22 },
    { h: "Formula", width: 120 },
  ],
};

export const REGISTER_TABLES: TableSpec[] = [LEVEL2, CHANGES, CLAIMS, EW, RISKS, PS, BONDS, CONTRACTS, IPC, FA, TRANSFERS, CASHFLOW, ACTIONS];
export const ALL_TABLES: TableSpec[] = [PERIODS, ...REGISTER_TABLES, SNAPSHOTS, USERS, ACTIVITY];

/** Dropdown lists on the Lists sheet. */
export const LISTS: Record<string, string[]> = {
  YesNo: ["Yes", "No"],
  Section: ["Committed", "Uncommitted"],
  Category: ["Professional Services", "Management Supervision", "Commercial Management", "Early Works", "Construction Works", "Client Costs", "FF&E & OS&E"],
  "Approval status": ["Approved", "Rejected", "Pending", "Revised & Re-submit", "Superseded", "Cancelled", "Transferred", "Review Complete"],
  "Claim status": ["Pending", "Approved", "Rejected", "Approved incl. in Lump Sum", "Approved (Authority)", "Approved (proceed to ERI)"],
  "EW status": ["Open", "Converted to RFC", "Closed"],
  "Raised by": ["Contractor", "Consultant", "Engineer", "Employer", "Authority", "Commercial Team", "Other"],
  Likelihood: ["Low", "Med", "High"],
  "Risk type": ["Risk", "Opportunity"],
  "Risk status": ["Open", "Mitigating", "Closed", "Realised"],
  "PS status": ["Approved", "Pending", "Expended", "Partially Expended", "Not Active"],
  "Bond type": ["Performance Bond", "Advance Payment Bond", "Retention Bond", "Contractors All Risks", "Employer's Liability", "Public/Third Party Liability", "Professional Indemnity", "Marine & Hull", "Plant & Equipment", "Motor Vehicle Liability", "Workmen's Compensation", "Trade License", "Protection & Indemnity"],
  "Requirement type": ["% of contract value", "Fixed SAR amount"],
  "Contract status": ["Active", "Completed", "Suspended", "Terminated", "Closed"],
  "FA status": ["Open", "Closed", "Not Required", "Direct Payment – No FA"],
  "Party type": ["Contractor", "Consultant", "Supplier", "Insurer"],
  "Transfer status": ["Pending", "Approved", "Rejected", "Cancelled"],
  "Action status": ["Open", "In progress", "Closed"],
  "Period status": ["Open", "Locked"],
  Role: ["admin", "editor", "contributor", "viewer", "reporter"],
};
