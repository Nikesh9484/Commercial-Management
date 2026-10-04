import type { ReportData } from "../report/data";
import type { AconexReconciliation } from "./aconex";
import { parseEventNo } from "../workbook/aconex";
import { refNumber, statusGroup } from "./aconex-changes";

/**
 * What sits behind a line of the Aconex control-account check – the items each side holds, so a
 * difference can be traced to the PVO, DVO, payment certificate or budget transfer that one system
 * carries and the other does not (or carries at another value):
 *  - the register's changes on the line's contract (PVO and DVO values) paired with Aconex's change
 *    events on that contract by PVO / RFC number;
 *  - the register's payment applications (IPCs) on the line's contracts, against Aconex's incurred total
 *    (the exports carry no payment detail on the Aconex side);
 *  - the register's budget transfers touching the line's package, against Aconex's BTR events;
 *  - and the figures each side builds its totals from (baseline, transfers, award, changes …).
 */
const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v) || 0);
const r2 = (x: number) => Math.round(x * 100) / 100;
const add = (a: number | null, b: number | null) => (a === null && b === null ? null : r2((a ?? 0) + (b ?? 0)));

export interface ChangePair {
  key: string;
  register: { item: string; label: string; status: string; pvo: number | null; dvo: number | null } | null;
  aconex: { event: string; label: string; status: string; impact: number | null; approved: number | null; pending: number | null } | null;
  finding: string;
}
export interface PaymentItem {
  ref: string;
  ipc: string;
  date: string;
  contract: string;
  month: number | null;
  cumulative: number | null;
  status: string;
}
export interface TransferItem {
  ref: string;
  label: string;
  status: string;
  amount: number | null;
  direction: string;
}
export interface LineParts {
  baseline: number | null;
  transfers: number | null;
  budgetChanges: number | null;
  budget: number | null;
  awarded: number | null;
  dvo: number | null;
  commitments: number | null;
  pvo: number | null;
  rfc: number | null;
  ew: number | null;
  claims: number | null;
  eac: number | null;
  incurred: number | null;
}
export interface LineDetail {
  code: string;
  contracts: string[];
  aconex: LineParts;
  dashboard: LineParts;
  changes: ChangePair[];
  payments: PaymentItem[];
  paymentsTotal: number | null;
  transfers: { register: TransferItem[]; aconex: TransferItem[] };
}

const accOf = (code: string) => code.match(/\b(\d{3}[A-Z]\d{2})\b/)?.[1]?.toUpperCase() ?? null;

export function varianceDetail(data: ReportData, rec: AconexReconciliation): Record<string, LineDetail> {
  const lines = data.costReport.lines;
  const changes = data.registers.changes?.rows ?? [];
  const contracts = data.registers.contracts?.rows ?? [];
  const applications = data.registers.payment_applications?.rows ?? [];
  const transfers = data.registers.budget_transfers?.rows ?? [];
  const events = data.recovery.aconexEvents;
  const accounts = data.recovery.aconex;
  const out: Record<string, LineDetail> = {};
  for (const rl of rec.lines) {
    if (rl.status !== "matched" || out[rl.code]) continue;
    const frag = rl.rowType === "Budget hold" ? null : accOf(rl.aconexCode) ?? accOf(rl.code);
    const members = frag ? lines.filter((l) => !l.is_budget_hold && accOf(l.code) === frag) : lines.filter((l) => l.code === rl.code.replace(/ \(\+\d+ lines?\)$/, ""));
    const ids = new Set(members.map((m) => m.id));
    const packages = new Set(members.map((m) => m.package_id));
    // the dashboard's figures, over the line's members
    const d: LineParts = { baseline: 0, transfers: 0, budgetChanges: null, budget: 0, awarded: null, dvo: 0, commitments: 0, pvo: 0, rfc: 0, ew: 0, claims: 0, eac: 0, incurred: 0 };
    for (const m of members) {
      d.baseline = r2((d.baseline ?? 0) + m.E);
      d.transfers = r2((d.transfers ?? 0) + m.F);
      d.budget = r2((d.budget ?? 0) + m.G);
      d.dvo = r2((d.dvo ?? 0) + m.H);
      d.commitments = r2((d.commitments ?? 0) + m.I);
      d.pvo = r2((d.pvo ?? 0) + m.J);
      d.rfc = r2((d.rfc ?? 0) + m.K);
      d.ew = r2((d.ew ?? 0) + m.L);
      d.claims = r2((d.claims ?? 0) + m.M);
      d.eac = r2((d.eac ?? 0) + m.N);
      d.incurred = r2((d.incurred ?? 0) + m.P);
    }
    d.awarded = d.budget; // the award sits in column G (awarded contract / latest budget); the DVOs come on top in H
    // Aconex's figures: every control-account row pointing at this line
    const rows = accounts.filter((a) => rec.lines.some((x) => x.code === rl.code && x.aconexCode === String(a.code ?? "")));
    const a: LineParts = { baseline: null, transfers: null, budgetChanges: null, budget: null, awarded: null, dvo: null, commitments: null, pvo: null, rfc: null, ew: null, claims: null, eac: null, incurred: null };
    for (const r of rows) {
      a.baseline = add(a.baseline, n(r.baseline_budget));
      a.transfers = add(a.transfers, n(r.approved_budget_transfers));
      a.budgetChanges = add(a.budgetChanges, n(r.approved_budget_changes));
      a.budget = add(a.budget, n(r.approved_budget));
      a.awarded = add(a.awarded, n(r.approved_contracts));
      a.dvo = add(a.dvo, n(r.approved_changes));
      a.commitments = add(a.commitments, n(r.current_commitments));
      a.pvo = add(a.pvo, n(r.pending_changes));
      a.eac = add(a.eac, n(r.eac));
      a.incurred = add(a.incurred, n(r.incurred_to_date));
    }
    // the changes: register entries on the line's cost lines, Aconex events on the contract, paired by number
    const pairs = new Map<string, ChangePair>();
    const pair = (key: string) => {
      let p = pairs.get(key);
      if (!p) {
        p = { key, register: null, aconex: null, finding: "" };
        pairs.set(key, p);
      }
      return p;
    };
    for (const c of changes) {
      if (!ids.has(Number(c.cost_line_id))) continue;
      const pvoNum = refNumber(c.pvo_ref);
      const rfcNum = refNumber(c.rfc_ref);
      const key = pvoNum !== null ? `PVO:${pvoNum}` : rfcNum !== null ? `RFC:${rfcNum}` : `item:${String(c.item_no ?? c.id)}`;
      const pvo = n(c.pvo_tracker_amount ?? c.pvo_cr_amount);
      const dvo = n(c.dvo_tracker_amount ?? c.dvo_cr_amount);
      const p = pair(key);
      if (p.register) {
        p.register.item += ` + ${String(c.item_no ?? c.id)}`;
        p.register.pvo = add(p.register.pvo, pvo);
        p.register.dvo = add(p.register.dvo, dvo);
      } else p.register = { item: String(c.item_no ?? c.id), label: String(c.description ?? ""), status: String(c.overall_status_id__label ?? ""), pvo, dvo };
    }
    const btr: TransferItem[] = [];
    if (frag) {
      for (const e of events) {
        const parsed = parseEventNo(String(e.event_no ?? ""));
        const ef = String(e.contract_frag ?? "").toUpperCase() || parsed.frag || "";
        if (ef !== frag) continue;
        const status = String(e.cost_status ?? e.budget_status ?? "");
        if (parsed.kind === "BTR") {
          btr.push({ ref: String(e.event_no ?? ""), label: String(e.name ?? ""), status, amount: n(e.total_budget_impact), direction: "in" });
          continue;
        }
        const key = (parsed.kind === "PVO" || parsed.kind === "RFC") && parsed.number !== null ? `${parsed.kind}:${parsed.number}` : `event:${String(e.event_no ?? "")}`;
        const g = statusGroup(status);
        const p = pair(key);
        const item = { event: String(e.event_no ?? ""), label: String(e.name ?? ""), status, impact: n(e.total_cost_impact), approved: n(e.approved_contract_changes) || (g === "approved" ? n(e.approved_cost_impact) : null), pending: n(e.pending_contract_changes) || (g === "pending" ? n(e.total_cost_impact) : null) };
        if (p.aconex && g === "cancelled") continue; // a cancelled duplicate never displaces the live event
        if (p.aconex && statusGroup(p.aconex.status) === "cancelled") p.aconex = item;
        else if (!p.aconex) p.aconex = item;
        else {
          p.aconex.event += ` + ${item.event}`;
          p.aconex.impact = add(p.aconex.impact, item.impact);
          p.aconex.approved = add(p.aconex.approved, item.approved);
          p.aconex.pending = add(p.aconex.pending, item.pending);
        }
      }
    }
    for (const p of pairs.values()) {
      if (!p.register) p.finding = "only in Aconex – not on the change register";
      else if (!p.aconex) p.finding = "only on the dashboard – no Aconex change event";
      else {
        const notes: string[] = [];
        const rg = statusGroup(p.register.status);
        const ag = statusGroup(p.aconex.status);
        if (rg !== "unknown" && ag !== "unknown" && rg !== ag) notes.push(`status: register ${p.register.status.toLowerCase()}, Aconex ${p.aconex.status.toLowerCase()}`);
        if (p.register.dvo !== null && p.aconex.approved !== null && Math.abs(p.register.dvo - p.aconex.approved) >= 1) notes.push(`DVO ${fmt(p.register.dvo)} vs Aconex approved ${fmt(p.aconex.approved)}`);
        if (p.register.dvo === null && p.aconex.approved !== null && Math.abs(p.aconex.approved) >= 1) notes.push("approved in Aconex, no DVO value on the register");
        if (p.register.dvo !== null && Math.abs(p.register.dvo) >= 1 && (p.aconex.approved === null || Math.abs(p.aconex.approved) < 1)) notes.push("DVO on the register, nothing approved in Aconex");
        if (p.register.pvo !== null && p.aconex.impact !== null && Math.abs(p.register.pvo - p.aconex.impact) >= 1) notes.push(`PVO ${fmt(p.register.pvo)} vs Aconex impact ${fmt(p.aconex.impact)}`);
        p.finding = notes.join("; ") || "agrees";
      }
    }
    const order = (k: string) => (k.startsWith("PVO:") ? 0 : k.startsWith("RFC:") ? 1 : 2);
    const changeList = [...pairs.values()].sort((x, y) => order(x.key) - order(y.key) || (refNumber(x.key.split(":")[1]) ?? 0) - (refNumber(y.key.split(":")[1]) ?? 0) || x.key.localeCompare(y.key));
    // the payments: every application on the contracts tied to the line
    const contractIds = new Set(contracts.filter((c) => ids.has(Number(c.cost_line_id)) || (frag && accOf(String(c.acc_ref ?? "")) === frag)).map((c) => Number(c.id)));
    const contractName = new Map(contracts.map((c) => [Number(c.id), String(c.title ?? c.acc_ref ?? c.id)]));
    const payments: PaymentItem[] = applications
      .filter((p) => contractIds.has(Number(p.contract_id)))
      .map((p) => ({ ref: String(p.application_no ?? ""), ipc: String(p.ipc_no ?? ""), date: String(p.ipc_date ?? p.application_date ?? ""), contract: contractName.get(Number(p.contract_id)) ?? "", month: n(p.gross_certified_month), cumulative: n(p.cumulative_certified), status: String(p.status ?? p.current_status ?? "") }))
      .sort((x, y) => x.contract.localeCompare(y.contract) || x.date.localeCompare(y.date) || x.ref.localeCompare(y.ref, undefined, { numeric: true }));
    const paymentsTotal = payments.length ? r2(payments.reduce((t, p) => t + (p.month ?? 0), 0)) : null;
    // the transfers: the register's touching the line's packages, Aconex's BTR events on the contract
    const regTransfers: TransferItem[] = transfers
      .filter((t) => packages.has(Number(t.to_package_id)) || packages.has(Number(t.from_package_id)))
      .map((t) => ({ ref: String(t.item ?? t.id), label: String(t.description ?? ""), status: String(t.status ?? ""), amount: n(t.amount), direction: packages.has(Number(t.to_package_id)) && packages.has(Number(t.from_package_id)) ? "within" : packages.has(Number(t.to_package_id)) ? "in" : "out" }));
    out[rl.code] = { code: rl.code, contracts: frag ? [frag] : [], aconex: a, dashboard: d, changes: changeList, payments, paymentsTotal, transfers: { register: regTransfers, aconex: btr } };
  }
  return out;
}

function fmt(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
