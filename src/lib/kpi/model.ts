import type { ReportData } from "../report/data";
import type { RecordRow } from "../registers/types";
import { daysBetween } from "../registers/enrich";
import { DEAD_STATUSES } from "../registers/defs/changes";
import { codeFrag } from "../workbook/claims-tracker";
import type { KpiCategory, KpiItem, KpiMovement } from "./shared";

export type { KpiCategory, KpiItem, KpiMovement } from "./shared";
export { MOVEMENT_LABEL } from "./shared";

/**
 * The monthly Commercial KPI "F1 – VOs" for one report: every change the head office tracks on its
 * Open VO Register, classified the way they read it –
 *   Closed KPI  = the DVO is recorded as Approved on this report;
 *   Open KPI    = a PVO or a VO is recorded but the DVO is not approved yet –
 * and only what moved since the previous report – a DVO approved this month, a VO or PVO newly
 * recorded or changed this month – because the head office asks for the entries updated in the
 * month, with the supporting documents for each. A locked report gives the figures it was issued
 * with, so every month's KPI can be produced again later exactly as it was.
 */

export interface KpiReport {
  items: KpiItem[];
  closed: KpiItem[];
  open: KpiItem[];
  counts: { closed: number; closedNow: number; open: number; open90: number; moved: number; openPending: number; closedAll: number };
  totals: { closedPvo: number; closedAvv: number; openPvo: number };
  previousLabel: string | null;
  /** the month the head office files the entries under (first day of the report month) */
  month: string;
  cutoff: string;
}

const KPI_DAYS = 90;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const n = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const r2 = (x: number) => Math.round(x * 100) / 100;

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "1TB01031.01" → "1.TB.01.031.01", as the head office writes asset codes. */
export function headOfficeAssetCode(code: string): string {
  const m = /^(\d)(TB)(\d{2})(\d{3})(?:\.(\d{2}))?$/i.exec(code.trim());
  if (!m) return code;
  return [m[1], m[2].toUpperCase(), m[3], m[4], m[5] ?? "01"].join(".");
}

/** "1TB01031" → "Program 01". */
export function headOfficeProgram(programmeCode: string): string {
  const m = /^\d[A-Z]{2}(\d{2})/i.exec(programmeCode.trim());
  return m ? `Program ${m[1]}` : programmeCode;
}

/** "Shapoorji Pallonji Mideast LLC" → "SPM"; "DEPA Saudi Arabia …" → "DEPA"; "Havelock Interiors" → "HI". */
export function vendorShortName(name: string): string {
  const words = name.replace(/[(),.&]/g, " ").split(/\s+/).filter((w) => w && !/^(llc|ltd|limited|co|company|inc|saudi|arabia|for|and|of|the|l\.l\.c|branch|contracting|trading|engineering|general)$/i.test(w));
  if (!words.length) return name.slice(0, 4).toUpperCase();
  if (/^[A-Z]{2,6}$/.test(words[0])) return words[0];
  return words.slice(0, 3).map((w) => w[0].toUpperCase()).join("") || name.slice(0, 3).toUpperCase();
}

/** "VO 029", "PVO-29", "29" → "29". */
const refNo = (ref: string) => (ref.match(/\d+[A-Za-z]?/)?.[0] ?? "").replace(/^0+(?=\d)/, "");

function firstDate(...vals: unknown[]): string | null {
  for (const v of vals) {
    const t = s(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  }
  return null;
}

function classify(row: RecordRow): KpiCategory | null {
  const overall = s(row.overall_status_id__label);
  if (DEAD_STATUSES.includes(overall)) return null;
  const dvo = s(row.dvo_status_id__label);
  if (dvo === "Approved") return "closed";
  const pvo = s(row.pvo_status_id__label);
  const vo = s(row.vo_status_id__label);
  const hasPvo = (s(row.pvo_ref) || s(row.pvo_date) || n(row.pvo_tracker_amount) !== null) && !DEAD_STATUSES.includes(pvo);
  const hasVo = (s(row.vo_ref) || s(row.vo_date)) && !DEAD_STATUSES.includes(vo);
  const hasDvoPending = (s(row.dvo_ref) || s(row.dvo_date)) && !DEAD_STATUSES.includes(dvo);
  return hasPvo || hasVo || hasDvoPending ? "open" : null;
}

export interface KpiOptions {
  /** the type of a contractor (Contractor / Consultant …) from the contractor register */
  contractorType?: (id: number) => string;
  /** the code and name of an asset (1TB01006.99 · VBH – Project Wide) from the asset register */
  asset?: (id: number) => { code: string; name: string } | undefined;
}

/** "DVO", "DVO 018" → "DVO 018"; "VO", "029" → "VO 029" – a reference named without repeating its kind. */
function refLabel(kind: string, ref: string): string {
  const r = ref.trim();
  if (!r) return kind;
  return new RegExp(`^${kind}\\b`, "i").test(r) ? r : `${kind} ${r}`;
}

function baseItem(row: RecordRow, data: ReportData, contracts: RecordRow[], cutoff: string, opts: KpiOptions): KpiItem {
  const category = classify(row) ?? "open";
  const lineCode = s(row.cost_line_id__label).split(" · ")[0];
  const frag = lineCode ? codeFrag(lineCode) : null;
  const programmeCode = data.programme.code.toUpperCase();
  const contract = contracts.find((c) => Number(c.cost_line_id) === Number(row.cost_line_id)) ?? contracts.find((c) => Number(c.contractor_id) === Number(row.contractor_id) && (!row.package_id || Number(c.package_id) === Number(row.package_id)));
  const vendor = s(row.contractor_id__label);
  const instructionRef = s(row.vo_ref) || s(row.ei_ref);
  // the head office counts the 90 days from the instruction (VO or EI); a PVO alone is not an instruction yet
  const instructionDate = firstDate(row.vo_date, row.ei_date, row.dvo_instruction_date);
  const dvoRef = s(row.dvo_ref).replace(/\s+/g, " ");
  const dvoDate = category === "closed" ? firstDate(row.dvo_agreement_date, row.dvo_date) : null;
  const pvoValue = n(row.dvo_planned_value) ?? n(row.pvo_tracker_amount) ?? n(row.pvo_cr_amount) ?? n(row.vo_tracker_amount);
  const avvValue = category === "closed" ? (n(row.dvo_actual_value) ?? n(row.dvo_tracker_amount) ?? n(row.dvo_cr_amount)) : null;
  const daysToClose = instructionDate && dvoDate ? daysBetween(instructionDate, dvoDate) : null;
  const deadline = instructionDate ? addDays(instructionDate, KPI_DAYS) : null;
  const remainingDays = category === "closed" ? 0 : deadline ? daysBetween(cutoff, deadline) : null;
  const asset = row.asset_id ? opts.asset?.(Number(row.asset_id)) : undefined;
  const assetCode = asset?.code || s(row.asset_id__label).split(" · ")[0] || data.asset?.code || `${programmeCode}.01`;
  // the head office names the project, not the sub-asset: "The Marina", "Village Boutique Hotel"
  const projectName = data.programme.name.replace(/\s*\(.*?\)\s*$/, "");
  const reefPo = s(contract?.reef_po_no);
  const item: KpiItem = {
    changeId: Number(row.id),
    itemNo: s(row.item_no),
    description: s(row.description),
    category,
    program: headOfficeProgram(programmeCode),
    projectName,
    assetCode: headOfficeAssetCode(assetCode),
    accContractRef: frag ? `${programmeCode.slice(0, 5)}${frag}` : s(contract?.acc_ref),
    reefPo,
    vendor,
    vendorType: (row.contractor_id ? opts.contractorType?.(Number(row.contractor_id)) : "") || (/consult|design|engineer/i.test(s(row.package_id__label) + vendor) ? "Consultant" : "Contractor"),
    instructionRef,
    instructionDate,
    dvoRef,
    dvoDate,
    pvoValue,
    avvValue,
    daysToClose,
    dvoStatus: category === "closed" ? "APPROVED" : "PENDING",
    deadline,
    remainingDays,
    f1: category === "closed" ? (daysToClose === null ? null : daysToClose <= KPI_DAYS ? 1 : 0) : null,
    f2: category === "closed" && pvoValue && avvValue !== null ? r2((avvValue - pvoValue) / Math.abs(pvoValue)) : null,
    pvoRef: s(row.pvo_ref),
    voRef: s(row.vo_ref),
    eiRef: s(row.ei_ref),
    rfcRef: s(row.rfc_ref),
    pvoDate: firstDate(row.pvo_date),
    voDate: firstDate(row.vo_date),
    overallStatus: s(row.overall_status_id__label),
    movement: "unchanged",
    movementNote: "",
    previous: null,
    defaultFileName: "",
    vendorShort: vendorShortName(vendor),
  };
  item.defaultFileName = defaultPackName(item, "");
  return item;
}

/**
 * The head office file name for the supporting documents: their register's column C for an approved
 * DVO (S/N_REEF PO_DVO ref_Vendor), and the team's own style for one still in progress
 * (HOI-PVO29_VO29_DVO in Progress).
 */
export function defaultPackName(item: Pick<KpiItem, "category" | "reefPo" | "dvoRef" | "vendor" | "vendorShort" | "pvoRef" | "voRef" | "rfcRef">, sn: string): string {
  const clean = (t: string) => t.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  if (item.category === "closed") return clean(`${sn || "NEW"}_${item.reefPo || "0"}_${item.dvoRef || "0"}_${item.vendor}`);
  const parts = [item.pvoRef ? `PVO${refNo(item.pvoRef)}` : "", item.voRef ? `VO${refNo(item.voRef)}` : "", item.dvoRef ? `DVO${refNo(item.dvoRef)} in Progress` : "DVO in Progress"].filter(Boolean);
  return clean(`${item.vendorShort}-${parts.join("_")}${item.rfcRef ? `_RFC${refNo(item.rfcRef)}` : ""}`);
}

export function buildKpi(data: ReportData, previous: ReportData | null, opts: KpiOptions = {}): KpiReport {
  const cutoff = data.period.period_end;
  const rows = data.registers.changes?.rows ?? [];
  const contracts = data.registers.contracts?.rows ?? [];
  const prevRows = previous?.registers.changes?.rows ?? [];
  const prevContracts = previous?.registers.contracts?.rows ?? [];
  const prevById = new Map<number, KpiItem>();
  const prevByNo = new Map<string, KpiItem>();
  if (previous) {
    for (const r of prevRows) {
      if (!classify(r)) continue;
      const it = baseItem(r, previous, prevContracts, previous.period.period_end, opts);
      prevById.set(it.changeId, it);
      if (it.itemNo) prevByNo.set(it.itemNo.toLowerCase(), it);
    }
  }
  const items: KpiItem[] = [];
  for (const r of rows) {
    if (!classify(r)) continue;
    const it = baseItem(r, data, contracts, cutoff, opts);
    const p = prevById.get(it.changeId) ?? (it.itemNo ? prevByNo.get(it.itemNo.toLowerCase()) : undefined) ?? null;
    if (p) it.previous = { pvoValue: p.pvoValue, avvValue: p.avvValue, dvoRef: p.dvoRef, instructionRef: p.instructionRef, category: p.category };
    if (!previous) {
      // the first report: everything on it is reported for the first time
      it.movement = "new";
      it.movementNote = "First report – no earlier report to compare with";
    } else if (!p) {
      it.movement = "new";
      it.movementNote = it.category === "closed" ? "New on this report, DVO already approved" : `New on this report – ${it.voRef ? `${refLabel("VO", it.voRef)} recorded` : it.pvoRef ? `${refLabel("PVO", it.pvoRef)} recorded` : "recorded"}`;
    } else if (p.category !== "closed" && it.category === "closed") {
      it.movement = "closed_now";
      it.movementNote = `${refLabel("DVO", it.dvoRef)} approved this report${it.dvoDate ? ` (${it.dvoDate})` : ""}${it.avvValue !== null ? ` – AVV ${fmt(it.avvValue)}` : ""}`;
    } else {
      const notes: string[] = [];
      if (it.instructionRef !== p.instructionRef && it.instructionRef) notes.push(`instruction now ${it.instructionRef}`);
      if (it.dvoRef !== p.dvoRef && it.dvoRef) notes.push(`${refLabel("DVO", it.dvoRef)} recorded${it.category === "closed" ? "" : " (pending)"}`);
      if ((it.pvoValue ?? 0) !== (p.pvoValue ?? 0)) notes.push(`PVO value ${fmt(p.pvoValue)} → ${fmt(it.pvoValue)}`);
      if ((it.avvValue ?? 0) !== (p.avvValue ?? 0)) notes.push(`AVV ${fmt(p.avvValue)} → ${fmt(it.avvValue)}`);
      if (notes.length) {
        it.movement = "updated";
        it.movementNote = notes.join("; ");
      } else {
        it.movement = "unchanged";
        it.movementNote = it.category === "closed" ? "Approved on an earlier report" : "No change since the previous report";
      }
    }
    items.push(it);
  }
  const order: Record<KpiMovement, number> = { closed_now: 0, new: 1, updated: 2, unchanged: 3 };
  items.sort((a, b) => order[a.movement] - order[b.movement] || (a.remainingDays ?? 0) - (b.remainingDays ?? 0) || a.itemNo.localeCompare(b.itemNo, undefined, { numeric: true }));
  // Only what moved in this report is reported to the head office: the DVOs approved this month
  // (Closed KPI) and the PVOs / VOs recorded or changed this month (Open KPI). What was reported
  // in an earlier month is not repeated.
  const closedAll = items.filter((i) => i.category === "closed");
  const openAll = items.filter((i) => i.category === "open");
  const closed = closedAll.filter((i) => i.movement === "closed_now" || i.movement === "new");
  const open = openAll.filter((i) => i.movement !== "unchanged");
  const sum = (list: KpiItem[], k: "pvoValue" | "avvValue") => r2(list.reduce((t, i) => t + (i[k] ?? 0), 0));
  return {
    items,
    closed,
    open,
    counts: { closed: closed.length, closedNow: closed.length, open: open.length, open90: open.filter((i) => (i.remainingDays ?? 1) < 0).length, moved: closed.length + open.length, openPending: openAll.length, closedAll: closedAll.length },
    totals: { closedPvo: sum(closed, "pvoValue"), closedAvv: sum(closed, "avvValue"), openPvo: sum(open, "pvoValue") },
    previousLabel: previous?.period.label ?? null,
    month: cutoff.slice(0, 8) + "01",
    cutoff,
  };
}

function fmt(v: number | null): string {
  return v === null ? "–" : v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
