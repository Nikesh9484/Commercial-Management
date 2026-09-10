import type Database from "better-sqlite3";
import { getDb } from "../db";
import { getRegisterDef } from "../registers";
import { listRecords } from "../registers/engine";
import { computeCostReport, MONEY_COLUMNS, type Money } from "../cost-report/compute";
import { getPeriod, type PeriodRow } from "../snapshots";
import { snapshotRows } from "../view-mode";
import { CHANGE_STAGES, DEAD_STATUSES } from "../registers/defs/changes";
import { claimCostReportAmount } from "../registers/defs/claims";
import { stageHasData, daysBetween } from "../registers/enrich";
import { executiveTotals } from "../cost-report/executive";
import type { RecordRow } from "../registers/types";

/**
 * "What changed since the last issued report": compares the period shown with the nearest earlier
 * period that has a locked snapshot, register by register, plus the cost report totals.
 */
export interface MoveItem {
  key: string;
  title: string;
  from?: string;
  to?: string;
  amount?: number | null;
  delta?: number | null;
  note?: string;
}

export interface MoveGroup {
  key: string;
  label: string;
  href: string;
  prevCount: number;
  nowCount: number;
  valueLabel: string;
  prevValue: number;
  nowValue: number;
  added: MoveItem[];
  removed: MoveItem[];
  changed: MoveItem[];
}

export interface StageMove {
  stage: string;
  prevCount: number;
  nowCount: number;
  prevAmount: number;
  nowAmount: number;
}

/** One line of a "key period movement": how much one change / early warning / claim moved a cost-report column. */
export interface KeyMoveItem {
  key: string;
  title: string;
  prev: number;
  now: number;
  delta: number;
  note: string;
}

/** Everything that moved one cost-report column (H, J, K, L or M) since the previous report – like the Excel "Key Period Movements" block. */
export interface KeyMovement {
  col: "H" | "J" | "K" | "L" | "M";
  label: string;
  href: string;
  kpiDelta: number;
  itemsTotal: number;
  items: KeyMoveItem[];
}

/** Counts of changes at one stage by outcome, previous report vs this one. */
export interface StatusCount {
  stage: string;
  total: { prev: number; now: number };
  approved: { prev: number; now: number };
  pending: { prev: number; now: number };
  cancelled: { prev: number; now: number };
}

export interface AgeBucket {
  bucket: string;
  prev: number;
  now: number;
  tone: "green" | "amber" | "red" | "grey";
}

/** One contract in the payment status tracker. */
export interface PaymentTrackerRow {
  key: string;
  title: string;
  contractor: string;
  status: string;
  revised: number;
  certified: number;
  certifiedPeriod: number;
  paid: number;
  pctCertified: number | null;
  pctPaid: number | null;
  lateIpcs: number;
  latePayments: number;
}

export interface Movement {
  current: { id: number; label: string; status: string };
  previous: { id: number; label: string } | null;
  kpis: { key: string; label: string; prev: number; now: number; delta: number }[];
  stages: StageMove[];
  groups: MoveGroup[];
  /** Set when the comparison is not meaningful, e.g. the previous report was locked with no cost lines. */
  warning?: string;
  keyMovements: KeyMovement[];
  statusCounts: StatusCount[];
  dvoAgeing: AgeBucket[];
  payments: PaymentTrackerRow[];
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The nearest earlier period that was locked with a snapshot. */
export function previousLockedPeriod(db: Database.Database, period: PeriodRow): PeriodRow | null {
  return (
    (db
      .prepare("SELECT p.* FROM reporting_periods p WHERE p.report_no < ? AND EXISTS (SELECT 1 FROM snapshots s WHERE s.period_id = p.id AND s.register_key = 'cost_report') ORDER BY p.report_no DESC LIMIT 1")
      .get(period.report_no) as PeriodRow | undefined) ?? null
  );
}

/** Rows of a register as they stand for a period: the snapshot when the period is locked, else the live rows. */
export function rowsFor(db: Database.Database, programmeId: number, period: PeriodRow, key: string): RecordRow[] {
  const def = getRegisterDef(key)!;
  if (period.status === "Locked") {
    const snap = snapshotRows<RecordRow>(db, period.id, key);
    if (snap) return snap.filter((r) => Number(r.programme_id) === programmeId);
  }
  return listRecords(def);
}

/** Cost-report amount a change carries at its current stage (same rule as the cost report feed). */
function changeAmount(c: RecordRow): number {
  const stage = String(c.current_stage ?? "");
  const s = CHANGE_STAGES.find((x) => x.label === stage);
  if (!s) return 0;
  const v = c[`${s.prefix}_cr_amount`];
  return v === null || v === undefined ? num(c[`${s.prefix}_tracker_amount`]) : num(v);
}


const APPROVED = ["Approved", "Review Complete"];

/**
 * Which cost-report column a change feeds and with how much – the same rule as the cost report feed
 * (src/lib/cost-report/feeds.ts) but evaluated on register rows so it works on locked snapshots too.
 * Returns null when the change feeds nothing (no cost line, cancelled, or no live stage).
 */
export function changeContribution(c: RecordRow): { col: "H" | "J" | "K"; amount: number } | null {
  if (!c.cost_line_id) return null;
  const status = (p: string) => String(c[`${p}_status_id__label`] ?? "");
  if (DEAD_STATUSES.includes(String(c.overall_status_id__label ?? ""))) return null;
  if (APPROVED.includes(status("dvo"))) return { col: "H", amount: num(c.dvo_cr_amount) };
  for (const p of ["vo", "pvo"]) if (stageHasData(c, p) && !DEAD_STATUSES.includes(status(p))) return { col: "J", amount: num(c[`${p}_cr_amount`]) };
  if (stageHasData(c, "rfc") && !DEAD_STATUSES.includes(status("rfc"))) return { col: "K", amount: num(c.rfc_cr_amount) };
  return null;
}

const COL_LABELS: Record<KeyMovement["col"], string> = { H: "Determined Variation Orders (DVO)", J: "Potential Variation Orders (PVO / VO)", K: "Requests for Change (RFC)", L: "Early Warnings", M: "Claims" };
const COL_HREF: Record<KeyMovement["col"], string> = { H: "/modules/change-management", J: "/modules/change-management", K: "/modules/change-management", L: "/modules/early-warnings", M: "/modules/claims-disputes" };

/** Builds the "key period movements" per cost-report column from the rows of the two reports. */
function keyMovements(
  now: { changes: RecordRow[]; ews: RecordRow[]; claims: RecordRow[] },
  before: { changes: RecordRow[]; ews: RecordRow[]; claims: RecordRow[] },
  kpis: Movement["kpis"],
): KeyMovement[] {
  type Contrib = { col: KeyMovement["col"]; amount: number; title: string; state: string; label: string };
  // Map key = type + reference (so a change and a claim with the same number never collide); label = what is shown.
  const ref = (type: string, v: unknown, id: unknown) => {
    const raw = String(v ?? "").trim() || String(id);
    return { k: `${type}|${raw}`, label: /[a-z]/i.test(raw) ? raw : `${type}-${raw}` };
  };
  const collect = (rows: { changes: RecordRow[]; ews: RecordRow[]; claims: RecordRow[] }) => {
    const out = new Map<string, Contrib>();
    const state = (r: RecordRow) => String(r.overall_status_id__label ?? r.status ?? "");
    for (const c of rows.changes) {
      const { k, label } = ref("CH", c.item_no, c.id);
      const v = changeContribution(c);
      out.set(k, { label, col: v?.col ?? "K", amount: v?.amount ?? 0, title: String(c.description ?? ""), state: v ? `${v.col === "H" ? "DVO" : v.col === "J" ? "PVO/VO" : "RFC"} · ${state(c)}` : state(c) || "not in cost report" });
    }
    for (const e of rows.ews) {
      const { k, label } = ref("EW", e.ew_no, e.id);
      const live = e.status === "Open" && !!e.cost_line_id;
      out.set(k, { label, col: "L", amount: live ? num(e.cost_impact) : 0, title: String(e.description ?? ""), state: String(e.status ?? "") });
    }
    for (const cl of rows.claims) {
      const { k, label } = ref("CL", cl.claim_no, cl.id);
      out.set(k, { label, col: "M", amount: cl.cost_line_id ? claimCostReportAmount(cl) : 0, title: String(cl.description ?? ""), state: String(cl.status ?? "") });
    }
    return out;
  };
  const nowMap = collect(now);
  const prevMap = collect(before);
  const items: Record<KeyMovement["col"], KeyMoveItem[]> = { H: [], J: [], K: [], L: [], M: [] };
  const push = (col: KeyMovement["col"], key: string, title: string, prev: number, cur: number, note: string) => {
    const delta = r2(cur - prev);
    if (Math.abs(delta) < 0.005) return;
    items[col].push({ key, title: title.slice(0, 100), prev: r2(prev), now: r2(cur), delta, note });
  };
  const keys = new Set([...nowMap.keys(), ...prevMap.keys()]);
  for (const key of keys) {
    const a = prevMap.get(key);
    const b = nowMap.get(key);
    const label = (b ?? a)!.label;
    if (a && b) {
      if (a.col === b.col) push(b.col, label, b.title, a.amount, b.amount, a.state === b.state ? "amount revised" : `${a.state} -> ${b.state}`);
      else {
        push(a.col, label, a.title, a.amount, 0, `moved to ${b.col === "H" ? "DVO" : b.col === "J" ? "PVO/VO" : b.col === "K" ? "RFC" : COL_LABELS[b.col]}`);
        push(b.col, label, b.title, 0, b.amount, `from ${a.col === "H" ? "DVO" : a.col === "J" ? "PVO/VO" : a.col === "K" ? "RFC" : COL_LABELS[a.col]} · ${b.state}`);
      }
    } else if (b) push(b.col, label, b.title, 0, b.amount, `new · ${b.state}`);
    else if (a) push(a.col, label, a.title, a.amount, 0, "removed from the register");
  }
  return (["H", "J", "K", "L", "M"] as const).map((col) => {
    const list = items[col].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    return {
      col,
      label: COL_LABELS[col],
      href: COL_HREF[col],
      kpiDelta: kpis.find((k) => k.key === col)?.delta ?? 0,
      itemsTotal: r2(list.reduce((t, i) => t + i.delta, 0)),
      items: list,
    };
  });
}

/** Approved / pending / cancelled counts per stage, like the Excel "Change Management Status" box. */
function statusCounts(now: RecordRow[], before: RecordRow[]): StatusCount[] {
  const classify = (r: RecordRow, p: string): "approved" | "pending" | "cancelled" | null => {
    if (!stageHasData(r, p)) return null;
    const st = String(r[`${p}_status_id__label`] ?? "");
    if (APPROVED.includes(st)) return "approved";
    if (DEAD_STATUSES.includes(st) || st === "Rejected") return "cancelled";
    return "pending";
  };
  return CHANGE_STAGES.filter((s) => ["rfc", "pvo", "vo", "dvo"].includes(s.prefix)).map((s) => {
    const count = (rows: RecordRow[], what: "approved" | "pending" | "cancelled" | "total") =>
      rows.filter((r) => {
        const c = classify(r, s.prefix);
        return c !== null && (what === "total" || c === what);
      }).length;
    const pair = (what: "approved" | "pending" | "cancelled" | "total") => ({ prev: count(before, what), now: count(now, what) });
    return { stage: s.short, total: pair("total"), approved: pair("approved"), pending: pair("pending"), cancelled: pair("cancelled") };
  });
}

const AGE_BUCKETS: { bucket: string; min: number; max: number; tone: AgeBucket["tone"] }[] = [
  { bucket: "Pending under 30 days", min: -Infinity, max: 30, tone: "green" },
  { bucket: "Pending 30 – 60 days", min: 30, max: 60, tone: "amber" },
  { bucket: "Pending 60 – 90 days", min: 60, max: 90, tone: "amber" },
  { bucket: "Overdue (over 90 days)", min: 90, max: Infinity, tone: "red" },
];

/** How long the DVOs still pending have been waiting, counted at each report's cut-off date. */
function dvoAgeing(now: RecordRow[], nowEnd: string, before: RecordRow[], prevEnd: string | null): AgeBucket[] {
  const ages = (rows: RecordRow[], end: string) =>
    rows
      .filter((r) => stageHasData(r, "dvo") && r.dvo_closed !== true && !APPROVED.includes(String(r.dvo_status_id__label ?? "")) && !DEAD_STATUSES.includes(String(r.dvo_status_id__label ?? "")) && !DEAD_STATUSES.includes(String(r.overall_status_id__label ?? "")))
      .map((r) => {
        const from = (r.dvo_date as string | null) || (r.date_raised as string | null);
        return from ? Math.max(0, daysBetween(String(from), end)) : 0;
      });
  const a = ages(now, nowEnd);
  const b = prevEnd ? ages(before, prevEnd) : [];
  return AGE_BUCKETS.map((bk) => ({ bucket: bk.bucket, tone: bk.tone, now: a.filter((d) => d >= bk.min && d < bk.max).length, prev: b.filter((d) => d >= bk.min && d < bk.max).length }));
}

/** Payment status per contract: revised value, certified and paid to date, and how many IPCs / payments are late. */
function paymentTracker(contracts: RecordRow[], prevContracts: RecordRow[], apps: RecordRow[]): PaymentTrackerRow[] {
  const prevCert = new Map(prevContracts.map((c) => [String(c.reef_po_no ?? c.id), num(c.latest_cum_certified)]));
  const late = new Map<number, { ipc: number; pay: number }>();
  for (const a of apps) {
    const id = Number(a.contract_id);
    const cur = late.get(id) ?? { ipc: 0, pay: 0 };
    if (num(a.ipc_days_late) > 0) cur.ipc++;
    if (num(a.payment_days_late) > 0) cur.pay++;
    late.set(id, cur);
  }
  return contracts
    .map((c) => {
      const key = String(c.reef_po_no ?? c.id);
      const revised = num(c.revised_contract_value);
      const certified = num(c.latest_cum_certified);
      const netCert = num(c.net_cum_certified);
      const paid = num(c.cum_paid);
      const l = late.get(Number(c.id)) ?? { ipc: 0, pay: 0 };
      return {
        key,
        title: String(c.title ?? ""),
        contractor: String(c.contractor_id__label ?? ""),
        status: String(c.current_status ?? ""),
        revised,
        certified,
        certifiedPeriod: r2(certified - (prevCert.get(key) ?? 0)),
        paid,
        pctCertified: revised ? r2((certified / revised) * 100) : null,
        pctPaid: netCert ? r2((paid / netCert) * 100) : null,
        lateIpcs: l.ipc,
        latePayments: l.pay,
      };
    })
    .sort((x, y) => y.revised - x.revised);
}

interface Spec {
  key: string;
  label: string;
  href: string;
  id: string;
  title: (r: RecordRow) => string;
  state: (r: RecordRow) => string;
  value: (r: RecordRow) => number;
  valueLabel: string;
  filter?: (r: RecordRow) => boolean;
}

const SPECS: Spec[] = [
  { key: "changes", label: "Changes (RFC / PVO / VO / DVO)", href: "/modules/change-management", id: "item_no", title: (r) => String(r.description ?? ""), state: (r) => `${r.current_stage ?? "–"} · ${r.overall_status_id__label ?? "–"}`, value: changeAmount, valueLabel: "cost-report amount" },
  { key: "claims", label: "Claims & disputes", href: "/modules/claims-disputes", id: "claim_no", title: (r) => String(r.description ?? ""), state: (r) => String(r.status ?? "–"), value: (r) => num(r.contractor_cost), valueLabel: "claimed (SAR)" },
  { key: "early_warnings", label: "Early warnings", href: "/modules/early-warnings", id: "ew_no", title: (r) => String(r.description ?? ""), state: (r) => String(r.status ?? "–"), value: (r) => (r.status === "Open" ? num(r.cost_impact) : 0), valueLabel: "open potential cost" },
  { key: "risks", label: "Risks & opportunities", href: "/modules/early-warnings", id: "ro_no", title: (r) => String(r.description ?? ""), state: (r) => `${r.type ?? ""} · ${r.status ?? "–"}`, value: (r) => (["Open", "Mitigating"].includes(String(r.status)) ? num(r.cost_impact) : 0), valueLabel: "open cost impact" },
  { key: "provisional_sums", label: "Provisional sums", href: "/modules/provisional-sums", id: "item", title: (r) => String(r.description ?? ""), state: (r) => String(r.status_id__label ?? "–"), value: (r) => num(r.contract_value), valueLabel: "instructed value" },
  { key: "bonds", label: "Bonds & insurance", href: "/modules/bonds-insurance", id: "ref", title: (r) => `${r.type_id__label ?? ""} – ${r.contractor_id__label ?? ""}`, state: (r) => `expires ${r.expiry_date ?? "–"}${r.approved ? " · approved" : ""}`, value: (r) => num(r.amount_provided), valueLabel: "amount provided" },
  { key: "contracts", label: "Contracts – certified to date", href: "/modules/invoices-payments", id: "reef_po_no", title: (r) => String(r.title ?? ""), state: (r) => String(r.current_status ?? "–"), value: (r) => num(r.latest_cum_certified), valueLabel: "cumulative certified" },
  { key: "payment_applications", label: "Payment applications (IPCs)", href: "/modules/invoices-payments", id: "__ipc_key", title: (r) => `${r.contract_id__label ?? ""} · ${r.application_no ?? ""}`, state: (r) => (r.paid_date ? "paid" : r.ipc_date ? "certified" : "applied"), value: (r) => num(r.cumulative_claimed), valueLabel: "cumulative claimed" },
  { key: "budget_transfers", label: "Budget transfers", href: "/modules/budget-transfers", id: "item", title: (r) => String(r.description ?? ""), state: (r) => String(r.status ?? "–"), value: (r) => num(r.amount), valueLabel: "amount" },
  { key: "final_accounts", label: "Final account status", href: "/modules/final-accounts", id: "acc_ref", title: (r) => String(r.description ?? ""), state: (r) => String(r.status ?? "–"), value: (r) => num(r.afa), valueLabel: "anticipated final account" },
];

export function getMovement(db: Database.Database, programmeId: number, periodId: number | null): Movement | null {
  const current = periodId ? getPeriod(periodId) : null;
  if (!current) return null;
  const prev = previousLockedPeriod(db, current);
  const nowReport = computeCostReport(programmeId, current.id);
  const prevReport = prev ? computeCostReport(programmeId, prev.id) : null;
  const zero = Object.fromEntries(MONEY_COLUMNS.map((c) => [c.key, 0])) as Money;
  const pg = prevReport ? executiveTotals(prevReport) : zero;
  const g = executiveTotals(nowReport);
  const kpis = MONEY_COLUMNS.filter((c) => !["R", "S"].includes(c.key)).map((c) => ({ key: c.key, label: c.label, prev: pg[c.key], now: g[c.key], delta: r2(g[c.key] - pg[c.key]) }));
  let warning: string | undefined;
  if (prev && prevReport && prevReport.lines.length === 0) warning = `${prev.label} is locked but its cost report has no lines, so every "previous" figure below is 0. Unlock ${prev.label}, import or enter that month's data, and lock it again – or delete it if it was created by mistake.`;
  else if (prev && nowReport.previousPeriod && nowReport.previousPeriod.id === prev.id && !nowReport.previousPeriod.snapshotAvailable) warning = `${prev.label} has a cost report, but none of its lines match this report's lines (different codes). The cost report movement below compares totals only.`;

  const nowChanges = rowsFor(db, programmeId, current, "changes");
  const prevChanges = prev ? rowsFor(db, programmeId, prev, "changes") : [];
  const stages: StageMove[] = CHANGE_STAGES.filter((s) => ["rfc", "pvo", "vo", "dvo"].includes(s.prefix)).map((s) => {
    const at = (rows: RecordRow[]) => rows.filter((c) => String(c.current_stage) === s.label && c.is_closed !== true);
    return {
      stage: s.short,
      prevCount: at(prevChanges).length,
      nowCount: at(nowChanges).length,
      prevAmount: r2(at(prevChanges).reduce((t, c) => t + changeAmount(c), 0)),
      nowAmount: r2(at(nowChanges).reduce((t, c) => t + changeAmount(c), 0)),
    };
  });

  const groups: MoveGroup[] = SPECS.map((spec) => {
    const now = spec.key === "changes" ? nowChanges : rowsFor(db, programmeId, current, spec.key);
    const before = prev ? (spec.key === "changes" ? prevChanges : rowsFor(db, programmeId, prev, spec.key)) : [];
    const idOf = (r: RecordRow) => (spec.id === "__ipc_key" ? `${r.contract_id__label ?? r.contract_id} · ${r.application_no ?? ""}` : String(r[spec.id] ?? r.id));
    const prevMap = new Map(before.map((r) => [idOf(r), r]));
    const nowMap = new Map(now.map((r) => [idOf(r), r]));
    const item = (r: RecordRow, extra: Partial<MoveItem> = {}): MoveItem => ({ key: idOf(r), title: spec.title(r).slice(0, 90), to: spec.state(r), amount: spec.value(r), ...extra });
    const added = now.filter((r) => !prevMap.has(idOf(r))).map((r) => item(r));
    const removed = before.filter((r) => !nowMap.has(idOf(r))).map((r) => item(r, { from: spec.state(r), to: undefined }));
    const changed: MoveItem[] = [];
    for (const r of now) {
      const p = prevMap.get(idOf(r));
      if (!p) continue;
      const fromState = spec.state(p);
      const toState = spec.state(r);
      const delta = r2(spec.value(r) - spec.value(p));
      if (fromState !== toState || Math.abs(delta) > 0.5) changed.push(item(r, { from: fromState, to: toState, delta }));
    }
    return {
      key: spec.key,
      label: spec.label,
      href: spec.href,
      prevCount: before.length,
      nowCount: now.length,
      valueLabel: spec.valueLabel,
      prevValue: r2(before.reduce((t, r) => t + spec.value(r), 0)),
      nowValue: r2(now.reduce((t, r) => t + spec.value(r), 0)),
      added,
      removed,
      changed,
    };
  });

  const nowEws = rowsFor(db, programmeId, current, "early_warnings");
  const prevEws = prev ? rowsFor(db, programmeId, prev, "early_warnings") : [];
  const nowClaims = rowsFor(db, programmeId, current, "claims");
  const prevClaims = prev ? rowsFor(db, programmeId, prev, "claims") : [];
  const nowContracts = rowsFor(db, programmeId, current, "contracts");
  const prevContracts = prev ? rowsFor(db, programmeId, prev, "contracts") : [];
  const nowApps = rowsFor(db, programmeId, current, "payment_applications");

  return {
    current: { id: current.id, label: current.label, status: current.status },
    previous: prev ? { id: prev.id, label: prev.label } : null,
    warning,
    kpis,
    stages,
    groups,
    keyMovements: keyMovements({ changes: nowChanges, ews: nowEws, claims: nowClaims }, { changes: prevChanges, ews: prevEws, claims: prevClaims }, kpis),
    statusCounts: statusCounts(nowChanges, prevChanges),
    dvoAgeing: dvoAgeing(nowChanges, current.period_end, prevChanges, prev?.period_end ?? null),
    payments: paymentTracker(nowContracts, prevContracts, nowApps),
  };
}

export function getMovementForContext(programmeId: number, periodId: number | null): Movement | null {
  return getMovement(getDb(), programmeId, periodId);
}
