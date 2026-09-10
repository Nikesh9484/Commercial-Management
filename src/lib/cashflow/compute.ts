import type Database from "better-sqlite3";
import { getSetting, setSetting } from "../db";
import { computeContracts } from "../payments/compute";
import { logAudit } from "../audit";
import { nowIso, formatMonthYear } from "../format";
import type { UserInfo } from "../registers/types";
import { AuthError } from "../auth";
import { ValidationError } from "../registers/engine";

export interface CashCell {
  forecast: number | null;
  actual_auto: number;
  actual_override: number | null;
  actual: number;
  difference: number | null;
}

export interface CashRow {
  contract_id: number;
  transaction_no: string;
  supplier: string;
  description: string;
  coding: string;
  cbs: string;
  programme: string;
  cells: Record<string, CashCell>;
  total_forecast: number;
  total_actual: number;
  total_difference: number;
}

export interface AccrualApplication {
  contract_id: number;
  contract: string;
  supplier: string;
  application_no: string;
  ipc_no: string;
  ipc_date: string | null;
  net_certified: number;
  vat: number;
  gross: number;
  payment_due_date: string | null;
  days_overdue: number | null;
}

export interface Accruals {
  byContract: { contract_id: number; contract: string; supplier: string; net_certified: number; net_paid: number; accrued: number }[];
  applications: AccrualApplication[];
  totalAccrued: number;
  totalOverdue: number;
}

export interface Cashflow {
  months: { key: string; label: string }[];
  range: { start: string; count: number };
  rows: CashRow[];
  monthTotals: Record<string, { forecast: number; actual: number; difference: number }>;
  grand: { forecast: number; actual: number; difference: number };
  chart: { label: string; forecast: number; actual: number }[];
  accruals: Accruals;
  actualsNote: string;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function monthLabel(key: string): string {
  return formatMonthYear(`${key}-01`);
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Paid amounts (net, excl. VAT) per contract per month, from the IPC log. */
export function actualsByMonth(db: Database.Database, programmeId: number): Map<number, Map<string, number>> {
  const { applications, apps } = computeContracts(db, programmeId);
  const out = new Map<number, Map<string, number>>();
  for (const a of apps) {
    if (!a.paid_date) continue;
    const comp = applications.get(a.id);
    const amount = comp?.net_payment ?? null;
    if (amount === null) continue;
    const m = monthKey(a.paid_date);
    const byMonth = out.get(a.contract_id) ?? new Map<string, number>();
    byMonth.set(m, r2((byMonth.get(m) ?? 0) + amount));
    out.set(a.contract_id, byMonth);
  }
  return out;
}

export function getRange(db: Database.Database, programmeId: number, dataMonths: string[]): { start: string; count: number } {
  const start = getSetting(db, `cashflow_start_${programmeId}`);
  const count = Number(getSetting(db, `cashflow_months_${programmeId}`) ?? 0);
  if (start && count > 0) return { start, count };
  const sorted = [...dataMonths].sort();
  const s = sorted[0] ?? currentMonth();
  const last = sorted[sorted.length - 1] ?? s;
  const span = monthsBetween(s, last) + 1;
  return { start: s, count: Math.max(12, span) };
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function setRange(db: Database.Database, programmeId: number, start: string, count: number, user: UserInfo) {
  if (user.role === "viewer") throw new AuthError("Viewers cannot change the cash flow range.");
  if (!/^\d{4}-\d{2}$/.test(start)) throw new ValidationError("Start month must look like 2026-09.");
  if (!Number.isInteger(count) || count < 1 || count > 120) throw new ValidationError("Number of months must be between 1 and 120.");
  setSetting(db, `cashflow_start_${programmeId}`, start);
  setSetting(db, `cashflow_months_${programmeId}`, String(count));
}

export function getCashflow(db: Database.Database, programmeId: number): Cashflow {
  const contracts = db
    .prepare(
      `SELECT c.id, c.transaction_no, c.title, c.scope_of_work, c.coding, c.cbs, ct.name AS supplier, p.code AS programme
       FROM contracts c LEFT JOIN contractors ct ON ct.id = c.contractor_id LEFT JOIN programmes p ON p.id = c.programme_id
       WHERE c.programme_id = ? ORDER BY c.sr_no, c.id`,
    )
    .all(programmeId) as { id: number; transaction_no: string | null; title: string; scope_of_work: string | null; coding: string | null; cbs: string | null; supplier: string | null; programme: string }[];
  const cells = db.prepare("SELECT contract_id, month, forecast, actual_override FROM cashflow_cells WHERE programme_id = ?").all(programmeId) as {
    contract_id: number;
    month: string;
    forecast: number | null;
    actual_override: number | null;
  }[];
  const actuals = actualsByMonth(db, programmeId);
  const dataMonths = [...cells.filter((c) => c.forecast !== null || c.actual_override !== null).map((c) => c.month), ...[...actuals.values()].flatMap((m) => [...m.keys()])];
  const range = getRange(db, programmeId, dataMonths);
  const months = Array.from({ length: range.count }, (_, i) => addMonths(range.start, i)).map((key) => ({ key, label: monthLabel(key) }));
  const cellMap = new Map(cells.map((c) => [`${c.contract_id}|${c.month}`, c]));

  const rows: CashRow[] = contracts.map((c) => {
    const row: CashRow = {
      contract_id: c.id,
      transaction_no: c.transaction_no ?? "",
      supplier: c.supplier ?? "",
      description: c.title || c.scope_of_work || "",
      coding: c.coding ?? "",
      cbs: c.cbs ?? "",
      programme: c.programme,
      cells: {},
      total_forecast: 0,
      total_actual: 0,
      total_difference: 0,
    };
    for (const m of months) {
      const stored = cellMap.get(`${c.id}|${m.key}`);
      const auto = actuals.get(c.id)?.get(m.key) ?? 0;
      const forecast = stored?.forecast ?? null;
      const override = stored?.actual_override ?? null;
      const actual = override ?? auto;
      const difference = forecast === null && actual === 0 ? null : r2(actual - (forecast ?? 0));
      row.cells[m.key] = { forecast, actual_auto: auto, actual_override: override, actual, difference };
      row.total_forecast = r2(row.total_forecast + (forecast ?? 0));
      row.total_actual = r2(row.total_actual + actual);
    }
    row.total_difference = r2(row.total_actual - row.total_forecast);
    return row;
  });

  const monthTotals: Cashflow["monthTotals"] = {};
  const grand = { forecast: 0, actual: 0, difference: 0 };
  const chart: Cashflow["chart"] = [];
  let cumF = 0;
  let cumA = 0;
  for (const m of months) {
    const f = r2(rows.reduce((t, r) => t + (r.cells[m.key].forecast ?? 0), 0));
    const a = r2(rows.reduce((t, r) => t + r.cells[m.key].actual, 0));
    monthTotals[m.key] = { forecast: f, actual: a, difference: r2(a - f) };
    grand.forecast = r2(grand.forecast + f);
    grand.actual = r2(grand.actual + a);
    cumF = r2(cumF + f);
    cumA = r2(cumA + a);
    chart.push({ label: m.label, forecast: cumF, actual: cumA });
  }
  grand.difference = r2(grand.actual - grand.forecast);

  return { months, range, rows, monthTotals, grand, chart, accruals: getAccruals(db, programmeId), actualsNote: "Actuals = net payments (excl. VAT) by paid date from Payment Tracking, unless overridden." };
}

export function getAccruals(db: Database.Database, programmeId: number): Accruals {
  const { contracts, applications, rows, apps } = computeContracts(db, programmeId);
  const names = new Map(
    (db.prepare("SELECT c.id, c.title, ct.name AS supplier FROM contracts c LEFT JOIN contractors ct ON ct.id = c.contractor_id WHERE c.programme_id = ?").all(programmeId) as { id: number; title: string; supplier: string | null }[]).map((c) => [c.id, c]),
  );
  const today = new Date().toISOString().slice(0, 10);
  const byContract = rows
    .map((c) => {
      const comp = contracts.get(c.id)!;
      const n = names.get(c.id);
      return { contract_id: c.id, contract: n?.title ?? String(c.id), supplier: n?.supplier ?? "", net_certified: comp.net_cum_certified, net_paid: comp.cum_paid, accrued: r2(comp.net_cum_certified - comp.cum_paid) };
    })
    .filter((c) => Math.abs(c.accrued) > 0.004);
  const applicationsList: AccrualApplication[] = apps
    .filter((a) => a.cumulative_certified !== null && a.cumulative_certified !== undefined && !a.paid_date)
    .map((a) => {
      const comp = applications.get(a.id)!;
      const n = names.get(a.contract_id);
      const due = comp.payment_due_date;
      const overdue = due && due < today ? Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${due}T00:00:00Z`).getTime()) / 86400000) : null;
      return {
        contract_id: a.contract_id,
        contract: n?.title ?? "",
        supplier: n?.supplier ?? "",
        application_no: String((a as unknown as { application_no: string }).application_no ?? ""),
        ipc_no: String((a as unknown as { ipc_no: string | null }).ipc_no ?? ""),
        ipc_date: a.ipc_date,
        net_certified: comp.net_certified ?? 0,
        vat: comp.vat ?? 0,
        gross: comp.final_amount_paid ?? 0,
        payment_due_date: due,
        days_overdue: overdue,
      };
    })
    .filter((a) => Math.abs(a.net_certified) > 0.004);
  return {
    byContract,
    applications: applicationsList,
    totalAccrued: r2(byContract.reduce((t, c) => t + c.accrued, 0)),
    totalOverdue: r2(applicationsList.filter((a) => (a.days_overdue ?? 0) > 0).reduce((t, a) => t + a.net_certified, 0)),
  };
}

export function saveCell(db: Database.Database, programmeId: number, input: { contract_id: number; month: string; forecast?: number | null; actual_override?: number | null }, user: UserInfo) {
  if (user.role === "viewer") throw new AuthError("Viewers cannot change the cash flow.");
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new ValidationError("Month must look like 2026-09.");
  const contract = db.prepare("SELECT id, title FROM contracts WHERE id = ? AND programme_id = ?").get(input.contract_id, programmeId) as { id: number; title: string } | undefined;
  if (!contract) throw new ValidationError("Contract not found in this programme.");
  const existing = db.prepare("SELECT * FROM cashflow_cells WHERE contract_id = ? AND month = ?").get(input.contract_id, input.month) as { id: number; forecast: number | null; actual_override: number | null } | undefined;
  const forecast = input.forecast === undefined ? (existing?.forecast ?? null) : input.forecast;
  const override = input.actual_override === undefined ? (existing?.actual_override ?? null) : input.actual_override;
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO cashflow_cells(programme_id, contract_id, month, forecast, actual_override, updated_at, updated_by) VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(contract_id, month) DO UPDATE SET forecast = excluded.forecast, actual_override = excluded.actual_override, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run(programmeId, input.contract_id, input.month, forecast, override, stamp, user.name);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if ((existing?.forecast ?? null) !== forecast) changes.forecast = { from: existing?.forecast ?? null, to: forecast };
  if ((existing?.actual_override ?? null) !== override) changes.actual_override = { from: existing?.actual_override ?? null, to: override };
  if (Object.keys(changes).length) {
    logAudit(db, { registerKey: "cashflow", recordId: input.contract_id, action: "update", user, summary: `Cash flow · ${contract.title} · ${monthLabel(input.month)}`, changes });
  }
}
