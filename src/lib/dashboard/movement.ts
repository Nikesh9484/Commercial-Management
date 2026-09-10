import type Database from "better-sqlite3";
import { getDb } from "../db";
import { getRegisterDef } from "../registers";
import { listRecords } from "../registers/engine";
import { computeCostReport, MONEY_COLUMNS, type Money } from "../cost-report/compute";
import { getPeriod, type PeriodRow } from "../snapshots";
import { snapshotRows } from "../view-mode";
import { CHANGE_STAGES } from "../registers/defs/changes";
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

export interface Movement {
  current: { id: number; label: string; status: string };
  previous: { id: number; label: string } | null;
  kpis: { key: string; label: string; prev: number; now: number; delta: number }[];
  stages: StageMove[];
  groups: MoveGroup[];
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The nearest earlier period that was locked with a snapshot. */
export function previousLockedPeriod(db: Database.Database, period: PeriodRow): PeriodRow | null {
  return (
    (db
      .prepare("SELECT p.* FROM reporting_periods p WHERE p.report_no < ? AND EXISTS (SELECT 1 FROM snapshots s WHERE s.period_id = p.id) ORDER BY p.report_no DESC LIMIT 1")
      .get(period.report_no) as PeriodRow | undefined) ?? null
  );
}

/** Rows of a register as they stand for a period: the snapshot when the period is locked, else the live rows. */
function rowsFor(db: Database.Database, programmeId: number, period: PeriodRow, key: string): RecordRow[] {
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

  return {
    current: { id: current.id, label: current.label, status: current.status },
    previous: prev ? { id: prev.id, label: prev.label } : null,
    kpis,
    stages,
    groups,
  };
}

export function getMovementForContext(programmeId: number, periodId: number | null): Movement | null {
  return getMovement(getDb(), programmeId, periodId);
}
