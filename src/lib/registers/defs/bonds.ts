import type { RegisterDef } from "../types";

export const REQUIREMENT_TYPES = ["% of contract value", "Fixed SAR amount"];
export const EXPIRY_AMBER_DAYS = 60;
export const EXPIRY_RED_DAYS = 30;

export const bonds: RegisterDef = {
  key: "bonds",
  table: "bonds",
  title: "Bonds & Insurance",
  singular: "Bond / Insurance",
  description: "Bonds and insurance policies held for each contract, with the amount required, the amount provided and expiry tracking.",
  displayField: "ref",
  displayFields: ["ref", "policy_no"],
  scope: "programme",
  snapshot: true,
  defaultSort: { field: "expiry_date", dir: "asc" },
  totals: ["original_contract_sum", "required_amount", "amount_provided", "variance"],
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "ref", label: "Ref", type: "text", required: true, unique: true, width: "6rem" },
    { key: "contractor_id", label: "Contractor / Consultant", type: "lookup", lookup: { register: "contractors" }, required: true, filter: true },
    { key: "package_id", label: "Package", type: "lookup", lookup: { register: "packages" }, filter: true },
    { key: "cost_line_id", label: "Cost report line (contract)", type: "lookup", lookup: { register: "cost_lines" }, hideInTable: true, help: "Used to work out the revised contract value." },
    { key: "type_id", label: "Type of bond / insurance", type: "lookup", lookup: { register: "bond_types" }, required: true, filter: true },
    { key: "policy_no", label: "Policy / bond no", type: "text" },
    { key: "issuer", label: "Issued by (bank / insurer)", type: "text", hideInTable: true },
    { key: "original_contract_sum", label: "Original contract sum", type: "money", help: "SAR." },
    { key: "revised_contract_value", label: "Revised contract value", type: "money", virtual: true, readonly: true, hideInForm: true, help: "From Payment Tracking once built; until then the cost report's Committed Costs (column I) for the linked line." },
    { key: "requirement_type", label: "Contract requirement – type", type: "select", options: REQUIREMENT_TYPES, defaultValue: "% of contract value", hideInTable: true },
    { key: "requirement_value", label: "Contract requirement – value", type: "number", hideInTable: true, help: "Enter 10 for 10 % of contract value, or the SAR amount for a fixed requirement." },
    { key: "required_amount", label: "Contract requirement", type: "money", virtual: true, readonly: true, hideInForm: true, help: "% of the revised (or original) contract value, or the fixed SAR amount." },
    { key: "amount_provided", label: "Amount provided", type: "money", help: "SAR. Face value of the bond / policy held." },
    { key: "variance", label: "Variance to contract", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Amount provided − contract requirement. Negative (red) = shortfall." },
    { key: "start_date", label: "Start date", type: "date", hideInTable: true },
    { key: "expiry_date", label: "Expiry date", type: "date", required: true },
    { key: "days_to_expiry", label: "Days to expiry", type: "number", virtual: true, readonly: true, hideInForm: true, help: "Amber within 60 days, red within 30 days or expired." },
    { key: "approved", label: "Approved", type: "boolean", defaultValue: false, filter: true },
    { key: "bank_verification", label: "Bank verification", type: "boolean", defaultValue: false, filter: true },
    { key: "comments", label: "Comments", type: "textarea" },
  ],
};

export const bondRegisters: RegisterDef[] = [bonds];
