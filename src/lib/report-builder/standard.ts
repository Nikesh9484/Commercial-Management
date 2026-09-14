import type { Condition, ReportSpec, SummaryBlocks } from "./types";
import { emptySpec } from "./types";

/**
 * The reports the commercial team runs every month, set up ready to go: the right records, the
 * filters already applied, grouped by contractor and with the columns that matter for that report.
 *
 * A standard report is only a starting point – it produces an ordinary set-up on the page, so every
 * filter, column and grouping can still be changed before it is generated. Nothing here uses the AI
 * allowance: the filtering and the wording are worked out by fixed rules on the server.
 */

/** Figures, an ageing summary and the grouped list – the "List with figures" shape on the page. */
const LIST: SummaryBlocks = { kpis: true, narrative: false, attention: false, breakdown: false, ageing: true, table: true };
/** The answer on a single page: figures, the written position, what needs doing. No tables. */
const ONE_PAGER: SummaryBlocks = { kpis: true, narrative: true, attention: true, breakdown: false, ageing: false, table: false };
/** The written summary: the position and the analysis behind it, without the full record list. */
const SUMMARY: SummaryBlocks = { kpis: true, narrative: true, attention: true, breakdown: true, ageing: true, table: false };
/** Everything – the working document that carries the records as well. */
const FULL: SummaryBlocks = { kpis: true, narrative: true, attention: true, breakdown: true, ageing: true, table: true };

export interface StandardReport {
  id: string;
  /** Which block of cards it belongs to on the page. */
  group: "checks" | "smart";
  title: string;
  /** What it answers, in one line, for the card on the page. */
  description: string;
  source: string;
  /** Built at the moment it is applied, so a "this month" report uses the reporting period in the top bar. */
  build: (periodEnd: string) => { conditions: Condition[]; groupBy: string | null; sort: { field: string; dir: "asc" | "desc" }[]; columns: string[]; blocks: SummaryBlocks; title: string };
  /** Said on the card when the report leans on a field the team has to keep up to date. */
  needs?: string;
}

/** First and last day of the month the reporting period ends in. */
function monthOf(periodEnd: string): { from: string; to: string; label: string } {
  const d = periodEnd && /^\d{4}-\d{2}/.test(periodEnd) ? periodEnd : new Date().toISOString().slice(0, 10);
  const [y, m] = d.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const two = (n: number) => String(n).padStart(2, "0");
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return { from: `${y}-${two(m)}-01`, to: `${y}-${two(m)}-${two(last)}`, label };
}

export const STANDARD_REPORTS: StandardReport[] = [
  {
    id: "bonds_warning",
    group: "checks",
    title: "Bonds & insurance warning",
    description: "Every bond and policy already expired or expiring within 30 days, listed under its contractor, soonest first.",
    source: "bonds",
    build: () => ({
      title: "Bonds & insurance warning – expired or expiring within 30 days",
      // one test covers both: a negative number of days is already expired
      conditions: [
        { field: "days_to_expiry", op: "num_lte", value: 30 },
        // a bond whose contract is finished, or that a later bond replaces, is not a warning
        { field: "released", op: "is_false" },
        { field: "superseded", op: "is_false" },
      ],
      groupBy: "contractor_id",
      sort: [{ field: "days_to_expiry", dir: "asc" }],
      columns: ["type_id", "policy_no", "issuer", "required_amount", "amount_provided", "variance", "expiry_date", "days_to_expiry"],
      blocks: LIST,
    }),
  },
  {
    id: "dvo_pending",
    group: "checks",
    title: "DVO pending",
    description: "Determined Variation Orders still sitting at Pending, summarised by contractor.",
    source: "changes",
    build: () => ({
      title: "DVO pending – by contractor",
      conditions: [
        { field: "dvo_status_id", op: "in", values: ["Pending"] },
        // nothing is pending on a contract whose final account is already signed
        { field: "contract_closed", op: "is_false" },
      ],
      groupBy: "contractor_id",
      sort: [{ field: "dvo_date", dir: "asc" }],
      columns: ["item_no", "description", "dvo_ref", "dvo_date", "dvo_tracker_amount", "dvo_time_impact", "overall_status_id"],
      blocks: LIST,
    }),
  },
  {
    id: "pvo_pending",
    group: "checks",
    title: "PVO pending",
    description: "Potential Variation Orders still sitting at Pending, summarised by contractor.",
    source: "changes",
    build: () => ({
      title: "PVO pending – by contractor",
      conditions: [
        { field: "pvo_status_id", op: "in", values: ["Pending"] },
        // nothing is pending on a contract whose final account is already signed
        { field: "contract_closed", op: "is_false" },
      ],
      groupBy: "contractor_id",
      sort: [{ field: "pvo_date", dir: "asc" }],
      columns: ["item_no", "description", "pvo_ref", "pvo_date", "pvo_tracker_amount", "pvo_time_impact", "overall_status_id"],
      blocks: LIST,
    }),
  },
  {
    id: "eot_with_commercial",
    group: "checks",
    title: "EOT pending action with commercial",
    description: "Open extension-of-time claims whose next action sits with the commercial team, by contractor and how long they have waited.",
    source: "eot_tracker",
    needs: "Reads the “Action with” field on each claim – a claim with that box empty shows as “Not set” and will not appear here.",
    build: () => ({
      title: "EOT pending action with the commercial team",
      conditions: [
        { field: "state", op: "in", values: ["Open"] },
        { field: "pending_with", op: "contains", value: "Commercial" },
        { field: "contract_closed", op: "is_false" },
      ],
      groupBy: "contractor",
      sort: [{ field: "days_since", dir: "desc" }],
      columns: ["claim_no", "contract_no", "assessment_type", "pending_with", "owner", "last_action_date", "days_since", "flag", "target_date", "days_to_target"],
      blocks: LIST,
    }),
  },
  {
    id: "pvo_approved_month",
    group: "checks",
    title: "PVO approved & VO issued – this month",
    description: "PVOs approved within the reporting month, with the VO reference and date beside each so you can see what has been issued.",
    source: "changes",
    build: (periodEnd) => {
      const m = monthOf(periodEnd);
      return {
        title: `PVO approved and VO issued – ${m.label}`,
        conditions: [
          { field: "pvo_status_id", op: "in", values: ["Approved"] },
          { field: "pvo_date", op: "date_between", value: m.from, value2: m.to },
        ],
        groupBy: "contractor_id",
        sort: [{ field: "pvo_date", dir: "asc" }],
        columns: ["item_no", "description", "pvo_ref", "pvo_date", "pvo_tracker_amount", "vo_ref", "vo_date", "vo_status_id", "vo_tracker_amount"],
        blocks: LIST,
      };
    },
  },
  {
    id: "dvo_approved_month",
    group: "checks",
    title: "DVO approved – this month",
    description: "DVOs approved within the reporting month, listed under each contractor with the amount determined.",
    source: "changes",
    build: (periodEnd) => {
      const m = monthOf(periodEnd);
      return {
        title: `DVO approved – ${m.label}`,
        conditions: [
          { field: "dvo_status_id", op: "in", values: ["Approved"] },
          { field: "dvo_date", op: "date_between", value: m.from, value2: m.to },
        ],
        groupBy: "contractor_id",
        sort: [{ field: "dvo_date", dir: "asc" }],
        columns: ["item_no", "description", "dvo_ref", "dvo_date", "dvo_tracker_amount", "dvo_time_impact", "dvo_instruction_date", "dvo_closed"],
        blocks: LIST,
      };
    },
  },
  {
    id: "payments_due_report",
    group: "smart",
    title: "Payments due & ageing",
    description: "Everything certified and not yet paid, put into overdue / due in 14 / 30 days / later, with VAT added or withholding deducted, aged from the date each payment falls due.",
    source: "payments_due",
    build: () => ({
      title: "Payments due & ageing",
      conditions: [],
      groupBy: "contractor",
      sort: [{ field: "days", dir: "asc" }],
      columns: ["bucket", "contract_code", "application_no", "net_certified", "tax_type", "tax_amount", "total_due", "due_date", "days"],
      blocks: FULL,
    }),
  },
  {
    id: "eot_tracker_report",
    group: "smart",
    title: "EOT & claims action tracker",
    description: "Every open claim as an action list: who it sits with, the last action and how long ago, the target date, and whether it is on track, to watch or stuck.",
    source: "eot_tracker",
    needs: "Reads “Action with”, “Date of last action” and “Target date” on each claim.",
    build: () => ({
      title: "EOT & claims action tracker",
      conditions: [
        { field: "state", op: "in", values: ["Open"] },
        { field: "contract_closed", op: "is_false" },
      ],
      groupBy: "pending_with",
      sort: [{ field: "days_since", dir: "desc" }],
      columns: ["claim_no", "contract_no", "contractor", "assessment_type", "owner", "last_action_date", "days_since", "flag", "target_date", "days_to_target"],
      blocks: LIST,
    }),
  },
  {
    id: "attention_one_pager",
    group: "smart",
    title: "What needs attention – one-pager",
    description: "Everything late, expiring or stuck across every module, ranked by what is at stake, written up on a single page for a meeting or a director.",
    source: "attention",
    build: () => ({
      title: "What needs attention",
      conditions: [],
      groupBy: "module",
      sort: [{ field: "priority", dir: "desc" }],
      columns: ["severity", "module", "ref", "item", "party", "date", "days", "value", "consequence", "action"],
      blocks: ONE_PAGER,
    }),
  },
  {
    id: "attention_full",
    group: "smart",
    title: "What needs attention – full list",
    description: "The same decision queue with every item listed underneath, for working through line by line.",
    source: "attention",
    build: () => ({
      title: "What needs attention – full list",
      conditions: [],
      groupBy: "module",
      sort: [{ field: "priority", dir: "desc" }],
      columns: ["severity", "module", "ref", "item", "party", "who", "date", "days", "value", "consequence", "action"],
      blocks: FULL,
    }),
  },
  {
    id: "scorecard_report",
    group: "smart",
    title: "Contract performance scorecard",
    description: "One line per contract drawing on every module: value, certified, paid, what is overdue, open changes and claims, bond cover and the final account position.",
    source: "scorecard",
    build: () => ({
      title: "Contract performance scorecard",
      conditions: [],
      groupBy: "health",
      sort: [{ field: "revised_value", dir: "desc" }],
      columns: ["contract_ref", "contractor", "revised_value", "certified", "pct_certified", "paid", "unpaid_certified", "overdue_count", "avg_days_late", "bond_status", "fa_status", "health"],
      blocks: FULL,
    }),
  },
  {
    id: "value_bridge_summary",
    group: "smart",
    title: "Contract value movement – written summary",
    description: "What each contract was let for, what moved it – approved variations, approved claims, the final account or Stage 2 remeasure – and what it is worth now, written up as a summary.",
    source: "value_bridge",
    build: () => ({
      title: "Contract value – original to revised",
      conditions: [],
      groupBy: "direction",
      sort: [{ field: "movement", dir: "desc" }],
      columns: ["contract_ref", "contractor", "original_value", "approved_vos", "approved_claims", "fa_adjustment", "revised_value", "movement", "movement_pct"],
      blocks: SUMMARY,
    }),
  },
  {
    id: "value_bridge_full",
    group: "smart",
    title: "Contract value movement – full table",
    description: "The same movement, contract by contract, with every column and the totals – the version to work from or send as a workbook.",
    source: "value_bridge",
    build: () => ({
      title: "Contract value – original to revised",
      conditions: [],
      groupBy: "direction",
      sort: [{ field: "movement", dir: "desc" }],
      columns: ["contract_ref", "contractor", "original_value", "approved_vos", "approved_claims", "fa_adjustment", "revised_value", "movement", "movement_pct"],
      blocks: FULL,
    }),
  },
];

/** Turns a standard report into an ordinary set-up the page can then change. */
export function standardSpec(report: StandardReport, periodEnd: string): ReportSpec {
  const r = report.build(periodEnd);
  return {
    ...emptySpec(report.source),
    title: r.title,
    conditions: r.conditions.map((c) => ({ ...c })),
    groupBy: r.groupBy,
    sort: r.sort.map((s) => ({ ...s })),
    columns: [...r.columns],
    blocks: { ...r.blocks },
  };
}
