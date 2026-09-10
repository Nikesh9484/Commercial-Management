/**
 * Cost report column definitions and result types.
 * Browser-safe: no database imports here (the page and the chart import from this file).
 */
import type { FeedStatus } from "./feeds-types";

/** Column definitions shared by the page and the Excel export. Order = report order. */
export const MONEY_COLUMNS = [
  { key: "E", label: "Approved Baseline Budget", formula: "" },
  { key: "F", label: "Budget Transfers", formula: "auto" },
  { key: "G", label: "Awarded Contract / Latest Budget", formula: "E + F" },
  { key: "H", label: "Determined Variation Orders (DVO)", formula: "auto" },
  { key: "I", label: "Committed Costs", formula: "G + H" },
  { key: "J", label: "Potential Variation Orders (PVO)", formula: "auto" },
  { key: "K", label: "Requests for Change (RFC)", formula: "auto" },
  { key: "L", label: "Early Warnings", formula: "auto" },
  { key: "M", label: "Claims", formula: "auto" },
  { key: "N", label: "Anticipated Final Account", formula: "I + J + K + L + M" },
  { key: "O", label: "Variance to Latest Budget", formula: "N − G" },
  { key: "P", label: "Certified to Date", formula: "auto" },
  { key: "Q", label: "Works to Complete", formula: "N − P" },
  { key: "R", label: "Previous Period Anticipated Final Account", formula: "snapshot" },
  { key: "S", label: "Period Movement", formula: "N − R" },
] as const;

export type MoneyKey = (typeof MONEY_COLUMNS)[number]["key"];
export type Money = Record<MoneyKey, number>;

export interface CostLineRow extends Money {
  id: number;
  asset_id: number;
  asset_code: string;
  asset_name: string;
  code: string;
  package_id: number;
  package: string;
  name: string;
  contractor: string;
  section: "Committed" | "Uncommitted";
  sort_order: number;
  prev_available: boolean;
  /** Level 1 grouping, e.g. Professional Services / Construction Works. */
  category: string;
  /** A budget-hold line absorbs the changes, early warnings and claims of its asset + category. */
  is_budget_hold: boolean;
}

export interface Level1Row extends Money {
  asset_id: number;
  asset_code: string;
  asset_name: string;
  category: string;
  lines: number;
}

export interface CostReport {
  programme: { id: number; code: string; name: string } | null;
  period: { id: number; label: string; status: string } | null;
  previousPeriod: { id: number; label: string; status: string; snapshotAvailable: boolean; note?: string } | null;
  feeds: FeedStatus[];
  lines: CostLineRow[];
  sections: { name: "Committed" | "Uncommitted"; lines: CostLineRow[]; subtotal: Money }[];
  /** Level 2 as on the Excel "Level 02" sheet: one block per asset + cost category with its sub-total, in the order of the categories in Settings. */
  categories: { key: string; label: string; asset_code: string; asset_name: string; category: string; lines: CostLineRow[]; subtotal: Money }[];
  grandTotal: Money;
  level1: Level1Row[];
  level1Total: Money;
  /** Totals of the lines that are not budget hold – the asset costs as reported on the Excel Level 01 sheet. */
  totalsExclHold: Money;
  /** Level 1 total minus Level 2 total, per column – must all be zero. */
  check: Money;
  checkOk: boolean;
  chart: { package: string; baseline: number; afa: number }[];
}

