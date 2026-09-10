import type Database from "better-sqlite3";
import { tableExists } from "../cost-report/feeds";

export interface ResolvedTransfer {
  id: number;
  item: string;
  status: string;
  amount: number;
  from_package_id: number;
  to_package_id: number;
  from_line: number | null;
  to_line: number | null;
  /** null = applied; otherwise why it is not in the cost report */
  problem: string | null;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Works out which Level 2 line each side of every transfer lands on. */
export function resolveTransfers(db: Database.Database, programmeId: number): ResolvedTransfer[] {
  if (!tableExists(db, "budget_transfers")) return [];
  const lines = db.prepare("SELECT id, package_id FROM cost_lines WHERE programme_id = ?").all(programmeId) as { id: number; package_id: number }[];
  const byPackage = new Map<number, number[]>();
  for (const l of lines) byPackage.set(l.package_id, [...(byPackage.get(l.package_id) ?? []), l.id]);
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const resolveSide = (pkg: number | null, line: number | null, side: string): { line: number | null; problem: string | null } => {
    if (line) {
      const l = lineById.get(line);
      if (!l) return { line: null, problem: `${side} cost line not found` };
      if (pkg && l.package_id !== pkg) return { line: null, problem: `${side} cost line is not in the ${side.toLowerCase()} package` };
      return { line, problem: null };
    }
    const candidates = pkg ? (byPackage.get(pkg) ?? []) : [];
    if (candidates.length === 1) return { line: candidates[0], problem: null };
    if (candidates.length === 0) return { line: null, problem: `${side} package has no cost report line` };
    return { line: null, problem: `${side} package has ${candidates.length} lines – choose one` };
  };

  const rows = db.prepare("SELECT id, item, status, amount, from_package_id, to_package_id, from_cost_line_id, to_cost_line_id FROM budget_transfers WHERE programme_id = ?").all(programmeId) as {
    id: number;
    item: string;
    status: string;
    amount: number | null;
    from_package_id: number | null;
    to_package_id: number | null;
    from_cost_line_id: number | null;
    to_cost_line_id: number | null;
  }[];
  return rows.map((t) => {
    const from = resolveSide(t.from_package_id, t.from_cost_line_id, "From");
    const to = resolveSide(t.to_package_id, t.to_cost_line_id, "To");
    let problem = from.problem ?? to.problem;
    if (!problem && t.status !== "Approved") problem = `Not approved (${t.status})`;
    if (!problem && from.line === to.line) problem = "From and To are the same line";
    return {
      id: t.id,
      item: t.item,
      status: t.status,
      amount: Number(t.amount ?? 0),
      from_package_id: Number(t.from_package_id),
      to_package_id: Number(t.to_package_id),
      from_line: from.line,
      to_line: to.line,
      problem,
    };
  });
}

/** Column F: −amount on the From line, +amount on the To line, for every applied transfer. */
export function transferFeeds(db: Database.Database, programmeId: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const t of resolveTransfers(db, programmeId)) {
    if (t.problem || t.from_line === null || t.to_line === null) continue;
    out.set(t.from_line, r2((out.get(t.from_line) ?? 0) - t.amount));
    out.set(t.to_line, r2((out.get(t.to_line) ?? 0) + t.amount));
  }
  return out;
}

export interface TransferSummary {
  total: number;
  approved: number;
  approvedAmount: number;
  pendingAmount: number;
  notApplied: { item: string; problem: string }[];
  netByPackage: { package_id: number; package: string; out: number; in: number; net: number }[];
  netsToZero: boolean;
}

export function getTransferSummary(db: Database.Database, programmeId: number): TransferSummary {
  const resolved = resolveTransfers(db, programmeId);
  const packages = new Map((db.prepare("SELECT id, name FROM packages").all() as { id: number; name: string }[]).map((p) => [p.id, p.name]));
  const net = new Map<number, { out: number; in: number }>();
  const bump = (pkg: number, key: "out" | "in", v: number) => {
    const cur = net.get(pkg) ?? { out: 0, in: 0 };
    cur[key] = r2(cur[key] + v);
    net.set(pkg, cur);
  };
  for (const t of resolved) {
    if (t.status !== "Approved" || t.problem) continue; // only what is actually in column F
    bump(t.from_package_id, "out", t.amount);
    bump(t.to_package_id, "in", t.amount);
  }
  const feed = transferFeeds(db, programmeId);
  const sum = r2([...feed.values()].reduce((a, b) => a + b, 0));
  return {
    total: resolved.length,
    approved: resolved.filter((t) => t.status === "Approved").length,
    approvedAmount: r2(resolved.filter((t) => t.status === "Approved").reduce((a, t) => a + t.amount, 0)),
    pendingAmount: r2(resolved.filter((t) => t.status === "Pending").reduce((a, t) => a + t.amount, 0)),
    notApplied: resolved.filter((t) => t.status === "Approved" && t.problem).map((t) => ({ item: t.item, problem: t.problem! })),
    netByPackage: [...net.entries()]
      .map(([id, v]) => ({ package_id: id, package: packages.get(id) ?? `#${id}`, out: v.out, in: v.in, net: r2(v.in - v.out) }))
      .sort((a, b) => a.package.localeCompare(b.package)),
    netsToZero: Math.abs(sum) < 0.005,
  };
}
