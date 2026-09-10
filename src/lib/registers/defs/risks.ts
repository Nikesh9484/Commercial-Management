import type { RegisterDef } from "../types";

export const RISK_TYPES = ["Risk", "Opportunity"];
export const RISK_STATUSES = ["Open", "Mitigating", "Closed", "Realised"];

/** Heat-map bands. Probability in %, impact in SAR. */
export const PROBABILITY_BANDS = [
  { label: "Low", max: 33 },
  { label: "Medium", max: 66 },
  { label: "High", max: 100 },
] as const;
export const IMPACT_BANDS = [
  { label: "Low", max: 1_000_000 },
  { label: "Medium", max: 5_000_000 },
  { label: "High", max: Number.POSITIVE_INFINITY },
] as const;

export function bandIndex(value: number, bands: readonly { max: number }[]): number {
  const i = bands.findIndex((b) => value <= b.max);
  return i < 0 ? bands.length - 1 : i;
}

/** Severity of a heat-map cell (0 = low … 2 = high) from its probability and impact bands. */
export function severity(probIdx: number, impactIdx: number): "Low" | "Medium" | "High" {
  const score = probIdx + impactIdx; // 0..4
  return score >= 3 ? "High" : score >= 2 ? "Medium" : "Low";
}

export const risks: RegisterDef = {
  key: "risks",
  table: "risks",
  title: "Risks & Opportunities",
  singular: "Risk / Opportunity",
  description: "Commercial risks and opportunities with probability, cost impact and expected value.",
  displayField: "ro_no",
  displayFields: ["ro_no", "description"],
  scope: "programme",
  snapshot: true,
  defaultSort: { field: "ro_no", dir: "asc" },
  fields: [
    { key: "programme_id", label: "Programme", type: "lookup", lookup: { register: "programmes" }, required: true, hideInTable: true, hideInForm: true },
    { key: "ro_no", label: "No", type: "text", required: true, unique: true, width: "6rem" },
    { key: "type", label: "Type", type: "select", options: RISK_TYPES, required: true, defaultValue: "Risk", chip: true, filter: true },
    { key: "description", label: "Description", type: "textarea", required: true },
    { key: "asset_id", label: "Asset", type: "lookup", lookup: { register: "assets" }, hideInTable: true, filter: true },
    { key: "package_id", label: "Package", type: "lookup", lookup: { register: "packages" }, filter: true },
    { key: "cause", label: "Cause", type: "textarea", hideInTable: true },
    { key: "mitigation", label: "Mitigation / action", type: "textarea", hideInTable: true },
    { key: "owner", label: "Owner", type: "text" },
    { key: "probability", label: "Probability %", type: "percent", help: "0 to 100." },
    { key: "cost_impact", label: "Cost impact", type: "money", help: "SAR. Positive number for both risks (cost) and opportunities (saving)." },
    { key: "expected_value", label: "Expected value", type: "money", virtual: true, readonly: true, hideInForm: true, help: "Probability × cost impact." },
    { key: "rating", label: "Rating", type: "text", virtual: true, readonly: true, hideInForm: true, chip: true },
    { key: "time_impact_days", label: "Time impact (days)", type: "number" },
    { key: "status", label: "Status", type: "select", options: RISK_STATUSES, required: true, defaultValue: "Open", chip: true, filter: true },
    { key: "date", label: "Date", type: "date", required: true },
    { key: "notes", label: "Notes", type: "textarea", hideInTable: true },
  ],
};

export const riskRegisters: RegisterDef[] = [risks];
