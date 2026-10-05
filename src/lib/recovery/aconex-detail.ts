import type { ReportData } from "../report/data";
import type { AconexReconciliation } from "./aconex";
import { parseEventNo } from "../workbook/aconex";
import { isDirectPaymentLine, contractKey } from "./aconex-codes";
import { pairRegisterChanges, refNumber, statusGroup } from "./aconex-changes";
import { CHANGE_STAGES, DEAD_STATUSES } from "../registers/defs/changes";
import { claimCostReportAmount } from "../registers/defs/claims";
import type { AconexMeasureKey } from "./aconex";
import type { RecordRow } from "../registers/types";

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
  register: { item: string; label: string; status: string; pvo: number | null; dvo: number | null; h: number | null; j: number | null } | null;
  /** how the register entry was paired when not simply by its PVO reference */
  pairedBy?: string;
  aconex: {
    event: string;
    label: string;
    status: string;
    impact: number | null;
    /** the approved value shown: the approved contract change, else an approved event's approved cost impact */
    approved: number | null;
    pending: number | null;
    /** what the control account totals: the event's approved / pending downstream contract changes */
    approvedAccount: number | null;
    pendingAccount: number | null;
  } | null;
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
  /** RSG's early-warning columns in the Aconex export (approved, pending), null on the dashboard side */
  ewApproved?: number | null;
  ewPending?: number | null;
  /** RSG's own estimate at completion (1115: approved budget less the early warnings RSG has approved), Aconex side only */
  eacRsg?: number | null;
  /** budget on hold: a .98 row's estimate at completion (Aconex side), the hold line's committed costs – Schedule B column E, column I here (dashboard side) */
  holdRsg?: number | null;
}
/** One change item's share of a line's difference: the register's value against Aconex's, paired by number. */
export interface DiffItem {
  key: string;
  item: string;
  event: string;
  label: string;
  register: number | null;
  aconex: number | null;
  diff: number;
  note: string;
}
/** Which items a line's difference comes from – listed so they add up to the figure in the totals. */
export interface DiffBlock {
  measure: "dvo" | "pvo";
  /** the line's difference on this figure (Aconex less dashboard) */
  total: number;
  /** what the listed items add up to – equal to the total when every item is paired by number */
  explained: number;
  items: DiffItem[];
  /** why the items may not reach the total: no events on file, final-account items inside the account, events of other kinds */
  notes: string[];
}
/** One item on one side of a figure – a PVO, an RFC, an early warning, a claim, a budget transfer, a certificate … */
export interface ExplainItem {
  ref: string;
  label: string;
  value: number;
  note?: string;
}
/**
 * The items behind a line's difference on one figure: Aconex's items less the dashboard's add up to the
 * difference; what neither side itemises (an opening transfer brought forward, a value Aconex holds
 * without an event) is the residual, named so the sum always ties.
 */
export interface ExplainBlock {
  total: number;
  explained: number;
  residual: number;
  residualNote: string;
  aconex: ExplainItem[];
  dashboard: ExplainItem[];
}
export interface LineDetail {
  code: string;
  contracts: string[];
  aconex: LineParts;
  dashboard: LineParts;
  changes: ChangePair[];
  byItem: { dvo: DiffBlock; pvo: DiffBlock };
  explain: Partial<Record<AconexMeasureKey, ExplainBlock>>;
  payments: PaymentItem[];
  paymentsTotal: number | null;
  transfers: { register: TransferItem[]; aconex: TransferItem[] };
}

/** the contract code with its section, as the check groups lines (MS.003F02, FFEOSE.003F02) */
const accOf = (code: string) => contractKey(code)?.key ?? null;
/** the bare contract code, as the change events and contracts name it (003F02) */
const fragOnly = (code: string) => contractKey(code)?.frag ?? null;

export function varianceDetail(data: ReportData, rec: AconexReconciliation): Record<string, LineDetail> {
  const lines = data.costReport.lines;
  const changes = data.registers.changes?.rows ?? [];
  const contracts = data.registers.contracts?.rows ?? [];
  const applications = data.registers.payment_applications?.rows ?? [];
  const transfers = data.registers.budget_transfers?.rows ?? [];
  const events = data.recovery.aconexEvents;
  const accounts = data.recovery.aconex;
  const earlyWarnings = data.registers.early_warnings?.rows ?? [];
  const claims = data.registers.claims?.rows ?? [];
  // a change's place in the cost report, as the report itself files it (one stage per change, the most advanced live one)
  const stLabel = (c: Record<string, unknown>, p: string) => String(c[`${p}_status_id__label`] ?? c[`${p}_status`] ?? "");
  const hasStage = (c: Record<string, unknown>, p: string) => !!(c[`${p}_ref`] || c[`${p}_date`] || stLabel(c, p) || (c[`${p}_cr_amount`] !== null && c[`${p}_cr_amount`] !== undefined));
  const liveStage = (c: Record<string, unknown>, p: string) => !DEAD_STATUSES.includes(stLabel(c, p));
  const stageOf = (c: Record<string, unknown>): { col: "H" | "J" | "K"; stage: string; amount: number; ref: string } | null => {
    if (DEAD_STATUSES.includes(String(c.overall_status_id__label ?? c.overall_status ?? ""))) return null;
    if (["Approved", "Review Complete"].includes(stLabel(c, "dvo"))) return { col: "H", stage: "DVO", amount: Number(c.dvo_cr_amount ?? 0), ref: String(c.dvo_ref ?? "") };
    const potential = [...CHANGE_STAGES].reverse().find((s) => (s.prefix === "vo" || s.prefix === "pvo") && hasStage(c, s.prefix) && liveStage(c, s.prefix) && Number(c[`${s.prefix}_cr_amount`] ?? 0) !== 0);
    if (potential) return { col: "J", stage: potential.short, amount: Number(c[`${potential.prefix}_cr_amount`] ?? 0), ref: String(c[`${potential.prefix}_ref`] ?? "") };
    if (hasStage(c, "rfc") && liveStage(c, "rfc")) return { col: "K", stage: "RFC", amount: Number(c.rfc_cr_amount ?? 0), ref: String(c.rfc_ref ?? "") };
    return null;
  };
  const sectionOfCode = (code: string) => {
    const m = String(code).toUpperCase().match(/(?:^|\.)([A-Z&]{2,6})\.(?:\d{3}[A-Z]\d{2,3}|98)/);
    return m ? m[1] : null;
  };
  const out: Record<string, LineDetail> = {};
  const byId = new Map(lines.map((l) => [l.id, l]));
  // lines tied to an Aconex row of another code belong to that row alone (as the check builds them)
  const explicit = new Set<number>();
  for (const a of accounts) {
    const l = byId.get(Number(a.cost_line_id));
    if (l && String(a.row_type ?? "") !== "Budget hold" && accOf(String(a.code ?? "")) !== accOf(l.code)) explicit.add(l.id);
  }
  for (const rl of rec.lines) {
    if (rl.status !== "matched" || out[rl.code]) continue;
    const direct = rl.rowType === "Direct payment";
    const frag = rl.rowType === "Budget hold" || direct ? null : accOf(rl.aconexCode) ?? accOf(rl.code);
    const own = accounts.find((a) => String(a.code ?? "") === rl.aconexCode);
    const tied = own ? byId.get(Number(own.cost_line_id)) : undefined;
    const sameKey = frag ? lines.filter((l) => !l.is_budget_hold && accOf(l.code) === frag && !explicit.has(l.id)) : [];
    // one side without a section: the code's only group
    const sameFrag = frag && !sameKey.length ? lines.filter((l) => !l.is_budget_hold && fragOnly(l.code) === fragOnly(frag) && !explicit.has(l.id)) : [];
    const group = sameKey.length ? sameKey : frag && new Set(sameFrag.map((l) => accOf(l.code))).size === 1 && (!frag.includes(".") || !accOf(sameFrag[0].code)?.includes(".")) ? sameFrag : [];
    const members = direct ? lines.filter((l) => !l.is_budget_hold && isDirectPaymentLine(l.code, l.name)) : group.length ? group : tied ? [tied] : lines.filter((l) => l.code === rl.code.replace(/ \(\+\d+ lines?\)$/, ""));
    const ids = new Set(members.map((m) => m.id));
    const packages = new Set(members.map((m) => m.package_id));
    // the dashboard's figures, over the line's members
    const d: LineParts = { baseline: 0, transfers: 0, budgetChanges: null, budget: 0, awarded: null, dvo: 0, commitments: 0, pvo: 0, rfc: 0, ew: 0, claims: 0, eac: 0, incurred: 0, holdRsg: members.some((m) => m.is_budget_hold) ? r2(members.filter((m) => m.is_budget_hold).reduce((t, m) => t + (m.I ?? 0), 0)) : null };
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
    const rows = direct ? accounts.filter((a) => String(a.row_type ?? "") === "Direct payment") : accounts.filter((a) => rec.lines.some((x) => x.code === rl.code && x.aconexCode === String(a.code ?? "")));
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
      // a .98 row is unspent, unallocated budget: its budget on hold is its estimate at completion; RSG's early-warning
      // columns on it are not read (what RSG keeps there is not an early warning)
      const hold = String(r.row_type ?? "") === "Budget hold";
      if (hold) a.holdRsg = add(a.holdRsg ?? null, n(r.eac));
      if (!hold && r.approved_early_warnings_rsg !== null && r.approved_early_warnings_rsg !== undefined) a.ewApproved = add(a.ewApproved ?? null, n(r.approved_early_warnings_rsg));
      if (!hold && r.pending_early_warnings_rsg !== null && r.pending_early_warnings_rsg !== undefined) a.ewPending = add(a.ewPending ?? null, n(r.pending_early_warnings_rsg));
      if (a.ewApproved !== null && a.ewApproved !== undefined) a.ew = add(a.ew, 0);
      // the standard Aconex EAC (the approved budget) is compared; RSG's own 1115 is shown beside it
      a.eac = add(a.eac, n(r.eac));
      if (r.eac_rsg !== null && r.eac_rsg !== undefined) a.eacRsg = add(a.eacRsg ?? null, hold ? n(r.eac) : n(r.eac_rsg));
      a.incurred = add(a.incurred, n(r.incurred_to_date));
    }
    if (a.ewApproved !== undefined || a.ewPending !== undefined) a.ew = (a.ewApproved ?? 0) + (a.ewPending ?? 0);
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
    const btr: TransferItem[] = [];
    const bare = frag ? fragOnly(frag) : null;
    if (bare) {
      for (const e of events) {
        const parsed = parseEventNo(String(e.event_no ?? ""));
        const ef = String(e.contract_frag ?? "").toUpperCase() || parsed.frag || "";
        if (ef !== bare) continue;
        const status = String(e.cost_status ?? e.budget_status ?? "");
        if (parsed.kind === "BTR") {
          btr.push({ ref: String(e.event_no ?? ""), label: String(e.name ?? ""), status, amount: n(e.total_budget_impact), direction: "in" });
          continue;
        }
        const key = (parsed.kind === "PVO" || parsed.kind === "RFC") && parsed.number !== null ? `${parsed.kind}:${parsed.number}` : `event:${String(e.event_no ?? "")}`;
        const g = statusGroup(status);
        const p = pair(key);
        const item = {
          event: String(e.event_no ?? ""),
          label: String(e.name ?? ""),
          status,
          impact: n(e.total_cost_impact),
          approved: n(e.approved_contract_changes) || (g === "approved" ? n(e.approved_cost_impact) : null),
          pending: n(e.pending_contract_changes) || (g === "pending" ? n(e.total_cost_impact) : null),
          approvedAccount: n(e.approved_contract_changes),
          pendingAccount: n(e.pending_contract_changes),
        };
        if (p.aconex && g === "cancelled") continue; // a cancelled duplicate never displaces the live event
        if (p.aconex && statusGroup(p.aconex.status) === "cancelled") p.aconex = item;
        else if (!p.aconex) p.aconex = item;
        else {
          p.aconex.event += ` + ${item.event}`;
          p.aconex.impact = add(p.aconex.impact, item.impact);
          p.aconex.approved = add(p.aconex.approved, item.approved);
          p.aconex.pending = add(p.aconex.pending, item.pending);
          p.aconex.approvedAccount = add(p.aconex.approvedAccount, item.approvedAccount);
          p.aconex.pendingAccount = add(p.aconex.pendingAccount, item.pendingAccount);
        }
      }
    }
    // the register's changes on the line, each paired with the event its references and values name
    const lineRegs = changes.filter((c) => ids.has(Number(c.cost_line_id)));
    const eventValues = new Map<string, { approved: number | null; impact: number | null }>();
    for (const p of pairs.values()) if (p.aconex) eventValues.set(p.key, { approved: p.aconex.approved, impact: p.aconex.impact });
    const pairing = pairRegisterChanges(lineRegs, eventValues);
    for (const c of lineRegs) {
      const how = pairing.get(Number(c.id));
      const key = how?.pvoKey ?? how?.rfcKey ?? `item:${String(c.item_no ?? c.id)}`;
      // the cost-report amounts, as Schedule B counts them (the tracker amount is the contractor's figure)
      const pvo = n(c.pvo_cr_amount ?? c.pvo_tracker_amount);
      const dvo = n(c.dvo_cr_amount ?? c.dvo_tracker_amount);
      const st = stageOf(c);
      const h = st?.col === "H" ? st.amount : null;
      const j = st?.col === "J" ? st.amount : null;
      const p = pair(key);
      const fa = /final\s*account/i.test(String(c.change_category_id__label ?? ""));
      if (fa && key.startsWith("item:")) p.finding = "final account adjustment – inside Aconex's approved contract changes on the control account, no change event of its own";
      if (how?.note) p.pairedBy = p.pairedBy ? `${p.pairedBy}; ${how.note}` : how.note;
      if (p.register) {
        p.register.item += ` + ${String(c.item_no ?? c.id)}`;
        p.register.pvo = add(p.register.pvo, pvo);
        p.register.dvo = add(p.register.dvo, dvo);
        p.register.h = add(p.register.h, h);
        p.register.j = add(p.register.j, j);
      } else p.register = { item: String(c.item_no ?? c.id), label: String(c.description ?? ""), status: String(c.overall_status_id__label ?? ""), pvo, dvo, h, j };
    }
    for (const p of pairs.values()) {
      if (p.finding) continue;
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
      if (p.pairedBy) p.finding = `${p.finding} (${p.pairedBy})`;
    }
    const order = (k: string) => (k.startsWith("PVO:") ? 0 : k.startsWith("RFC:") ? 1 : 2);
    const changeList = [...pairs.values()].sort((x, y) => order(x.key) - order(y.key) || (refNumber(x.key.split(":")[1]) ?? 0) - (refNumber(y.key.split(":")[1]) ?? 0) || x.key.localeCompare(y.key));
    // the payments: every application on the contracts tied to the line
    const contractIds = new Set(contracts.filter((c) => ids.has(Number(c.cost_line_id)) || (bare && fragOnly(String(c.acc_ref ?? "")) === bare)).map((c) => Number(c.id)));
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
    // which items the DVO / PVO difference comes from: each pair's register value against Aconex's, so the
    // list adds up to the line's difference and the one item behind a 309.58 is named, not just listed
    const block = (measure: "dvo" | "pvo"): DiffBlock => {
      const total = r2(((measure === "dvo" ? a.dvo : a.pvo) ?? 0) - ((measure === "dvo" ? d.dvo : d.pvo) ?? 0));
      const items: DiffItem[] = [];
      const notes: string[] = [];
      const what = measure === "dvo" ? "DVO" : "PVO";
      const isFa = (p: ChangePair) => p.finding.startsWith("final account adjustment") || /final\s*account|\bFAS\b/i.test(p.register?.label ?? "");
      if (rl.rowType === "Budget hold") {
        notes.push(`a budget hold has no change events of its own – Aconex's ${measure === "dvo" ? "approved" : "pending"} changes on the .98 row are budget moved off the hold, set against the dashboard's hold line in the budget-on-hold breakdown`);
        return { measure, total, explained: 0, items, notes };
      }
      if (!events.length && lineRegs.length) {
        if (Math.abs(total) >= 1) notes.push(`no Aconex change events on file for this project – upload the change-event export to see which items make up the difference`);
        return { measure, total, explained: 0, items, notes };
      }
      for (const p of changeList) {
        // what the cost report counts for the item: column H for a DVO, column J for a potential change
        const register = measure === "dvo" ? (p.register?.h ?? null) : (p.register?.j ?? null);
        // what the control account totals: the event's approved / pending downstream contract changes
        const aconex = !p.aconex ? null : measure === "dvo" ? p.aconex.approvedAccount : p.aconex.pendingAccount;
        const diff = r2((aconex ?? 0) - (register ?? 0));
        if (Math.abs(diff) < 0.005) continue;
        const extra: string[] = [];
        if (p.aconex && measure === "dvo" && (p.aconex.approvedAccount ?? 0) === 0 && p.aconex.approved !== null && Math.abs(p.aconex.approved) >= 1) extra.push(`Aconex event approved with a cost impact of ${fmt(p.aconex.approved)}, not yet a contract change on the control account`);
        if (p.aconex && measure === "pvo" && (p.aconex.pendingAccount ?? 0) === 0 && p.aconex.impact !== null && Math.abs(p.aconex.impact) >= 1 && statusGroup(p.aconex.status) === "pending") extra.push(`Aconex event ${p.aconex.status.toLowerCase()} with a cost impact of ${fmt(p.aconex.impact)}, not counted as a pending contract change on the control account`);
        if (!p.aconex && isFa(p)) extra.push("final account adjustment");
        if (p.pairedBy) extra.push(p.pairedBy);
        const base = !p.register ? `only in Aconex – nothing on the register` : !p.aconex ? `${what} on the register, no Aconex event` : register === null ? `Aconex carries a value, the register none` : aconex === null || Math.abs(aconex) < 0.005 ? `the register carries a value, Aconex none` : `register ${what} ${fmt(register)} vs Aconex ${fmt(aconex)}`;
        items.push({ key: p.key, item: p.register?.item ?? "", event: p.aconex?.event ?? "", label: p.register?.label || p.aconex?.label || "", register, aconex, diff, note: [base, ...extra].join("; ") });
      }
      // a register item Aconex holds inside the control account without an event of its own (a final account
      // adjustment, a negotiated figure): the items without an event whose values are exactly what the events
      // leave unexplained are counted as agreeing, and named
      const residualOf = () => r2(total - r2(items.reduce((t, i) => t + i.diff, 0)));
      if (Math.abs(residualOf()) >= 1) {
        const lone = items.filter((i) => !i.event && i.register !== null);
        const pick = (): DiffItem[] | null => {
          const need = -residualOf();
          for (const x of lone) if (Math.abs(x.diff - need) < 1) return [x];
          for (let i = 0; i < lone.length; i++) for (let j = i + 1; j < lone.length; j++) if (Math.abs(lone[i].diff + lone[j].diff - need) < 1) return [lone[i], lone[j]];
          for (let i = 0; i < lone.length; i++) for (let j = i + 1; j < lone.length; j++) for (let k = j + 1; k < lone.length; k++) if (Math.abs(lone[i].diff + lone[j].diff + lone[k].diff - need) < 1) return [lone[i], lone[j], lone[k]];
          return null;
        };
        const inside = pick();
        if (inside) {
          for (const x of inside) items.splice(items.indexOf(x), 1);
          notes.push(`${inside.map((x) => `${x.item} ${x.label.slice(0, 50)} (${fmt(x.register ?? 0)})`).join("; ")}: ${inside.length > 1 ? "these register items have" : "this register item has"} no Aconex change event, but Aconex's ${measure === "dvo" ? "approved" : "pending"} changes on the control account carry exactly ${inside.length > 1 ? "their" : "its"} value${inside.some((x) => /final account/i.test(x.note)) ? " (a final account adjustment is booked on the account without an event)" : ""} – counted as agreeing`);
        }
      }
      // two items that cancel each other out (Aconex carries both under one event, the register as two)
      for (const x of items) {
        const y = items.find((o) => o !== x && Math.abs(o.diff + x.diff) < 0.005);
        if (y) x.note += ` – cancels out with ${y.item || y.event}`;
      }
      items.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
      const explained = r2(items.reduce((t, i) => t + i.diff, 0));
      const residual = r2(total - explained);
      if (Math.abs(residual) >= 1) {
        const other = btr.filter((b) => statusGroup(b.status) === "approved").map((b) => `${b.ref} ${b.label.slice(0, 60)} (${fmt(b.amount ?? 0)})`);
        notes.push(`${fmt(residual)} is not itemised: Aconex's ${measure === "dvo" ? "approved" : "pending"} changes on the control account differ from its change events by that much${other.length ? ` – the contract's budget transfers may carry it: ${other.join("; ")}` : ""}`);
      }
      return { measure, total, explained, items, notes };
    };
    // the items behind each figure's difference on this line
    const sum = (items: ExplainItem[]) => r2(items.reduce((t, i) => t + i.value, 0));
    const mk = (total: number, aconexItems: ExplainItem[], dashboardItems: ExplainItem[], residualNote: string): ExplainBlock => {
      const explained = r2(sum(aconexItems) - sum(dashboardItems));
      return { total, explained, residual: r2(total - explained), residualNote, aconex: aconexItems, dashboard: dashboardItems };
    };
    const isHold = rl.rowType === "Budget hold";
    const lineChanges = lineRegs;
    const changeItems = (cols: ("H" | "J" | "K")[]): ExplainItem[] =>
      lineChanges
        .map((c) => ({ c, s: stageOf(c) }))
        .filter((x): x is { c: RecordRow; s: NonNullable<ReturnType<typeof stageOf>> } => !!x.s && cols.includes(x.s.col))
        .map(({ c, s }) => ({ ref: String(c.item_no ?? c.id), label: `${s.stage}${s.ref ? ` ${s.ref}` : ""} – ${String(c.description ?? "")}`, value: r2(s.amount), note: s.col === "H" ? "column H – determined variation order" : s.col === "J" ? "column J – potential variation order" : "column K – request for change" }));
    const ewItems: ExplainItem[] = earlyWarnings.filter((e) => ids.has(Number(e.cost_line_id)) && String(e.status ?? "") === "Open").map((e) => ({ ref: String(e.ew_no ?? e.id), label: String(e.description ?? ""), value: r2(n(e.cost_impact) ?? 0), note: "column L – open early warning" }));
    const claimItems: ExplainItem[] = claims.filter((c) => ids.has(Number(c.cost_line_id)) && claimCostReportAmount(c as Record<string, unknown>) !== 0).map((c) => ({ ref: String(c.claim_no ?? c.id), label: String(c.description ?? ""), value: r2(claimCostReportAmount(c as Record<string, unknown>)), note: "column M – claim carried in the cost report" }));
    const btrItems = (filter: (e: RecordRow, ef: string) => boolean): ExplainItem[] =>
      events
        .filter((e) => parseEventNo(String(e.event_no ?? "")).kind === "BTR" && statusGroup(String(e.budget_status ?? e.cost_status ?? "")) === "approved")
        .filter((e) => filter(e, String(e.contract_frag ?? "").toUpperCase() || parseEventNo(String(e.event_no ?? "")).frag || ""))
        .map((e) => ({ ref: String(e.event_no ?? ""), label: String(e.name ?? ""), value: r2(n(e.total_budget_impact) ?? 0), note: "Aconex budget transfer (approved)" }));
    const regTransferItems: ExplainItem[] = regTransfers.filter((t) => statusGroup(t.status) === "approved" && t.direction !== "within").map((t) => ({ ref: t.ref, label: t.label, value: r2(t.direction === "in" ? (t.amount ?? 0) : -(t.amount ?? 0)), note: `budget transfer ${t.direction === "in" ? "into" : "out of"} the line's package (column F)` }));
    const explain: Partial<Record<AconexMeasureKey, ExplainBlock>> = {};
    if (isHold) {
      // budget on hold: Aconex moves budget off the hold when a contract is awarded or a DVO approved (BTR events on the
      // hold's section); the dashboard carries transfers (F) and DVO drawdowns (H) on the hold line
      // the BTR events that name this hold ("from 1TB01031.01.CN.98 to …", "to CN BH", "from CN Budget Hold")
      const section = sectionOfCode(rl.aconexCode) ?? "";
      const holdCode = rl.aconexCode.toUpperCase();
      const names = [holdCode, `${section} BH`, `${section} BUDGET HOLD`, `${section}.98`].filter(Boolean);
      const mentions = (text: string, dir: "from" | "to") => names.some((nm) => new RegExp(`${dir}\\s+(?:THE\\s+)?(?:[A-Z0-9.]*\\s+)?${nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(text));
      const outOf = events
        .filter((e) => parseEventNo(String(e.event_no ?? "")).kind === "BTR" && statusGroup(String(e.budget_status ?? e.cost_status ?? "")) === "approved")
        .map((e) => {
          const text = `${String(e.name ?? "")} ${String(e.description ?? "")}`.toUpperCase();
          const from = mentions(text, "from");
          const to = mentions(text, "to");
          if (!from && !to) return null;
          const v = Math.abs(n(e.total_budget_impact) ?? 0);
          return { ref: String(e.event_no ?? ""), label: String(e.name ?? ""), value: r2(from && !to ? -v : to && !from ? v : 0), note: from && !to ? "Aconex budget transfer out of the hold (approved)" : to && !from ? "Aconex budget transfer into the hold (approved)" : "names the hold on both sides" } as ExplainItem;
        })
        .filter((x): x is ExplainItem => !!x);
      const holdDvo = changeItems(["H"]).map((i) => ({ ...i, note: "column H – DVO drawn from the hold" }));
      const baseline: ExplainItem[] = Math.abs((a.baseline ?? 0) - (d.baseline ?? 0)) >= 0.005 ? [{ ref: "Baseline", label: "Baseline budget of the hold: Aconex less the dashboard", value: r2((a.baseline ?? 0) - (d.baseline ?? 0)), note: "Schedule B column A" }] : [];
      const holdNote = "the two systems start the hold from different bases (Aconex's hold baseline carries the contract awards the dashboard's baseline already leaves out) and transfers no BTR event names – only the items named on each side are listed";
      explain.hold = mk(r2((a.eac ?? 0) - (d.commitments ?? 0)), [...baseline, ...outOf], [...regTransferItems, ...holdDvo], holdNote);
      explain.budget = mk(r2((a.budget ?? 0) - (d.budget ?? 0)), [...baseline, ...outOf], regTransferItems, holdNote);
      explain.eac = explain.hold;
    } else {
      const headroom: ExplainItem[] = [{ ref: "Aconex", label: "Approved budget above current commitments (the standard Aconex EAC is the budget)", value: r2((a.budget ?? 0) - (a.commitments ?? 0)), note: "Aconex approved budget less current commitments" }];
      const commitGap: ExplainItem[] = Math.abs((a.commitments ?? 0) - (d.commitments ?? 0)) >= 0.005 ? [{ ref: "Commitments", label: "Commitments differ between the systems – see the Commitments figure for the items", value: r2((a.commitments ?? 0) - (d.commitments ?? 0)), note: "Aconex current commitments less column I" }] : [];
      const uncommitted = [...changeItems(["J", "K"]), ...ewItems, ...claimItems];
      explain.eac = mk(r2((a.eac ?? 0) - (d.eac ?? 0)), [...headroom, ...commitGap], uncommitted, "a value one side carries without an item: a PVO, RFC, early warning or claim on the dashboard not tied to this line, or an Aconex figure without an event");
      explain.eac_rsg = mk(r2((a.eacRsg ?? a.eac ?? 0) - (d.eac ?? 0)), [...headroom, ...commitGap, ...((a.ewApproved ?? 0) + (a.ewPending ?? 0) !== 0 ? [{ ref: "RSG", label: "RSG's early warnings on the contract row (approved + pending)", value: r2((a.ewApproved ?? 0) + (a.ewPending ?? 0)) }] : [])], uncommitted, "a value one side carries without an item");
      const awarded: ExplainItem[] = Math.abs((a.awarded ?? 0) - (d.budget ?? 0)) >= 0.005 ? [{ ref: "Award", label: "Awarded contract: Aconex approved contracts less the dashboard's latest budget (column G)", value: r2((a.awarded ?? 0) - (d.budget ?? 0)), note: "the award itself, before any change" }] : [];
      const dvoDiffs: ExplainItem[] = block("dvo").items.map((i) => ({ ref: i.item || i.event, label: i.label, value: i.diff, note: i.note }));
      explain.commitments = mk(r2((a.commitments ?? 0) - (d.commitments ?? 0)), [...awarded, ...dvoDiffs], [], "approved changes neither side itemises");
      explain.dvo = mk(r2((a.dvo ?? 0) - (d.dvo ?? 0)), dvoDiffs, [], "approved changes neither side itemises");
      explain.pvo = mk(r2((a.pvo ?? 0) - (d.pvo ?? 0)), block("pvo").items.map((i) => ({ ref: i.item || i.event, label: i.label, value: i.diff, note: i.note })), [], "pending changes neither side itemises");
      const transfersIn = btrItems((_e, ef) => !!frag && ef === fragOnly(frag));
      const baselineDiff: ExplainItem[] = Math.abs((a.baseline ?? 0) - (d.baseline ?? 0)) >= 0.005 ? [{ ref: "Baseline", label: "Baseline budget: Aconex less the dashboard", value: r2((a.baseline ?? 0) - (d.baseline ?? 0)), note: "Schedule B column A" }] : [];
      explain.budget = mk(r2((a.budget ?? 0) - (d.budget ?? 0)), [...baselineDiff, ...transfersIn, ...((a.budgetChanges ?? 0) !== 0 ? [{ ref: "Changes", label: "Approved budget changes in Aconex", value: r2(a.budgetChanges ?? 0) }] : [])], regTransferItems, "transfers neither side itemises (opening transfers brought forward; Aconex transfers without a BTR event)");
      explain.ew = mk(r2((a.ew ?? 0) - (d.ew ?? 0)), (a.ewApproved ?? 0) + (a.ewPending ?? 0) !== 0 ? [{ ref: "RSG", label: "RSG's early warnings on the contract row (approved + pending)", value: r2((a.ewApproved ?? 0) + (a.ewPending ?? 0)) }] : [], ewItems, "");
      const certified: ExplainItem[] = contracts.filter((c) => contractIds.has(Number(c.id))).map((c) => ({ ref: String(c.acc_ref ?? c.id), label: String(c.title ?? ""), value: r2(n(c.latest_cum_certified) ?? 0), note: "latest certified to date on the contract (column P)" }));
      explain.incurred = mk(r2((a.incurred ?? 0) - (d.incurred ?? 0)), [{ ref: "Aconex", label: "Incurred to date on the control account", value: r2(a.incurred ?? 0), note: "the export carries the total only" }], certified, "certified amounts not on a contract tied to this line");
    }
    out[rl.code] = { code: rl.code, contracts: bare ? [bare] : [], aconex: a, dashboard: d, changes: changeList, byItem: { dvo: block("dvo"), pvo: block("pvo") }, explain, payments, paymentsTotal, transfers: { register: regTransfers, aconex: btr } };
  }
  return out;
}

function fmt(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
