import type { RegisterDef } from "../types";

export const EW_STATUSES = ["Open", "Converted to RFC", "Closed"];
export const RAISED_BY = ["Contractor", "Consultant", "Engineer", "Employer", "Authority", "Commercial Team", "Other"];

export const earlyWarnings: RegisterDef = {
  key: "early_warnings",
  table: "early_warnings",
  title: "Early Warnings",
  singular: "Early Warning",
  description: "Early warning notices with potential time and cost impact. Open items feed column L of the cost report.",
  displayField: "ew_no",
  displayFields: ["ew_no", "description"],
  scope: "programme",
  snapshot: true,
  defaultSort: { field: "ew_no", dir: "asc" },
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "ew_no", label: "EW No", type: "text", required: true, unique: true, width: "7rem" },
    { key: "date_raised", label: "Date raised", type: "date", required: true },
    { key: "raised_by", label: "Raised by", type: "select", options: RAISED_BY, filter: true },
    { key: "asset_id", label: "Asset", type: "lookup", lookup: { register: "assets" }, hideInTable: true, filter: true },
    { key: "package_id", label: "Package", type: "lookup", lookup: { register: "packages" }, filter: true },
    { key: "contractor_id", label: "Contractor / Consultant", type: "lookup", lookup: { register: "contractors" }, filter: true },
    { key: "description", label: "Description", type: "textarea", required: true },
    { key: "time_impact_days", label: "Potential time impact (days)", type: "number" },
    { key: "cost_impact", label: "Potential cost impact", type: "money", help: "SAR. Feeds column L of the cost report while the early warning is Open." },
    { key: "likelihood", label: "Likelihood", type: "select", options: ["Low", "Med", "High"], chip: true, filter: true },
    { key: "status", label: "Status", type: "select", options: EW_STATUSES, required: true, defaultValue: "Open", chip: true, filter: true },
    { key: "change_id", label: "Linked change item", type: "lookup", lookup: { register: "changes" }, help: "Once converted, the change tracker carries the value (column K / J / H) instead of column L." },
    { key: "cost_line_id", label: "Cost report line", type: "lookup", lookup: { register: "cost_lines" }, hideInTable: true, help: "Which Level 2 line this early warning feeds (column L)." },
    { key: "notes", label: "Notes", type: "textarea", hideInTable: true },
  ],
};

export const earlyWarningRegisters: RegisterDef[] = [earlyWarnings];
