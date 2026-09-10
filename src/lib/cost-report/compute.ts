import type Database from "better-sqlite3";
import { getDb } from "../db";
import { getCostFeeds } from "./feeds";
import { MONEY_COLUMNS, type Money, type CostLineRow, type Level1Row, type CostReport } from "./columns";

export { MONEY_COLUMNS, type Money, type MoneyKey, type CostLineRow, type Level1Row, type CostReport } from "./columns";

const ZERO: Money = Object.fromEntries(MONEY_COLUMNS.map((c) => [c.key, 0])) as Money;

export function zeroMoney(): Money {
  return { ...ZERO };
}

export function addMoney(into: Money, row: Money): Money {
  for (const c of MONEY_COLUMNS) into[c.key] += row[c.key];
  return into;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

interface RawLine {
  id: number;
  asset_id: number;
  asset_code: string | null;
  asset_name: string | null;
  code: string;
  package_id: number;
  package: string | null;
  name: string | null;
  contractor: string | null;
  section: string | null;
  sort_order: number | null;
  approved_baseline_budget: number | null;
  opening_transfers: number | null;
}

/** Full cost report for a programme at a reporting period. */
export function computeCostReport(programmeId: number, periodId: number | null): CostReport {
  const db = getDb();
  const programme = (db.prepare("SELECT id, code, name FROM programmes WHERE id = ?").get(programmeId) as CostReport["programme"]) ?? null;
  const period = periodId ? ((db.prepare("SELECT id, label, status, report_no FROM reporting_periods WHERE id = ?").get(periodId) as { id: number; label: string; status: string; report_no: number } | undefined) ?? null) : null;
  const prev = period
    ? ((db.prepare("SELECT id, label, status FROM reporting_periods WHERE report_no < ? ORDER BY report_no DESC LIMIT 1").get(period.report_no) as { id: number; label: string; status: string } | undefined) ?? null)
    : null;

  const raw = db
    .prepare(
      `SELECT l.id, l.asset_id, a.code AS asset_code, a.name AS asset_name, l.code, l.package_id, p.name AS package, l.name,
              c.name AS contractor, l.section, l.sort_order, l.approved_baseline_budget, l.opening_transfers
       FROM cost_lines l
       LEFT JOIN assets a ON a.id = l.asset_id
       LEFT JOIN packages p ON p.id = l.package_id
       LEFT JOIN contractors c ON c.id = l.contractor_id
       WHERE l.programme_id = ?
       ORDER BY a.code, l.sort_order, l.code`,
    )
    .all(programmeId) as RawLine[];

  const { feeds, status } = getCostFeeds(db, programmeId, periodId ?? 0);
  const prevAfa = prev ? previousAfa(db, prev.id) : null;

  const lines: CostLineRow[] = raw.map((r) => {
    const g = (k: Map<number, number>) => round2(k.get(r.id) ?? 0);
    const E = round2(Number(r.approved_baseline_budget ?? 0));
    const F = round2(g(feeds.budgetTransfers) + Number(r.opening_transfers ?? 0));
    const G = round2(E + F);
    const H = g(feeds.dvo);
    const I = round2(G + H);
    const J = g(feeds.pvo);
    const K = g(feeds.rfc);
    const L = g(feeds.earlyWarnings);
    const M = g(feeds.claims);
    const N = round2(I + J + K + L + M);
    const O = round2(N - G);
    const P = g(feeds.certified);
    const Q = round2(N - P);
    const R = prevAfa ? round2(prevAfa.get(r.id) ?? 0) : 0;
    const S = round2(N - R);
    return {
      id: r.id,
      asset_id: r.asset_id,
      asset_code: r.asset_code ?? "",
      asset_name: r.asset_name ?? "",
      code: r.code,
      package_id: r.package_id,
      package: r.package ?? "",
      name: r.name ?? "",
      contractor: r.contractor ?? "",
      section: r.section === "Uncommitted" ? "Uncommitted" : "Committed",
      sort_order: r.sort_order ?? 0,
      prev_available: !!prevAfa,
      E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S,
    };
  });

  return assembleReport(lines, {
    programme,
    period: period ? { id: period.id, label: period.label, status: period.status } : null,
    previousPeriod: prev ? { ...prev, snapshotAvailable: !!prevAfa } : null,
    feeds: status,
  });
}

/** Builds sections, totals, Level 1, the check line and the chart from a list of computed lines. */
export function assembleReport(lines: CostLineRow[], meta: Pick<CostReport, "programme" | "period" | "previousPeriod" | "feeds">): CostReport {
  const sections = (["Committed", "Uncommitted"] as const).map((name) => {
    const rows = lines.filter((l) => l.section === name);
    return { name, lines: rows, subtotal: rows.reduce((t, r) => addMoney(t, r), zeroMoney()) };
  });
  const grandTotal = sections.reduce((t, s) => addMoney(t, s.subtotal), zeroMoney());

  const byAsset = new Map<number, Level1Row>();
  for (const l of lines) {
    const row = byAsset.get(l.asset_id) ?? { asset_id: l.asset_id, asset_code: l.asset_code, asset_name: l.asset_name, lines: 0, ...zeroMoney() };
    addMoney(row, l);
    row.lines++;
    byAsset.set(l.asset_id, row);
  }
  const level1 = [...byAsset.values()].sort((a, b) => a.asset_code.localeCompare(b.asset_code));
  const level1Total = level1.reduce((t, r) => addMoney(t, r), zeroMoney());
  const check = zeroMoney();
  for (const c of MONEY_COLUMNS) check[c.key] = round2(level1Total[c.key] - grandTotal[c.key]);
  const checkOk = MONEY_COLUMNS.every((c) => Math.abs(check[c.key]) < 0.005);

  const byPackage = new Map<string, { package: string; baseline: number; afa: number }>();
  for (const l of lines) {
    const key = l.package || "(no package)";
    const row = byPackage.get(key) ?? { package: key, baseline: 0, afa: 0 };
    row.baseline = round2(row.baseline + l.E);
    row.afa = round2(row.afa + l.N);
    byPackage.set(key, row);
  }
  return { ...meta, lines, sections, grandTotal, level1, level1Total, check, checkOk, chart: [...byPackage.values()] };
}

/** Anticipated Final Account per cost line stored when the previous period was locked. */
function previousAfa(db: Database.Database, periodId: number): Map<number, number> | null {
  const rows = db.prepare("SELECT record_id, data FROM snapshots WHERE period_id = ? AND register_key = 'cost_report'").all(periodId) as { record_id: number; data: string }[];
  if (!rows.length) return null;
  const out = new Map<number, number>();
  for (const r of rows) {
    const d = JSON.parse(r.data) as { N?: number };
    out.set(r.record_id, Number(d.N ?? 0));
  }
  return out;
}

/** Stores the computed report for every programme (called when a period is locked). Returns rows stored. */
export function snapshotCostReport(db: Database.Database, periodId: number, takenAt: string): number {
  const programmes = db.prepare("SELECT id FROM programmes").all() as { id: number }[];
  const ins = db.prepare("INSERT INTO snapshots(period_id, register_key, record_id, data, taken_at) VALUES(?, 'cost_report', ?, ?, ?)");
  let n = 0;
  for (const p of programmes) {
    const report = computeCostReport(p.id, periodId);
    for (const line of report.lines) {
      ins.run(periodId, line.id, JSON.stringify(line), takenAt);
      n++;
    }
  }
  return n;
}
