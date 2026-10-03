import type Database from "better-sqlite3";
import { saveReportTemplate } from "../report/own-layout/templates";
import { memoryNote, releaseMemory } from "./heavy";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb, getSetting, setSetting, wordsKey, syntheticEwNo } from "../db";
import { getRegisterDef } from "../registers";
import { createRecord, updateRecord, listRecords, lookupOptions, ValidationError } from "../registers/engine";
import type { UserInfo, RecordRow } from "../registers/types";
import { lockPeriod, getPeriod, latestPeriod, takeSnapshot, restoreFromSnapshot, hasStoredCopy, clearSnapshotRegisters, nearestStoredBefore } from "../snapshots";
import { logAudit } from "../audit";
import { mergeDuplicateContractors } from "../contractors/merge";
import { tidyText } from "../text/tidy";
import { contractorKey } from "../bonds/name-key";
import { tableExists } from "../cost-report/feeds";

/** The free-prose fields whose wording is tidied on the way in. Everything else arrives untouched. */
const TIDY_FIELDS = new Set(["description", "scope", "remark", "comments", "last_action"]);
import { nowIso, formatMonthYear, parseDateInput } from "../format";
import { importKeyFields, norm } from "./analyze";
import { cellText, getSheet, readWorkbookValues, type SheetValues } from "./read";
import type { Level1Check } from "./level1-check";
import type { ReportControl } from "./marina";
import { getChecklist, setChecklistItem } from "../checklist";

/* ------------------------------------------------------------------ */
/* Temporary storage of the uploaded workbook (30 minutes)             */

const TMP = path.join(os.tmpdir(), "commercial-dashboard-uploads");
/** Largest workbook accepted (your monthly report is ~11 MB). */
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export function storeUpload(buffer: Buffer): string {
  fs.mkdirSync(TMP, { recursive: true });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(path.join(TMP, `${id}.xlsx`), buffer);
  // tidy old files
  for (const f of fs.readdirSync(TMP)) {
    const p = path.join(TMP, f);
    // the from-documents batches keep their files in sub-folders here: an old one goes whole, a fresh one is left alone
    const st = fs.statSync(p);
    if (Date.now() - st.mtimeMs > 30 * 60_000) fs.rmSync(p, { force: true, recursive: st.isDirectory() });
  }
  return id;
}

/** Chunked upload: append one piece; returns the upload id. */
export function appendUploadPart(id: string | null, part: Buffer, limit = MAX_UPLOAD_BYTES): string {
  fs.mkdirSync(TMP, { recursive: true });
  if (id && !/^[a-z0-9]+$/.test(id)) throw new ValidationError("Bad upload id.");
  const useId = id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const file = path.join(TMP, `${useId}.part`);
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  if (size + part.length > limit) {
    fs.rmSync(file, { force: true });
    throw new ValidationError(`The file is larger than ${Math.round(limit / 1024 / 1024)} MB.${limit === MAX_UPLOAD_BYTES ? " Remove old sheets or pictures and try again." : ""}`);
  }
  fs.appendFileSync(file, part);
  return useId;
}

/** Chunked upload: read all the pieces back and remove the part file. */
export function finishUploadParts(id: string): Buffer {
  if (!/^[a-z0-9]+$/.test(id)) throw new ValidationError("Bad upload id.");
  const p = path.join(TMP, `${id}.part`);
  if (!fs.existsSync(p)) throw new ValidationError("The upload was interrupted. Please try again.");
  const buf = fs.readFileSync(p);
  fs.rmSync(p, { force: true });
  return buf;
}

export function uploadPath(id: string): string {
  if (!/^[a-z0-9]+$/.test(id)) throw new ValidationError("Bad upload id.");
  const p = path.join(TMP, `${id}.xlsx`);
  if (!fs.existsSync(p)) throw new ValidationError("The uploaded file has expired. Please upload it again.");
  return p;
}

/** Keeps the converted (cleaned) sheets of an upload so the import reads those instead of the raw workbook. */
export function saveConverted(id: string, sheets: SheetValues[]) {
  const p = `${uploadPath(id)}.converted.json`;
  fs.writeFileSync(p, JSON.stringify(sheets.map((s) => ({ name: s.name, rowCount: s.rowCount, truncated: s.truncated, rows: [...s.rows.entries()] }))));
}

/** The sheets to import for an upload: the converted ones when a converter ran, else the workbook itself. */
export async function uploadSheets(id: string): Promise<SheetValues[]> {
  const p = `${uploadPath(id)}.converted.json`;
  if (fs.existsSync(p)) {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { name: string; rowCount: number; truncated: boolean; rows: [number, unknown[]][] }[];
    return raw.map((s) => ({ name: s.name, rowCount: s.rowCount, truncated: s.truncated, rows: new Map(s.rows) }));
  }
  return readWorkbookValues(uploadPath(id));
}

/* ------------------------------------------------------------------ */

export interface SheetMapping {
  sheet: string;
  headerRow: number;
  register: string | null;
  /** column index (1-based) -> field key */
  columns: Record<string, string | null>;
}

/** Registers that are fed only by their stand-alone imports (Claims Tracker, Bonds & Insurance, Final Account Status) – never by the monthly workbook. */
export const STANDALONE_ONLY = ["claims", "bonds", "final_accounts", "accommodation_recovery", "accommodation_invoices", "customs_recovery", "customs_declarations", "aconex_control_accounts"] as const;
/** The cost-recovery trackers: uploaded when they change, never part of the monthly workbook, whatever the project's feeds. */
export const RECOVERY_REGISTERS = ["accommodation_recovery", "accommodation_invoices", "customs_recovery", "customs_declarations", "aconex_control_accounts"] as const;
/** Every stand-alone tracker: uploaded whenever it changes, whatever report is selected (locked or not), one file for every project. The Claims Tracker is one; its rows are matched and updated, never removed. */
export const TRACKER_REGISTERS = [...RECOVERY_REGISTERS, "claims"] as const;

/**
 * The registers the monthly workbook must not write for a project: claims always (the Claims Tracker is
 * stand-alone); bonds & insurance and final accounts too unless the project's workbook carries them
 * (Settings → Programmes → "Monthly workbook feeds Bonds & Insurance and Final Account Status").
 */
export function standaloneOnly(db: Database.Database, programmeId: number): string[] {
  const row = db.prepare("SELECT workbook_feeds_all FROM programmes WHERE id = ?").get(programmeId) as { workbook_feeds_all: number | null } | undefined;
  return row?.workbook_feeds_all ? ["claims", ...RECOVERY_REGISTERS] : [...STANDALONE_ONLY];
}

export interface ImportRequest {
  fileId: string;
  period: { id?: number; report_no?: number; period_end?: string };
  sheets: SheetMapping[];
  lock: boolean;
  createMissingLookups: boolean;
  /** Stand-alone imports: only these registers may be written (other sheets are ignored). */
  allowedRegisters?: string[];
  /** The project the rows belong to, chosen on the import page (the cost-recovery trackers); otherwise the top bar's project. */
  programmeId?: number;
  /** Kept for older clients; importing an older month no longer needs a confirmation. */
  allowOlder?: boolean;
  /** Name of the uploaded workbook, kept on the period for the report library. */
  fileName?: string;
  /** The workbook's own Level 1 figures (from the converter), kept on the period for the Excel check. */
  excelCheck?: Level1Check | null;
  /** Report-level values the workbook carries (reference, narrative, checklist ticks), written to the period. */
  control?: ReportControl | null;
}

export interface SheetResult {
  sheet: string;
  register: string | null;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export interface ImportResult {
  period: { id: number; label: string; locked: boolean; olderThan?: string };
  sheets: SheetResult[];
  lookupsCreated: string[];
}

/** Registers whose missing dropdown values may be created on the fly (name-only lists). */
const AUTO_CREATE: Record<string, Record<string, unknown>> = {
  packages: {},
  contractors: { type: "Contractor" },
  clients: {},
  locations: {},
  approval_statuses: {},
  change_initiators: {},
  project_stages: {},
  change_categories: {},
  bond_types: {},
  ps_statuses: {},
  cost_categories: {},
};

/** Match a workbook value to one of a dropdown's fixed options (case-insensitive, then partial). */
function resolveOption(value: string, options: string[]): string | null {
  const want = value.trim().toLowerCase();
  if (!want) return null;
  const lower = options.map((o) => o.toLowerCase());
  let i = lower.indexOf(want);
  if (i < 0) i = lower.findIndex((o) => o.startsWith(want));
  if (i < 0 && want.length >= 3) i = lower.findIndex((o) => o.includes(want));
  if (i < 0) {
    const wt = want.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    i = lower.findIndex((o) => wt.some((t) => o.split(/[^a-z0-9]+/).includes(t)));
  }
  return i < 0 ? null : options[i];
}

/** Lets other requests through between batches of an import (the server stays reachable while it runs). */
const yieldNow = () => new Promise<void>((resolve) => setImmediate(resolve));

export type ImportProgress = (phase: string, done?: number, total?: number) => void;

export async function importWorkbook(req: ImportRequest, user: UserInfo, progress: ImportProgress = () => {}): Promise<ImportResult> {
  if (user.role === "viewer" || user.role === "reporter") throw new ValidationError("Viewers cannot import.");
  const db = getDb();
  const debug = process.env.IMPORT_DEBUG ? (phase: string) => console.log(`[import] ${phase}: ${memoryNote()}`) : () => {};
  progress("Reading the workbook");
  const worksheets = await uploadSheets(req.fileId);
  debug("sheets loaded");
  await yieldNow();

  // Reporting period. Every report keeps its own data: the live registers belong to the latest report.
  // Importing an older month is done "in a sandbox": the latest report's live data is stored first,
  // the older month is imported and stored, and the live registers are put back afterwards.
  const recoveryOnly = !!req.allowedRegisters?.length && req.allowedRegisters.every((k) => (TRACKER_REGISTERS as readonly string[]).includes(k));
  const chosen = recoveryOnly && req.programmeId ? (db.prepare("SELECT id FROM programmes WHERE id = ?").get(Number(req.programmeId)) as { id: number } | undefined) : undefined;
  const programmeId = chosen?.id ?? Number(getSetting(db, "current_programme_id") ?? (db.prepare("SELECT id FROM programmes ORDER BY id LIMIT 1").get() as { id: number } | undefined)?.id ?? 1);
  let periodId = req.period?.id ?? null;
  if (!periodId && recoveryOnly) {
    // a stand-alone tracker is not tied to a report: the project's latest report only names the audit entry
    periodId = latestPeriod(db, programmeId)?.id ?? null;
    if (!periodId) throw new ValidationError("This project has no reporting period yet. Import its monthly report first.");
  }
  if (!periodId) {
    if (!req.period.report_no || !req.period.period_end) throw new ValidationError("Choose an existing reporting period or give a report number and cut-off date for a new one.");
    const end = parseDateInput(req.period.period_end);
    if (!end) throw new ValidationError("The cut-off date is not a valid date.");
    const existing = db.prepare("SELECT id FROM reporting_periods WHERE programme_id = ? AND report_no = ?").get(programmeId, req.period.report_no) as { id: number } | undefined;
    if (existing) periodId = existing.id;
    else {
      const row = createRecord(getRegisterDef("reporting_periods")!, { report_no: req.period.report_no, period_end: end, label: `Monthly Report No ${req.period.report_no} – ${formatMonthYear(end)}` }, user, "import");
      periodId = row.id;
    }
  }
  const period = getPeriod(periodId)!;
  if (period.programme_id !== programmeId) throw new ValidationError(`${period.label} belongs to another project. Switch the project in the top bar first.`);
  // The cost-recovery trackers are not part of any month's report: they are uploaded when they
  // change, whatever report is selected, locked or not, and never go through the older-month sandbox.
  if (period.status === "Locked" && !recoveryOnly) throw new ValidationError(`${period.label} is locked. Unlock it first if you really want to re-import that month.`);
  // the latest report owns the live registers; an older month is imported "in a sandbox"
  const latest = latestPeriod(db, programmeId);
  const older = !recoveryOnly && !!latest && latest.id !== periodId && latest.report_no > period.report_no;
  const olderImport = older;
  const newer = latest ? [{ label: latest.label }] : [];
  let baseNote = "";
  if (older) {
    if (latest!.status !== "Locked" || !hasStoredCopy(db, latest!.id)) takeSnapshot(latest!.id, user, "preserve");
    // Starting point for the older month: that report's own stored copy (else the nearest earlier report,
    // else nothing). A full monthly import then removes, from the registers it fed, every row the workbook
    // did not contain, so rows that only exist in later months never leak into it; the project's
    // stand-alone registers (see standaloneOnly) are left exactly as that report holds them.
    const own = hasStoredCopy(db, periodId) ? period : null;
    const base = own ?? nearestStoredBefore(db, period.report_no, programmeId);
    if (base) {
      restoreFromSnapshot(db, base.id);
      baseNote = base.id === periodId ? `starting from ${period.label}'s own stored data` : `starting from the stored data of ${base.label}`;
    } else {
      clearSnapshotRegisters(db, programmeId);
      baseNote = "starting from empty registers (no earlier report is stored)";
    }
  }
  if (!recoveryOnly) setSetting(db, "current_period_id", String(periodId));

  const lookupsCreated: string[] = [];
  const results: SheetResult[] = [];

  const monthly = !req.allowedRegisters;
  const standalone = standaloneOnly(db, programmeId);
  const touchedByRegister = new Map<string, Set<number>>();
  // the projects each stand-alone tracker fed, to remove their rows the tracker no longer carries
  const recoveryScope = new Map<string, Set<number>>();
  for (const m of req.sheets) {
    if (!m.register) continue;
    if (req.allowedRegisters && !req.allowedRegisters.includes(m.register)) continue;
    // the monthly workbook never writes the stand-alone registers
    if (monthly && standalone.includes(m.register)) continue;
    const def = getRegisterDef(m.register);
    const ws = getSheet(worksheets, m.sheet);
    if (!def || !ws) continue;
    const result: SheetResult = { sheet: m.sheet, register: m.register, created: 0, updated: 0, unchanged: 0, skipped: 0, errors: [] };
    const colMap = Object.entries(m.columns).filter(([, f]) => f).map(([i, f]) => ({ index: Number(i), field: def.fields.find((x) => x.key === f)! })).filter((c) => c.field);
    if (!colMap.length) {
      results.push(result);
      continue;
    }
    // remember the mapping for next month
    const headers: Record<string, string> = {};
    const sig: string[] = [];
    (ws.rows.get(m.headerRow) ?? []).forEach((v, col) => {
      const t = cellText(v).trim();
      if (col === 0 || !t) return;
      sig.push(norm(t));
      const f = m.columns[String(col)];
      if (f) headers[norm(t)] = f;
    });
    setSetting(db, `workbook_map:${def.key}`, JSON.stringify({ ...headers, __signature: sig.join("|") }));

    const keyFields = importKeyFields(def);
    // a stand-alone tracker's rows belong to the project chosen on its page, whatever the top bar shows
    // one AMAALA-wide tracker (accommodation, customs): a "Project [programme_id]" column names each row's project
    const programmeCol = recoveryOnly ? (ws.rows.get(m.headerRow) ?? []).findIndex((v) => /\[programme_id\]\s*$/i.test(cellText(v))) : -1;
    const programmeByCode = new Map(programmeCol >= 0 ? (db.prepare("SELECT id, code FROM programmes").all() as { id: number; code: string }[]).map((p) => [p.code.toUpperCase(), p.id] as const) : []);
    const existingRows = recoveryOnly ? listRecords(def, { allScopes: true }).filter((r) => programmeCol >= 0 || Number(r.programme_id) === programmeId) : listRecords(def);
    const hasBondDocs = (bondId: number) => tableExists(db, "bond_documents") && !!db.prepare("SELECT 1 FROM bond_documents WHERE bond_id = ? LIMIT 1").get(bondId);
    const contractorNames = def.key === "bonds" ? new Map((db.prepare("SELECT id, name FROM contractors").all() as { id: number; name: string }[]).map((c) => [c.id, c.name])) : new Map<number, string>();
    const contractorName = (id: unknown) => (id ? contractorNames.get(Number(id)) ?? "" : "");
    const projectsFed = recoveryScope.get(def.key) ?? new Set<number>();
    recoveryScope.set(def.key, projectsFed);
    const touched = touchedByRegister.get(def.key) ?? new Set<number>();
    touchedByRegister.set(def.key, touched);
    const hasPeriodField = def.fields.some((f) => f.key === "period_id");
    const hasCostLine = def.fields.some((f) => f.key === "cost_line_id" && f.type === "lookup");
    const costLines = hasCostLine ? (db.prepare("SELECT id, package_id, contractor_id FROM cost_lines").all() as { id: number; package_id: number | null; contractor_id: number | null }[]) : [];
    // dropdown options are read once per target register for the sheet, not once per cell
    const optionCache = new Map<string, { id: number; label: string }[]>();
    const optionsOf = (target: string) => {
      let o = optionCache.get(target);
      if (!o) {
        o = lookupOptions(db, target, true);
        optionCache.set(target, o);
      }
      return o;
    };

    // rows go in batches of 10, each its own transaction, with a breather for other requests in between
    const rowNos: number[] = [];
    for (let r = m.headerRow + 1; r <= ws.rowCount; r++) if (ws.rows.get(r)) rowNos.push(r);
    const BATCH = 10;
    const sheetLabel = `${m.sheet} → ${def.title}`;
    progress(sheetLabel, 0, rowNos.length);
    for (let b = 0; b < rowNos.length; b += BATCH) {
    const slice = rowNos.slice(b, b + BATCH);
    const tx = db.transaction(() => {
      for (const r of slice) {
        const row = ws.rows.get(r);
        if (!row) continue;
        const input: Record<string, unknown> = {};
        let any = false;
        for (const c of colMap) {
          const raw = row[c.index];
          let v: unknown = raw instanceof Date ? raw : cellText(raw).trim();
          if (typeof raw === "object" && raw !== null && !(raw instanceof Date) && "result" in raw) v = (raw as { result?: unknown }).result ?? "";
          if (typeof raw === "number") v = raw;
          // Free prose typed into a spreadsheet over many months by many hands is tidied as it comes
          // in – spelling, block capitals, stray spacing – so the dashboard reads properly without
          // anyone having to correct the workbook. Only these fields: a reference, a code or a name
          // is never touched.
          if (typeof v === "string" && TIDY_FIELDS.has(c.field.key)) v = tidyText(v);
          if (v !== "" && v !== null && v !== undefined) any = true;
          input[c.field.key] = v;
        }
        if (!any) {
          result.skipped++;
          continue;
        }
        // skip subtotal / total rows
        const keyVal = String(input[keyFields[0]] ?? "").trim();
        if (!keyVal || /^(sub)?total/i.test(keyVal) || /^(sub)?total/i.test(String(input.description ?? input.name ?? ""))) {
          result.skipped++;
          continue;
        }
        try {
          // lookups by name: create missing dropdown values if allowed
          for (const c of colMap) {
            const f = c.field;
            const v = input[f.key];
            if (v === "" || v === null || v === undefined || typeof v === "number") continue;
            if (f.type === "select" && f.options?.length) {
              const opt = resolveOption(String(v), f.options);
              if (opt) input[f.key] = opt;
              continue;
            }
            if ((f.type === "number" || f.type === "money" || f.type === "percent") && typeof v === "string") {
              const cleaned = v.replace(/sar|%/gi, "").replace(/[,\s]/g, "");
              const neg = /^\(.*\)$/.test(cleaned);
              const n = Number(cleaned.replace(/[()]/g, ""));
              if (!Number.isNaN(n) && cleaned !== "") input[f.key] = neg ? -n : n;
              continue;
            }
            if (f.type === "boolean") {
              input[f.key] = /^(y|yes|true|1|closed|done)$/i.test(String(v).trim());
              continue;
            }
            if (f.type !== "lookup") continue;
            const target = f.lookup!.register;
            const label = String(v).trim();
            const opts = optionsOf(target);
            const want = label.toLowerCase();
            const hit =
              opts.find((o) => o.label.toLowerCase() === want) ??
              opts.find((o) => o.label.toLowerCase().startsWith(want + " · ")) ??
              (want.length >= 3 ? opts.find((o) => o.label.toLowerCase().includes(want)) : undefined);
            if (hit) {
              input[f.key] = hit.id;
              continue;
            }
            // match by code / ref when the dropdown label does not show it (e.g. an asset given as "1TB01031.01")
            const tdef = getRegisterDef(target);
            const codeField = tdef?.fields.find((x) => ["code", "ref", "reef_po_no", "item_no", "claim_no", "ew_no"].includes(x.key));
            if (tdef && codeField) {
              const byCode = db.prepare(`SELECT id FROM "${tdef.table}" WHERE lower(trim("${codeField.key}")) = ?`).get(want) as { id: number } | undefined;
              if (byCode) {
                input[f.key] = byCode.id;
                continue;
              }
            }
            if (req.createMissingLookups && (target in AUTO_CREATE || target === "assets")) {
              const extra = target === "assets" ? { code: label, name: label, programme_id: programmeId } : AUTO_CREATE[target];
              const created = createRecord(getRegisterDef(target)!, { name: label, ...extra }, user, "import");
              lookupsCreated.push(`${getRegisterDef(target)!.singular}: ${label}`);
              input[f.key] = created.id;
              optionCache.delete(target);
            } else if (target === "programmes") {
              delete input[f.key]; // fall back to the current asset / programme
            }
          }
          if (hasPeriodField && !("period_id" in input)) input.period_id = periodId;
          if (recoveryOnly && def.fields.some((f) => f.key === "programme_id")) {
            input.programme_id = (programmeCol >= 0 ? programmeByCode.get(cellText(row[programmeCol]).trim().toUpperCase()) : undefined) ?? programmeId;
            projectsFed.add(Number(input.programme_id));
          }
          if (def.key === "bonds" && typeof input.requirement_value === "number" && !colMap.some((c) => c.field.key === "requirement_type")) {
            // "Contract requirement" in a workbook is usually the SAR amount; a value up to 100 is treated as a percentage
            input.requirement_type = input.requirement_value > 100 ? "Fixed SAR amount" : "% of contract value";
          }
          // link to the cost report line automatically when the package (and contractor) point to exactly one line
          if (hasCostLine && !input.cost_line_id && (input.package_id || input.contractor_id)) {
            const candidates = costLines.filter(
              (l) => (!input.package_id || l.package_id === input.package_id) && (!input.contractor_id || !l.contractor_id || l.contractor_id === input.contractor_id),
            );
            if (candidates.length === 1) input.cost_line_id = candidates[0].id;
          }
          // find existing record by key – then, for early warnings, by what it says: their numbers in the
          // workbook are reused, missing or corrected from month to month (three "23"s, a "22" that became
          // a "23", a blank), so a renumbered row must update the one already here, not sit beside it
          // one AMAALA-wide tracker holds every project: a row only ever matches a row of its own project
          let match = existingRows.find((e) => (programmeCol < 0 || Number(e.programme_id) === Number(input.programme_id)) && keyFields.every((k) => String(e[k] ?? "").trim().toLowerCase() === String(input[k] ?? "").trim().toLowerCase()));
          if (def.key === "bonds") {
            // A bond or policy is the same bond whatever ref the report gives it this month: the same
            // policy number for the same contractor (else, with no number, the same type for the same
            // contractor), so a renumbered Schedule G updates the row instead of sitting beside it.
            const policy = String(input.policy_no ?? "").replace(/\s+/g, "").toUpperCase();
            const sameCo = (e: RecordRow) => (input.contractor_id && Number(e.contractor_id) === Number(input.contractor_id)) || (!!contractorKey(e.contractor_id__label) && !!contractorKey(contractorName(input.contractor_id)) && (contractorKey(e.contractor_id__label).includes(contractorKey(contractorName(input.contractor_id))) || contractorKey(contractorName(input.contractor_id)).includes(contractorKey(e.contractor_id__label))));
            const cands = (policy
              ? existingRows.filter((e) => !touched.has(e.id) && String(e.policy_no ?? "").replace(/\s+/g, "").toUpperCase() === policy && sameCo(e))
              : existingRows.filter((e) => !touched.has(e.id) && !String(e.policy_no ?? "").trim() && Number(e.type_id) === Number(input.type_id) && sameCo(e))
            ) // one policy covering two contracts (the same plant policy on the main works and the jetty): the row on the same package first
              .sort((x, y) => Number(Number(y.package_id) === Number(input.package_id)) - Number(Number(x.package_id) === Number(input.package_id)));
            const byPolicy = cands[0];
            if (byPolicy) {
              match = byPolicy;
              // the report's values win; a link the report does not give (contractor, package, cost line) is kept
              for (const k of ["contractor_id", "package_id", "cost_line_id"]) if (!input[k] && match[k]) delete input[k];
              // an extension already recorded from the amendment letter (a document is attached and the row's
              // expiry is later than the sheet's) is newer than the report: the sheet does not wind it back
              if (input.expiry_date && match.expiry_date && String(match.expiry_date) > String(input.expiry_date) && hasBondDocs(Number(match.id))) {
                input.expiry_date = match.expiry_date;
                if (typeof input.comments === "string" && !/validity extended/i.test(input.comments)) input.comments = `${input.comments} Expiry kept at ${String(match.expiry_date)} from the amendment on file.`.trim();
              }
            } else if (match && touched.has(match.id)) match = undefined;
            // the ref the report gives this bond may still be on another row (an old copy): that row is renamed out of the way
            const ref = String(input.ref ?? "").trim().toLowerCase();
            const holder = ref ? existingRows.find((e) => e !== match && !touched.has(e.id) && String(e.ref ?? "").trim().toLowerCase() === ref) : undefined;
            if (holder) {
              const tmp = `${input.ref} (old)`;
              db.prepare(`UPDATE "${def.table}" SET ref = ? WHERE id = ?`).run(tmp, holder.id);
              holder.ref = tmp;
            }
          }
          if (def.key === "early_warnings" && syntheticEwNo(input.ew_no)) {
            // Only for numbers the converter made up (a blank, reused or corrected column A): a number
            // this import already gave to another row is not a match, and a number now on a
            // differently-worded row gives way to the row that says the same thing about the same
            // package, cost report line and contractor. A number the workbook gives itself is trusted.
            if (match && touched.has(match.id)) match = undefined;
            const want = wordsKey(input.description);
            if (want && (!match || (wordsKey(match.description) && wordsKey(match.description) !== want))) {
              const same = (a: unknown, b: unknown) => !a || !b || String(a) === String(b);
              const byWords = existingRows.find((e) => !touched.has(e.id) && syntheticEwNo(e.ew_no) && wordsKey(e.description) === want && same(input.cost_line_id, e.cost_line_id) && same(input.package_id, e.package_id) && same(input.contractor_id, e.contractor_id));
              if (byWords) match = byWords;
            }
          }
          // An early warning's made-up number moving from one row to another (the workbook renumbered
          // them): the row that held the number is parked on a placeholder so the number is free, and
          // takes this row's old number once that is free, until its own workbook row comes round.
          let parked: { row: RecordRow; no: string } | null = null;
          if (def.key === "early_warnings" && syntheticEwNo(input.ew_no)) {
            const no = String(input.ew_no).trim().toLowerCase();
            const other = existingRows.find((e) => e !== match && !touched.has(e.id) && String(e.ew_no ?? "").trim().toLowerCase() === no);
            if (other) {
              const tmp = `${input.ew_no} (old)`;
              db.prepare(`UPDATE "${def.table}" SET ew_no = ? WHERE id = ?`).run(tmp, other.id);
              other.ew_no = tmp;
              if (match && match.ew_no && String(match.ew_no).trim().toLowerCase() !== no) parked = { row: other, no: String(match.ew_no) };
            }
          }
          if (match) {
            const before = match.updated_at;
            const after = updateRecord(def, match.id, input, user, "import");
            if (after.updated_at === before) result.unchanged++;
            else result.updated++;
            Object.assign(match, after);
            touched.add(match.id);
            if (parked) {
              db.prepare(`UPDATE "${def.table}" SET ew_no = ? WHERE id = ?`).run(parked.no, parked.row.id);
              parked.row.ew_no = parked.no;
            }
          } else {
            const created = createRecord(def, input, user, "import");
            existingRows.push(created as RecordRow);
            result.created++;
            touched.add(created.id);
          }
        } catch (e) {
          const msg = e instanceof ValidationError ? [e.message, ...Object.values(e.fieldErrors)].join(" ") : e instanceof Error ? e.message : String(e);
          result.errors.push({ row: r, message: msg });
        }
      }
    });
    tx();
    releaseMemory();
    progress(sheetLabel, Math.min(b + BATCH, rowNos.length), rowNos.length);
    await yieldNow();
    }
    results.push(result);
    debug(`sheet ${m.sheet} → ${m.register}`);
  }
  progress("Storing the report");

  // An older month rebuilt from its monthly workbook: rows the workbook did not contain are removed from
  // the registers it fed (matched rows keep their ids, so links from claims, bonds and final accounts hold).
  let pruned = 0;
  // A stand-alone tracker is mirrored whole: for the projects it fed, rows the file no longer carries
  // are removed – unless a row of that sheet failed, when nothing is removed until it is put right.
  if (recoveryOnly) {
    for (const [key, ids] of touchedByRegister) {
      const def = getRegisterDef(key);
      const fed = recoveryScope.get(key);
      // the Claims Tracker only adds and updates: a claim entered by hand, or dropped from the tracker, stays
      if (!(RECOVERY_REGISTERS as readonly string[]).includes(key)) continue;
      if (!def || !fed?.size || results.some((r) => r.register === key && r.errors.length)) continue;
      const list = [...ids];
      pruned += db.prepare(`DELETE FROM "${def.table}" WHERE programme_id IN (${[...fed].map(() => "?").join(",")}) AND id NOT IN (${list.map(() => "?").join(",") || "-1"})`).run(...fed, ...list).changes;
    }
  }
  // The Bonds & Insurance tracker mirrors Schedule G of the report: once the sheet has gone in without an
  // error, the project's rows the report no longer carries (old copies, superseded refs) are removed.
  {
    const ids = touchedByRegister.get("bonds");
    const fedBonds = (monthly && !standalone.includes("bonds")) || !!req.allowedRegisters?.includes("bonds");
    if (fedBonds && ids && ids.size && !results.some((r) => r.register === "bonds" && r.errors.length)) {
      const list = [...ids];
      const gone = db.prepare(`SELECT id FROM bonds WHERE programme_id = ? AND id NOT IN (${list.map(() => "?").join(",")})`).all(programmeId, ...list) as { id: number }[];
      if (gone.length) {
        const goneIds = gone.map((g) => g.id);
        if (tableExists(db, "bond_documents")) db.prepare(`DELETE FROM bond_documents WHERE bond_id IN (${goneIds.map(() => "?").join(",")})`).run(...goneIds);
        pruned += db.prepare(`DELETE FROM bonds WHERE id IN (${goneIds.map(() => "?").join(",")})`).run(...goneIds).changes;
      }
    }
  }
  if (older && monthly) {
    for (const [key, ids] of touchedByRegister) {
      const def = getRegisterDef(key);
      if (!def || !def.snapshot || standalone.includes(key)) continue;
      const scoped = def.fields.some((f) => f.key === "programme_id");
      const list = [...ids];
      const where = `${scoped ? "programme_id = ? AND " : ""}id NOT IN (${list.map(() => "?").join(",") || "-1"})`;
      pruned += db.prepare(`DELETE FROM "${def.table}" WHERE ${where}`).run(...(scoped ? [programmeId] : []), ...list).changes;
    }
  }

  // The same early warning brought in twice under two numbers (a re-import after its number was
  // corrected in the workbook) is one early warning: the copy this import did not touch goes.
  let dedupedEws = 0;
  if (monthly) {
    const ids = touchedByRegister.get("early_warnings");
    const def = getRegisterDef("early_warnings");
    if (ids?.size && def) {
      const rows = db.prepare(`SELECT id, description, cost_line_id, package_id FROM "${def.table}" WHERE programme_id = ?`).all(programmeId) as { id: number; description: string | null; cost_line_id: number | null; package_id: number | null }[];
      const kept = new Map(rows.filter((r) => ids.has(r.id)).map((r) => [`${wordsKey(r.description)}|${r.cost_line_id ?? ""}|${r.package_id ?? ""}`, r.id]));
      for (const r of rows) {
        if (ids.has(r.id)) continue;
        const k = `${wordsKey(r.description)}|${r.cost_line_id ?? ""}|${r.package_id ?? ""}`;
        if (!wordsKey(r.description) || !kept.has(k)) continue;
        db.prepare(`DELETE FROM "${def.table}" WHERE id = ?`).run(r.id);
        dedupedEws++;
      }
    }
  }

  // An import is where the same company gets entered a second time under a slightly different
  // spelling, so the tidy-up happens here rather than being left to be noticed later on a report
  // that has quietly split a contractor in two. Only names that match once full stops, spaces and
  // capitals are taken out are merged; anything needing judgement is left alone and shown on the
  // Contractors page instead.
  const merged = mergeDuplicateContractors(db, user);

  logAudit(db, {
    registerKey: "workbook",
    recordId: periodId,
    action: "import",
    user,
    summary: `Imported workbook for ${period.label}: ${results.map((r) => `${r.sheet} → ${r.register} (${r.created} added, ${r.updated} updated, ${r.errors.length} errors)`).join("; ")}${pruned ? (recoveryOnly ? `; ${pruned} row(s) no longer on the tracker removed` : `; ${pruned} row(s) not in the workbook removed from this older report`) : ""}${dedupedEws ? `; ${dedupedEws} duplicated early warning(s) removed` : ""}${merged.groups ? `; ${merged.removed} duplicate contractor record(s) merged into ${merged.groups} ${merged.groups === 1 ? "company" : "companies"} (${merged.moved} record(s) moved)` : ""}`,
  });

  // the library shows the monthly workbook the report came from; a stand-alone import does not replace that name
  if (monthly) db.prepare("UPDATE reporting_periods SET source_file = ?, imported_at = ?, imported_by = ? WHERE id = ?").run(String(req.fileName ?? "").slice(0, 200) || null, nowIso(), user.name, periodId);
  else db.prepare("UPDATE reporting_periods SET imported_at = ?, imported_by = ? WHERE id = ?").run(nowIso(), user.name, periodId);
  if (monthly && req.control && typeof req.control === "object") {
    // report control from the workbook: reference, Executive Summary narrative and the report checklist
    const c = req.control;
    if (c.aconex_ref) db.prepare("UPDATE reporting_periods SET aconex_ref = ? WHERE id = ?").run(String(c.aconex_ref).slice(0, 200), periodId);
    if (c.key_issues) db.prepare("UPDATE reporting_periods SET key_issues = ? WHERE id = ?").run(String(c.key_issues).slice(0, 20000), periodId);
    if (c.checklist && typeof c.checklist === "object") {
      const items = getChecklist(periodId);
      for (const [mod, done] of Object.entries(c.checklist)) {
        const item = items.find((i) => i.module_no === Number(mod));
        if (item && !!item.done !== !!done) setChecklistItem(item.id, { done: !!done }, user);
      }
    }
  }
  if (monthly && req.excelCheck && typeof req.excelCheck === "object") {
    // the Excel's own Level 1 figures travel with the report, and the workbook's layout decides the project's Level 1 convention
    db.prepare("UPDATE reporting_periods SET excel_check = ? WHERE id = ?").run(JSON.stringify(req.excelCheck), periodId);
    db.prepare("UPDATE programmes SET hold_in_afa = ? WHERE id = ?").run(req.excelCheck.holdInAfa ? 1 : 0, programmeId);
  }
  // the imported month is stored as this report's own data
  takeSnapshot(periodId, user, "import");
  // the workbook itself is kept: the month's report is written back into this very layout
  if (monthly) {
    try {
      const file = uploadPath(req.fileId);
      if (fs.existsSync(file)) saveReportTemplate(programmeId, String(req.fileName ?? "report.xlsx"), fs.readFileSync(file), user);
    } catch (e) {
      console.error("report template could not be kept:", e);
    }
  }
  releaseMemory();
  debug("snapshot taken");
  await yieldNow();
  let locked = false;
  if (req.lock && user.role === "admin") {
    const totalErrors = results.reduce((t, r) => t + r.errors.length, 0);
    if (totalErrors === 0) {
      progress("Locking the report");
      lockPeriod(periodId, user, { force: olderImport });
      locked = true;
      debug("period locked");
    }
  }
  // keep the write-ahead log small after a big import (it is checkpointed into the main file)
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    /* best effort */
  }
  if (older) {
    // put the live registers back to the latest report and return the top bar to it
    restoreFromSnapshot(db, latest!.id);
    setSetting(db, "current_period_id", String(latest!.id));
    logAudit(db, { registerKey: "reporting_periods", recordId: latest!.id, action: "context", user, summary: `Live figures restored to ${latest!.label} after importing ${period.label} (${baseNote})` });
  }
  return { period: { id: periodId, label: period.label, locked, olderThan: olderImport ? newer[0].label : undefined }, sheets: results, lookupsCreated: [...new Set(lookupsCreated)] };
}

