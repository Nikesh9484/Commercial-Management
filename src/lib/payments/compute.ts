import type Database from "better-sqlite3";
import { changeFeeds } from "../cost-report/feeds";
import { tableExists } from "../cost-report/feeds";
import { todayIso, toDate } from "../format";
import { daysBetween } from "../registers/enrich-utils";

export interface ContractRow {
  id: number;
  programme_id: number;
  cost_line_id: number | null;
  original_completion_date: string | null;
  eot_granted_days: number | null;
  original_contract: number | null;
  final_account_adjustment: number | null;
  advance_recovery_pct: number | null;
  retention_pct: number | null;
  ipc_days: number | null;
  payment_days: number | null;
  vat_pct: number | null;
}

export interface ApplicationRow {
  id: number;
  contract_id: number;
  application_date: string;
  cumulative_claimed: number | null;
  ipc_date: string | null;
  cumulative_certified: number | null;
  paid_date: string | null;
}

export interface ApplicationComputed {
  gross_claimed_month: number | null;
  advance_recovery_claimed: number | null;
  retention_claimed: number | null;
  net_claimed: number | null;
  ipc_due_date: string | null;
  ipc_days_late: number | null;
  gross_certified_month: number | null;
  advance_recovery_certified: number | null;
  retention_certified: number | null;
  net_certified: number | null;
  payment_due_date: string | null;
  payment_days_late: number | null;
  net_payment: number | null;
  vat: number | null;
  final_amount_paid: number | null;
  cumulative_paid: number | null;
  net_paid_running: number | null;
  row_tone: "amber" | "red" | null;
}

export interface ContractComputed {
  revised_completion_date: string | null;
  approved_vos: number;
  approved_claims: number;
  revised_contract_value: number;
  net_cum_applied: number;
  net_cum_certified: number;
  cum_paid: number;
  latest_cum_claimed: number;
  latest_cum_certified: number;
  pct_certified: number | null;
  pct_balance: number | null;
  applications: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

export function addDays(iso: string, days: number): string | null {
  const d = toDate(iso);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function loadContracts(db: Database.Database, programmeId: number): ContractRow[] {
  if (!tableExists(db, "contracts")) return [];
  return db.prepare("SELECT * FROM contracts WHERE programme_id = ? ORDER BY sr_no, id").all(programmeId) as ContractRow[];
}

export function loadApplications(db: Database.Database, programmeId: number): ApplicationRow[] {
  if (!tableExists(db, "payment_applications")) return [];
  return db.prepare("SELECT * FROM payment_applications WHERE programme_id = ? ORDER BY contract_id, application_date, id").all(programmeId) as ApplicationRow[];
}

/** Per-application calculations for every application of a programme, keyed by application id. */
export function computeApplications(contracts: ContractRow[], apps: ApplicationRow[]): Map<number, ApplicationComputed> {
  const out = new Map<number, ApplicationComputed>();
  const byContract = new Map<number, ContractRow>(contracts.map((c) => [c.id, c]));
  const today = todayIso();
  let prev: ApplicationRow | null = null;
  let prevCumCert = 0;
  let cumPaid = 0;
  let netPaid = 0;
  for (const a of apps) {
    const c = byContract.get(a.contract_id);
    if (!prev || prev.contract_id !== a.contract_id) {
      prev = null;
      prevCumCert = 0;
      cumPaid = 0;
      netPaid = 0;
    }
    const adv = num(c?.advance_recovery_pct) / 100;
    const ret = num(c?.retention_pct) / 100;
    const vatPct = c?.vat_pct === null || c?.vat_pct === undefined ? 15 : Number(c.vat_pct);

    const gross = a.cumulative_claimed === null ? null : r2(num(a.cumulative_claimed) - num(prev?.cumulative_claimed));
    const advC = gross === null ? null : r2(gross * adv);
    const retC = gross === null ? null : r2(gross * ret);
    const net = gross === null ? null : r2(gross - advC! - retC!);

    const ipcDue = c && c.ipc_days !== null ? addDays(a.application_date, num(c.ipc_days)) : null;
    const ipcLate = ipcDue && a.ipc_date ? daysBetween(ipcDue, a.ipc_date) : null;

    let grossCert: number | null = null;
    if (a.cumulative_certified !== null && a.cumulative_certified !== undefined) {
      grossCert = r2(num(a.cumulative_certified) - prevCumCert);
      prevCumCert = num(a.cumulative_certified);
    }
    const advCert = grossCert === null ? null : r2(grossCert * adv);
    const retCert = grossCert === null ? null : r2(grossCert * ret);
    const netCert = grossCert === null ? null : r2(grossCert - advCert! - retCert!);

    const payDue = a.ipc_date && c && c.payment_days !== null ? addDays(a.ipc_date, num(c.payment_days)) : null;
    const payLate = payDue && a.paid_date ? daysBetween(payDue, a.paid_date) : null;

    const netPayment = netCert;
    const vat = netPayment === null ? null : r2(netPayment * (vatPct / 100));
    const finalAmt = netPayment === null ? null : r2(netPayment + vat!);
    let cumulativePaid: number | null = null;
    if (a.paid_date && finalAmt !== null) {
      cumPaid = r2(cumPaid + finalAmt);
      netPaid = r2(netPaid + netPayment!);
      cumulativePaid = cumPaid;
    }

    let tone: ApplicationComputed["row_tone"] = null;
    if (!a.ipc_date && ipcDue && ipcDue < today) tone = "amber";
    if (a.ipc_date && !a.paid_date && payDue && payDue < today) tone = "red";

    out.set(a.id, {
      gross_claimed_month: gross,
      advance_recovery_claimed: advC,
      retention_claimed: retC,
      net_claimed: net,
      ipc_due_date: ipcDue,
      ipc_days_late: ipcLate,
      gross_certified_month: grossCert,
      advance_recovery_certified: advCert,
      retention_certified: retCert,
      net_certified: netCert,
      payment_due_date: payDue,
      payment_days_late: payLate,
      net_payment: netPayment,
      vat,
      final_amount_paid: finalAmt,
      cumulative_paid: cumulativePaid,
      net_paid_running: a.paid_date ? netPaid : null,
      row_tone: tone,
    });
    prev = a;
  }
  return out;
}

/** Approved claims (determination value) per cost line. */
function approvedClaimsByLine(db: Database.Database, programmeId: number): Map<number, number> {
  const out = new Map<number, number>();
  if (!tableExists(db, "claims")) return out;
  const rows = db
    .prepare(
      `SELECT cost_line_id, COALESCE(determination_cost, employer_cost, 0) AS v FROM claims
       WHERE programme_id = ? AND cost_line_id IS NOT NULL AND status IN ('Approved', 'Approved (Authority)', 'Approved (proceed to ERI)')`,
    )
    .all(programmeId) as { cost_line_id: number; v: number }[];
  for (const r of rows) out.set(r.cost_line_id, (out.get(r.cost_line_id) ?? 0) + num(r.v));
  return out;
}

/** Contract-level calculations for a programme, keyed by contract id. */
export function computeContracts(db: Database.Database, programmeId: number, source?: { contracts: ContractRow[]; apps: ApplicationRow[] }): { contracts: Map<number, ContractComputed>; applications: Map<number, ApplicationComputed>; rows: ContractRow[]; apps: ApplicationRow[] } {
  const rows = source ? source.contracts : loadContracts(db, programmeId);
  const apps = source ? source.apps : loadApplications(db, programmeId);
  const applications = computeApplications(rows, apps);
  const dvo = changeFeeds(db, programmeId).dvo;
  const claims = approvedClaimsByLine(db, programmeId);
  const contracts = new Map<number, ContractComputed>();
  for (const c of rows) {
    const mine = apps.filter((a) => a.contract_id === c.id);
    const comp = mine.map((a) => applications.get(a.id)!);
    const vos = c.cost_line_id ? r2(dvo.get(c.cost_line_id) ?? 0) : 0;
    const cl = c.cost_line_id ? r2(claims.get(c.cost_line_id) ?? 0) : 0;
    const revised = r2(num(c.original_contract) + vos + cl + num(c.final_account_adjustment));
    const latestClaimed = mine.length ? num(mine[mine.length - 1].cumulative_claimed) : 0;
    const certified = mine.filter((a) => a.cumulative_certified !== null && a.cumulative_certified !== undefined);
    const latestCert = certified.length ? num(certified[certified.length - 1].cumulative_certified) : 0;
    const pct = revised > 0 ? r2((latestCert / revised) * 100) : null;
    contracts.set(c.id, {
      revised_completion_date: c.original_completion_date ? addDays(c.original_completion_date, num(c.eot_granted_days)) : null,
      approved_vos: vos,
      approved_claims: cl,
      revised_contract_value: revised,
      net_cum_applied: r2(comp.reduce((t, x) => t + num(x.net_claimed), 0)),
      net_cum_certified: r2(comp.reduce((t, x) => t + num(x.net_certified), 0)),
      cum_paid: r2(comp.reduce((t, x) => t + (x.cumulative_paid !== null ? num(x.net_payment) : 0), 0)),
      latest_cum_claimed: latestClaimed,
      latest_cum_certified: latestCert,
      pct_certified: pct,
      pct_balance: pct === null ? null : r2(100 - pct),
      applications: mine.length,
    });
  }
  return { contracts, applications, rows, apps };
}

/** Cost report column P: gross cumulative certified per cost line (sum over contracts linked to the line). */
export function certifiedByLine(db: Database.Database, programmeId: number): Map<number, number> {
  const out = new Map<number, number>();
  const { contracts, rows } = computeContracts(db, programmeId);
  for (const c of rows) {
    if (!c.cost_line_id) continue;
    out.set(c.cost_line_id, r2((out.get(c.cost_line_id) ?? 0) + (contracts.get(c.id)?.latest_cum_certified ?? 0)));
  }
  return out;
}

/** Revised contract value per cost line from the contracts register (for Bonds & Insurance). */
export function revisedByLine(db: Database.Database, programmeId: number): Map<number, number> {
  const out = new Map<number, number>();
  const { contracts, rows } = computeContracts(db, programmeId);
  for (const c of rows) if (c.cost_line_id) out.set(c.cost_line_id, contracts.get(c.id)!.revised_contract_value);
  return out;
}

/** Points for the cumulative claimed / certified / paid chart (one per application date, summed across the given contracts). */
export function paymentTimeline(db: Database.Database, programmeId: number, contractId?: number, source?: { contracts: ContractRow[]; apps: ApplicationRow[] }): { date: string; claimed: number; certified: number; paid: number }[] {
  const { applications, apps } = computeContracts(db, programmeId, source);
  const mine = contractId ? apps.filter((a) => a.contract_id === contractId) : apps;
  const dates = [...new Set(mine.map((a) => a.application_date))].sort();
  const latest = new Map<number, { claimed: number; certified: number; paid: number }>();
  const points: { date: string; claimed: number; certified: number; paid: number }[] = [];
  const sorted = [...mine].sort((a, b) => a.application_date.localeCompare(b.application_date) || a.id - b.id);
  let i = 0;
  for (const date of dates) {
    while (i < sorted.length && sorted[i].application_date <= date) {
      const a = sorted[i];
      const comp = applications.get(a.id)!;
      const cur = latest.get(a.contract_id) ?? { claimed: 0, certified: 0, paid: 0 };
      latest.set(a.contract_id, {
        claimed: num(a.cumulative_claimed),
        certified: a.cumulative_certified === null ? cur.certified : num(a.cumulative_certified),
        paid: comp.net_paid_running ?? cur.paid,
      });
      i++;
    }
    const t = { date, claimed: 0, certified: 0, paid: 0 };
    for (const v of latest.values()) {
      t.claimed = r2(t.claimed + v.claimed);
      t.certified = r2(t.certified + v.certified);
      t.paid = r2(t.paid + v.paid);
    }
    points.push(t);
  }
  return points;
}
