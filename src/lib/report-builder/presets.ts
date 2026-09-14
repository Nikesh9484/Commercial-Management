import type { Condition, ReportSpec } from "./types";

/**
 * The one-click starting points offered beside each report. A preset only ever sets the filter,
 * grouping and sort – everything it does can then be changed by hand, so it is a starting point
 * rather than a fixed report.
 */

type Recipe = { conditions: Condition[]; groupBy?: string | null; sort?: { field: string; dir: "asc" | "desc" }[] };

const RECIPES: Record<string, Record<string, Recipe>> = {
  payments_due: {
    overdue: { conditions: [{ field: "bucket", op: "in", values: ["Overdue"] }], groupBy: "contractor", sort: [{ field: "days", dir: "asc" }] },
    urgent: { conditions: [{ field: "bucket", op: "in", values: ["Overdue", "Due within 14 days"] }], groupBy: "bucket", sort: [{ field: "days", dir: "asc" }] },
    no_invoice: { conditions: [{ field: "bucket", op: "in", values: ["Certified – invoice not yet raised"] }], groupBy: "contractor", sort: [{ field: "total_due", dir: "desc" }] },
  },
  eot_tracker: {
    open: { conditions: [{ field: "state", op: "in", values: ["Open"] }], groupBy: "pending_with", sort: [{ field: "days_since", dir: "desc" }] },
    stuck: { conditions: [{ field: "state", op: "in", values: ["Open"] }, { field: "days_since", op: "num_gte", value: 31 }], groupBy: "pending_with", sort: [{ field: "days_since", dir: "desc" }] },
    overdue_target: { conditions: [{ field: "state", op: "in", values: ["Open"] }, { field: "target_date", op: "overdue" }], groupBy: "owner", sort: [{ field: "days_to_target", dir: "asc" }] },
    ours: { conditions: [{ field: "state", op: "in", values: ["Open"] }, { field: "pending_with", op: "not_contains", value: "Contractor" }], groupBy: "pending_with", sort: [{ field: "days_since", dir: "desc" }] },
  },
  attention: {
    critical: { conditions: [{ field: "severity", op: "in", values: ["Critical"] }], groupBy: "module", sort: [{ field: "priority", dir: "desc" }] },
    money: { conditions: [{ field: "value", op: "num_gte", value: 1 }], groupBy: "module", sort: [{ field: "value", dir: "desc" }] },
    week: { conditions: [{ field: "days", op: "num_between", value: -7, value2: 7 }], groupBy: "module", sort: [{ field: "days", dir: "asc" }] },
  },
  scorecard: {
    attention: { conditions: [{ field: "health", op: "in", values: ["Watch"] }], groupBy: null, sort: [{ field: "revised_value", dir: "desc" }] },
    closing: { conditions: [{ field: "pct_certified", op: "num_gte", value: 90 }], groupBy: null, sort: [{ field: "pct_certified", dir: "desc" }] },
    big: { conditions: [{ field: "revised_value", op: "num_gte", value: 10_000_000 }], groupBy: "contractor", sort: [{ field: "revised_value", dir: "desc" }] },
  },
  value_bridge: {
    moved: { conditions: [{ field: "direction", op: "not_in", values: ["No movement"] }], groupBy: null, sort: [{ field: "movement", dir: "desc" }] },
    up10: { conditions: [{ field: "movement_pct", op: "num_gte", value: 10 }], groupBy: null, sort: [{ field: "movement_pct", dir: "desc" }] },
    stage2: { conditions: [{ field: "fa_adjustment", op: "not_blank" }], groupBy: null, sort: [{ field: "fa_adjustment", dir: "desc" }] },
  },
  bonds: {
    expired: { conditions: [{ field: "days_to_expiry", op: "num_lte", value: -1 }], groupBy: "contractor_id", sort: [{ field: "days_to_expiry", dir: "asc" }] },
    expiring30: { conditions: [{ field: "days_to_expiry", op: "num_between", value: 0, value2: 30 }], groupBy: "type_id", sort: [{ field: "days_to_expiry", dir: "asc" }] },
    shortfall: { conditions: [{ field: "variance", op: "num_lte", value: -1 }], groupBy: "contractor_id", sort: [{ field: "variance", dir: "asc" }] },
  },
  changes: {
    open: { conditions: [{ field: "overall_status_id", op: "not_in", values: ["Approved", "Rejected", "Cancelled", "Superseded", "Transferred"] }], groupBy: "overall_status_id", sort: [{ field: "date_raised", dir: "asc" }] },
    stale60: { conditions: [{ field: "overall_status_id", op: "not_in", values: ["Approved", "Rejected", "Cancelled", "Superseded", "Transferred"] }, { field: "date_raised", op: "date_before", value: daysAgo(60) }], groupBy: "contractor_id", sort: [{ field: "date_raised", dir: "asc" }] },
    big: { conditions: [{ field: "dvo_tracker_amount", op: "num_gte", value: 1_000_000 }], groupBy: "contractor_id", sort: [{ field: "dvo_tracker_amount", dir: "desc" }] },
  },
  claims: {
    open: { conditions: [{ field: "status", op: "not_in", values: ["Approved", "Rejected", "Approved incl. in Lump Sum", "Approved (Authority)", "Approved (proceed to ERI)"] }], groupBy: "action_with", sort: [{ field: "contractor_cost_view", dir: "desc" }] },
    disputed: { conditions: [{ field: "nod_issued", op: "is_true" }], groupBy: "contractor_id", sort: [{ field: "contractor_cost_view", dir: "desc" }] },
  },
  payment_applications: {
    unpaid: { conditions: [{ field: "paid_date", op: "blank" }, { field: "net_certified", op: "num_gte", value: 1 }], groupBy: "contract_id", sort: [{ field: "payment_due_date", dir: "asc" }] },
    late: { conditions: [{ field: "payment_days_late", op: "num_gte", value: 1 }], groupBy: "contract_id", sort: [{ field: "payment_days_late", dir: "desc" }] },
    uncertified: { conditions: [{ field: "ipc_date", op: "blank" }, { field: "application_date", op: "not_blank" }], groupBy: "contract_id", sort: [{ field: "application_date", dir: "asc" }] },
  },
  early_warnings: {
    open: { conditions: [{ field: "status", op: "in", values: ["Open"] }], groupBy: "contractor_id", sort: [{ field: "cost_impact", dir: "desc" }] },
    costly: { conditions: [{ field: "cost_impact", op: "num_gte", value: 500_000 }], groupBy: "contractor_id", sort: [{ field: "cost_impact", dir: "desc" }] },
  },
  final_accounts: {
    open: { conditions: [{ field: "status", op: "in", values: ["Open"] }], groupBy: "responsible", sort: [{ field: "forecast_closure_date", dir: "asc" }] },
  },
  contracts: {
    active: { conditions: [{ field: "current_status", op: "in", values: ["Active"] }], groupBy: "contractor_id", sort: [{ field: "revised_contract_value", dir: "desc" }] },
    nearly: { conditions: [{ field: "pct_certified", op: "num_gte", value: 90 }], groupBy: null, sort: [{ field: "pct_certified", dir: "desc" }] },
  },
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Applies a preset to a spec in place. Unknown presets are ignored. */
export function applyPreset(spec: ReportSpec, presetId: string): ReportSpec {
  const recipe = RECIPES[spec.source]?.[presetId];
  if (!recipe) return spec;
  spec.conditions = recipe.conditions.map((c) => ({ ...c }));
  if (recipe.groupBy !== undefined) spec.groupBy = recipe.groupBy;
  if (recipe.sort) spec.sort = recipe.sort.map((s) => ({ ...s }));
  return spec;
}

/** The preset recipe, for the page to show what a preset will do before it is applied. */
export function presetConditions(source: string, presetId: string): Condition[] {
  return RECIPES[source]?.[presetId]?.conditions ?? [];
}
