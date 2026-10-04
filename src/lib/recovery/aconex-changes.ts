import type { RecordRow } from "../registers/types";
import type { ReportData } from "../report/data";
import { parseEventNo } from "../workbook/aconex";

/**
 * The Aconex change events set against the change register, contractor by contractor: for every
 * contractor the approved and pending change value each system holds and the variance between them,
 * and beneath it every event – matched to its change register entry by contract and PVO / RFC number –
 * with the two values and the difference, the events only Aconex has, and the register's changes Aconex
 * has no event for. Budget transfers (BTR) are listed under the contractor whose contract they fund and
 * compared with the register's approved transfers into that contractor's packages.
 */
const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const r2 = (x: number) => Math.round(x * 100) / 100;
export const EVENT_TOLERANCE = 1;

export type StatusGroup = "approved" | "pending" | "cancelled" | "unknown";

export interface AconexEventLine {
  status: "matched" | "aconex_only" | "dashboard_only";
  eventNo: string;
  kind: string;
  name: string;
  eventDate: string;
  aconexStatus: string;
  aconexGroup: StatusGroup;
  frag: string;
  contractor: string;
  /** Aconex: the event's total cost impact, and its approved part */
  aconexTotal: number | null;
  aconexApproved: number | null;
  /** the figure compared: the approved impact of an approved event, else the total impact */
  aconexValue: number | null;
  /** the register entries the event matches (one, or several parts of one PVO) */
  changeItems: string[];
  changeStatus: string;
  dashboardGroup: StatusGroup;
  dashboardPvo: number | null;
  dashboardDvo: number | null;
  /** the figure compared: the DVO value once there is one, else the PVO value */
  dashboardValue: number | null;
  diff: number | null;
  differs: boolean;
  note: string;
}

export interface AconexContractorFigures {
  approved: number;
  pending: number;
  cancelled: number;
  transfers: number;
  items: number;
}

export interface AconexContractorBlock {
  contractor: string;
  contracts: string[];
  aconex: AconexContractorFigures;
  dashboard: AconexContractorFigures;
  variance: { approved: number; pending: number; transfers: number };
  lines: AconexEventLine[];
  differing: number;
  onlyAconex: number;
  onlyDashboard: number;
}

export interface AconexChangeCheck {
  asOf: string | null;
  contractors: AconexContractorBlock[];
  totals: { aconex: AconexContractorFigures; dashboard: AconexContractorFigures; variance: { approved: number; pending: number; transfers: number } };
  counts: { events: number; changes: number; matched: number; differing: number; aconexOnly: number; dashboardOnly: number; tolerance: number };
}

const APPROVED_WORDS = /^(approved|closed|complete|review complete)$/i;
const CANCELLED_WORDS = /^(cancelled|canceled|rejected|superseded|transferred|withdrawn)$/i;
const PENDING_WORDS = /^(pending|planning|potential|proposed|submitted|under review|revised & resubmit|revised|open|in progress)$/i;

export function statusGroup(s: unknown): StatusGroup {
  const t = String(s ?? "").trim();
  if (!t) return "unknown";
  if (APPROVED_WORDS.test(t)) return "approved";
  if (CANCELLED_WORDS.test(t)) return "cancelled";
  if (PENDING_WORDS.test(t)) return "pending";
  return "unknown";
}

/** the number in a register reference: "13", "PVO 010", "PVO-016", "PVO 014-R1", "PVO 010 PART A" → 13, 10, 16, 14, 10 */
export function refNumber(ref: unknown): number | null {
  const m = String(ref ?? "").match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

const zero = (): AconexContractorFigures => ({ approved: 0, pending: 0, cancelled: 0, transfers: 0, items: 0 });
const NO_CONTRACTOR = "No contractor (budget holds and events without a contract code)";

export function buildAconexChangeCheck(data: ReportData): AconexChangeCheck {
  const events = data.recovery.aconexEvents;
  const asOf = events.map((r) => String(r.tracker_date ?? "")).filter(Boolean).sort().pop() ?? null;
  const lines = data.costReport.lines;
  const fragOf = (code: string) => code.match(/\b(\d{3}[A-Z]\d{2})\b/)?.[1]?.toUpperCase() ?? null;
  // the contractor of each contract code, from the cost report
  const contractorOfFrag = new Map<string, string>();
  for (const l of lines) {
    const f = fragOf(l.code);
    if (f && l.contractor && !contractorOfFrag.has(f)) contractorOfFrag.set(f, l.contractor);
  }
  const lineById = new Map(lines.map((l) => [l.id, l]));
  // the register's changes by contract + PVO / RFC number
  const changes = data.registers.changes?.rows ?? [];
  const byKey = new Map<string, RecordRow[]>();
  const changeContractor = (c: RecordRow) => {
    const l = c.cost_line_id ? lineById.get(Number(c.cost_line_id)) : undefined;
    return l?.contractor || String(c.contractor_id__label ?? "") || (l ? (contractorOfFrag.get(fragOf(l.code) ?? "") ?? "") : "");
  };
  const changeFrag = (c: RecordRow) => {
    const l = c.cost_line_id ? lineById.get(Number(c.cost_line_id)) : undefined;
    return (l ? fragOf(l.code) : null) ?? fragOf(String(c.cost_line_id__label ?? "")) ?? null;
  };
  const usedChange = new Set<number>();
  for (const c of changes) {
    const frag = changeFrag(c);
    if (!frag) continue;
    for (const [kind, ref] of [
      ["PVO", c.pvo_ref],
      ["RFC", c.rfc_ref],
    ] as const) {
      const num = refNumber(ref);
      if (num === null) continue;
      const key = `${frag}:${kind}:${num}`;
      byKey.set(key, [...(byKey.get(key) ?? []), c]);
    }
  }
  const dashValues = (c: RecordRow) => {
    const pvo = c.pvo_tracker_amount ?? c.pvo_cr_amount;
    const dvo = c.dvo_tracker_amount ?? c.dvo_cr_amount;
    const hasDvo = (dvo !== null && dvo !== undefined && dvo !== "") || !!String(c.dvo_ref ?? "").trim();
    return { pvo: pvo === null || pvo === undefined || pvo === "" ? null : n(pvo), dvo: hasDvo && dvo !== null && dvo !== undefined && dvo !== "" ? n(dvo) : null, hasDvo };
  };
  // the register's approved transfers into each contractor's packages
  const transfers = data.registers.budget_transfers?.rows ?? [];
  const transfersInto = new Map<string, number>();
  for (const t of transfers) {
    if (statusGroup(t.status) !== "approved") continue;
    const to = data.recovery.packageContractors[Number(t.to_package_id)];
    if (to) transfersInto.set(to, r2((transfersInto.get(to) ?? 0) + n(t.amount)));
  }

  const blocks = new Map<string, AconexContractorBlock>();
  const block = (contractor: string) => {
    const key = contractor || NO_CONTRACTOR;
    let b = blocks.get(key);
    if (!b) {
      b = { contractor: key, contracts: [], aconex: zero(), dashboard: zero(), variance: { approved: 0, pending: 0, transfers: 0 }, lines: [], differing: 0, onlyAconex: 0, onlyDashboard: 0 };
      blocks.set(key, b);
    }
    return b;
  };
  const addContract = (b: AconexContractorBlock, frag: string | null) => {
    if (frag && !b.contracts.includes(frag)) b.contracts.push(frag);
  };

  // an event re-raised in Aconex ("031C02-PVO-0010" live, "031C02-PVO-0010-Cancelled" cancelled) keeps the
  // register entry for the live one; the cancelled duplicate is listed, not compared
  const liveByKey = new Map<string, string>();
  for (const e of events) {
    const parsed = parseEventNo(String(e.event_no ?? ""));
    const frag = String(e.contract_frag ?? "").toUpperCase() || parsed.frag || "";
    if (!frag || parsed.number === null) continue;
    if (statusGroup(String(e.cost_status ?? e.budget_status ?? "")) !== "cancelled") liveByKey.set(`${frag}:${parsed.kind}:${parsed.number}`, String(e.event_no ?? ""));
  }
  let matched = 0;
  for (const e of events) {
    const no = String(e.event_no ?? "");
    const parsed = parseEventNo(no);
    const frag = String(e.contract_frag ?? "").toUpperCase() || parsed.frag || "";
    const kind = String(e.kind ?? parsed.kind ?? "Other");
    const contractor = String(e.contractor_id__label ?? "") || (frag ? (contractorOfFrag.get(frag) ?? "") : "");
    const b = block(contractor);
    addContract(b, frag || null);
    const aconexStatus = String(e.cost_status ?? e.budget_status ?? "");
    const aconexGroup = statusGroup(aconexStatus);
    const total = e.total_cost_impact === null || e.total_cost_impact === undefined ? null : n(e.total_cost_impact);
    const approved = e.approved_cost_impact === null || e.approved_cost_impact === undefined ? null : n(e.approved_cost_impact);
    const budgetImpact = n(e.total_budget_impact);
    const aconexValue = kind === "BTR" ? budgetImpact : aconexGroup === "approved" ? (approved ?? total) : total;
    b.aconex.items++;
    if (kind === "BTR") {
      if (aconexGroup === "approved") b.aconex.transfers = r2(b.aconex.transfers + budgetImpact);
    } else if (aconexGroup === "approved") b.aconex.approved = r2(b.aconex.approved + (aconexValue ?? 0));
    else if (aconexGroup === "pending") b.aconex.pending = r2(b.aconex.pending + (aconexValue ?? 0));
    else if (aconexGroup === "cancelled") b.aconex.cancelled = r2(b.aconex.cancelled + (total ?? 0));
    const line: AconexEventLine = {
      status: "aconex_only",
      eventNo: no,
      kind,
      name: String(e.name ?? ""),
      eventDate: String(e.event_date ?? ""),
      aconexStatus,
      aconexGroup,
      frag,
      contractor: b.contractor,
      aconexTotal: total,
      aconexApproved: approved,
      aconexValue,
      changeItems: [],
      changeStatus: "",
      dashboardGroup: "unknown",
      dashboardPvo: null,
      dashboardDvo: null,
      dashboardValue: null,
      diff: null,
      differs: false,
      note: "",
    };
    const key = `${frag}:${kind}:${parsed.number}`;
    const liveTwin = aconexGroup === "cancelled" && parsed.number !== null ? liveByKey.get(key) : undefined;
    const hits = (kind === "PVO" || kind === "RFC") && frag && parsed.number !== null && !(liveTwin && liveTwin !== no) ? (byKey.get(key) ?? []) : [];
    if (liveTwin && liveTwin !== no) {
      line.note = `cancelled in Aconex – re-raised as ${liveTwin}, which is the event compared`;
      b.lines.push(line);
      continue;
    }
    if (hits.length) {
      line.status = "matched";
      matched++;
      let pvo: number | null = null;
      let dvo: number | null = null;
      let anyDvo = false;
      const statuses = new Set<string>();
      for (const c of hits) {
        usedChange.add(Number(c.id));
        line.changeItems.push(String(c.item_no ?? c.id));
        const v = dashValues(c);
        if (v.pvo !== null) pvo = r2((pvo ?? 0) + v.pvo);
        if (v.dvo !== null) dvo = r2((dvo ?? 0) + v.dvo);
        anyDvo = anyDvo || v.hasDvo;
        statuses.add(String(c.overall_status_id__label ?? ""));
      }
      line.changeStatus = [...statuses].filter(Boolean).join(" / ");
      line.dashboardGroup = statusGroup([...statuses][0]);
      line.dashboardPvo = pvo;
      line.dashboardDvo = dvo;
      line.dashboardValue = anyDvo && dvo !== null ? dvo : pvo;
      line.diff = r2((line.aconexValue ?? 0) - (line.dashboardValue ?? 0));
      const bothCancelled = line.aconexGroup === "cancelled" && line.dashboardGroup === "cancelled";
      const valueDiffers = !bothCancelled && Math.abs(line.diff) >= EVENT_TOLERANCE;
      const statusDiffers = line.aconexGroup !== "unknown" && line.dashboardGroup !== "unknown" && line.aconexGroup !== line.dashboardGroup;
      line.differs = valueDiffers || statusDiffers;
      line.note = [bothCancelled ? "cancelled on both sides – values not compared" : "", valueDiffers ? `value differs by ${line.diff < 0 ? "-" : ""}SAR ${Math.abs(line.diff).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "", statusDiffers ? `Aconex ${aconexStatus.toLowerCase()} vs register ${line.changeStatus.toLowerCase()}` : "", hits.length > 1 ? `${hits.length} register entries added together` : ""].filter(Boolean).join("; ");
      if (line.differs) b.differing++;
    } else {
      line.note = kind === "BTR" ? "budget transfer – compared with the register's approved transfers into this contractor's packages (contractor total)" : kind === "ADJ" ? "an Aconex adjustment – nothing to match on the register" : parsed.number === null ? "no PVO / RFC number in the event number" : `no change register entry with ${kind} ${parsed.number} on contract ${frag || "?"}`;
      if (kind !== "BTR") b.onlyAconex++;
    }
    b.lines.push(line);
  }
  // the register's changes with a PVO / RFC reference that no event matched
  for (const c of changes) {
    if (usedChange.has(Number(c.id))) continue;
    const pvoNum = refNumber(c.pvo_ref);
    const rfcNum = refNumber(c.rfc_ref);
    if (pvoNum === null && rfcNum === null) continue;
    const v = dashValues(c);
    const b = block(changeContractor(c));
    const frag = changeFrag(c) ?? "";
    addContract(b, frag || null);
    const group = statusGroup(c.overall_status_id__label);
    const value = v.hasDvo && v.dvo !== null ? v.dvo : v.pvo;
    b.lines.push({
      status: "dashboard_only",
      eventNo: "",
      kind: pvoNum !== null ? "PVO" : "RFC",
      name: String(c.description ?? ""),
      eventDate: String(c.pvo_date ?? c.rfc_date ?? c.date_raised ?? ""),
      aconexStatus: "",
      aconexGroup: "unknown",
      frag,
      contractor: b.contractor,
      aconexTotal: null,
      aconexApproved: null,
      aconexValue: null,
      changeItems: [String(c.item_no ?? c.id)],
      changeStatus: String(c.overall_status_id__label ?? ""),
      dashboardGroup: group,
      dashboardPvo: v.pvo,
      dashboardDvo: v.dvo,
      dashboardValue: value,
      diff: null,
      differs: false,
      note: `register ${pvoNum !== null ? `PVO ${String(c.pvo_ref)}` : `RFC ${String(c.rfc_ref)}`} on contract ${frag || "?"} – no Aconex event with that number`,
    });
    b.onlyDashboard++;
  }
  // the register's side of every contractor: its changes by status, and its transfers
  for (const c of changes) {
    const v = dashValues(c);
    const value = v.hasDvo && v.dvo !== null ? v.dvo : v.pvo;
    if (value === null && refNumber(c.pvo_ref) === null && refNumber(c.rfc_ref) === null) continue;
    const b = block(changeContractor(c));
    b.dashboard.items++;
    const g = statusGroup(c.overall_status_id__label);
    if (g === "approved") b.dashboard.approved = r2(b.dashboard.approved + (value ?? 0));
    else if (g === "pending") b.dashboard.pending = r2(b.dashboard.pending + (value ?? 0));
    else if (g === "cancelled") b.dashboard.cancelled = r2(b.dashboard.cancelled + (value ?? 0));
  }
  for (const b of blocks.values()) {
    b.dashboard.transfers = transfersInto.get(b.contractor) ?? 0;
    b.variance = { approved: r2(b.aconex.approved - b.dashboard.approved), pending: r2(b.aconex.pending - b.dashboard.pending), transfers: r2(b.aconex.transfers - b.dashboard.transfers) };
    b.contracts.sort();
    // the differences first, then what only one side has, then the lines that agree – by kind and number within
    const rank = (l: AconexEventLine) => (l.status === "matched" ? (l.differs ? 0 : 3) : l.status === "aconex_only" ? 1 : 2);
    b.lines.sort((x, y) => rank(x) - rank(y) || x.kind.localeCompare(y.kind) || (x.eventNo || x.changeItems.join()).localeCompare(y.eventNo || y.changeItems.join(), undefined, { numeric: true }));
  }
  const contractors = [...blocks.values()].sort((a, b) => (a.contractor === NO_CONTRACTOR ? 1 : 0) - (b.contractor === NO_CONTRACTOR ? 1 : 0) || Math.abs(b.variance.approved) + Math.abs(b.variance.pending) - (Math.abs(a.variance.approved) + Math.abs(a.variance.pending)) || a.contractor.localeCompare(b.contractor));
  const totals = { aconex: zero(), dashboard: zero(), variance: { approved: 0, pending: 0, transfers: 0 } };
  for (const b of contractors) {
    for (const k of ["approved", "pending", "cancelled", "transfers", "items"] as const) {
      totals.aconex[k] = r2(totals.aconex[k] + b.aconex[k]);
      totals.dashboard[k] = r2(totals.dashboard[k] + b.dashboard[k]);
    }
  }
  totals.variance = { approved: r2(totals.aconex.approved - totals.dashboard.approved), pending: r2(totals.aconex.pending - totals.dashboard.pending), transfers: r2(totals.aconex.transfers - totals.dashboard.transfers) };
  const differing = contractors.reduce((a, b) => a + b.differing, 0);
  return {
    asOf,
    contractors,
    totals,
    counts: { events: events.length, changes: changes.filter((c) => refNumber(c.pvo_ref) !== null || refNumber(c.rfc_ref) !== null).length, matched, differing, aconexOnly: contractors.reduce((a, b) => a + b.onlyAconex, 0), dashboardOnly: contractors.reduce((a, b) => a + b.onlyDashboard, 0), tolerance: EVENT_TOLERANCE },
  };
}
