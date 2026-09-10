import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb, getSetting, setSetting } from "../db";
import { getRegisterDef } from "../registers";
import { createRecord, updateRecord, listRecords, lookupOptions, ValidationError } from "../registers/engine";
import type { UserInfo, RecordRow } from "../registers/types";
import { lockPeriod, getPeriod } from "../snapshots";
import { logAudit } from "../audit";
import { formatMonthYear, parseDateInput } from "../format";
import { cellText, importKeyFields, norm } from "./analyze";

/* ------------------------------------------------------------------ */
/* Temporary storage of the uploaded workbook (30 minutes)             */

const TMP = path.join(os.tmpdir(), "commercial-dashboard-uploads");

export function storeUpload(buffer: Buffer): string {
  fs.mkdirSync(TMP, { recursive: true });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(path.join(TMP, `${id}.xlsx`), buffer);
  // tidy old files
  for (const f of fs.readdirSync(TMP)) {
    const p = path.join(TMP, f);
    if (Date.now() - fs.statSync(p).mtimeMs > 30 * 60_000) fs.rmSync(p, { force: true });
  }
  return id;
}

export function readUpload(id: string): Buffer {
  if (!/^[a-z0-9]+$/.test(id)) throw new ValidationError("Bad upload id.");
  const p = path.join(TMP, `${id}.xlsx`);
  if (!fs.existsSync(p)) throw new ValidationError("The uploaded file has expired. Please upload it again.");
  return fs.readFileSync(p);
}

/* ------------------------------------------------------------------ */

export interface SheetMapping {
  sheet: string;
  headerRow: number;
  register: string | null;
  /** column index (1-based) -> field key */
  columns: Record<string, string | null>;
}

export interface ImportRequest {
  fileId: string;
  period: { id?: number; report_no?: number; period_end?: string };
  sheets: SheetMapping[];
  lock: boolean;
  createMissingLookups: boolean;
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
  period: { id: number; label: string; locked: boolean };
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

export async function importWorkbook(req: ImportRequest, user: UserInfo): Promise<ImportResult> {
  if (user.role === "viewer") throw new ValidationError("Viewers cannot import.");
  const db = getDb();
  const buffer = readUpload(req.fileId);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  // Reporting period
  let periodId = req.period.id ?? null;
  if (!periodId) {
    if (!req.period.report_no || !req.period.period_end) throw new ValidationError("Choose an existing reporting period or give a report number and cut-off date for a new one.");
    const end = parseDateInput(req.period.period_end);
    if (!end) throw new ValidationError("The cut-off date is not a valid date.");
    const existing = db.prepare("SELECT id FROM reporting_periods WHERE report_no = ?").get(req.period.report_no) as { id: number } | undefined;
    if (existing) periodId = existing.id;
    else {
      const row = createRecord(getRegisterDef("reporting_periods")!, { report_no: req.period.report_no, period_end: end, label: `Monthly Report No ${req.period.report_no} – ${formatMonthYear(end)}` }, user, "import");
      periodId = row.id;
    }
  }
  const period = getPeriod(periodId)!;
  if (period.status === "Locked") throw new ValidationError(`${period.label} is locked. Unlock it first if you really want to re-import that month.`);
  setSetting(db, "current_period_id", String(periodId));
  const programmeId = Number(getSetting(db, "current_programme_id") ?? (db.prepare("SELECT id FROM programmes ORDER BY id LIMIT 1").get() as { id: number } | undefined)?.id ?? 1);

  const lookupsCreated: string[] = [];
  const results: SheetResult[] = [];

  for (const m of req.sheets) {
    if (!m.register) continue;
    const def = getRegisterDef(m.register);
    const ws = wb.getWorksheet(m.sheet);
    if (!def || !ws) continue;
    const result: SheetResult = { sheet: m.sheet, register: m.register, created: 0, updated: 0, unchanged: 0, skipped: 0, errors: [] };
    const colMap = Object.entries(m.columns).filter(([, f]) => f).map(([i, f]) => ({ index: Number(i), field: def.fields.find((x) => x.key === f)! })).filter((c) => c.field);
    if (!colMap.length) {
      results.push(result);
      continue;
    }
    // remember the mapping for next month
    const headers: Record<string, string> = {};
    ws.getRow(m.headerRow).eachCell({ includeEmpty: false }, (c, col) => {
      const f = m.columns[String(col)];
      if (f) headers[norm(cellText(c.value))] = f;
    });
    const sig: string[] = [];
    ws.getRow(m.headerRow).eachCell({ includeEmpty: false }, (c) => {
      const t = cellText(c.value).trim();
      if (t) sig.push(norm(t));
    });
    setSetting(db, `workbook_map:${def.key}`, JSON.stringify({ ...headers, __signature: sig.join("|") }));

    const keyFields = importKeyFields(def);
    const existingRows = listRecords(def);
    const hasPeriodField = def.fields.some((f) => f.key === "period_id");
    const hasCostLine = def.fields.some((f) => f.key === "cost_line_id" && f.type === "lookup");
    const costLines = hasCostLine ? (db.prepare("SELECT id, package_id, contractor_id FROM cost_lines").all() as { id: number; package_id: number | null; contractor_id: number | null }[]) : [];

    const tx = db.transaction(() => {
      for (let r = m.headerRow + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        if (!row.hasValues) continue;
        const input: Record<string, unknown> = {};
        let any = false;
        for (const c of colMap) {
          const raw = row.getCell(c.index).value;
          let v: unknown = raw instanceof Date ? raw : cellText(raw).trim();
          if (typeof raw === "object" && raw !== null && !(raw instanceof Date) && "result" in raw) v = raw.result ?? "";
          if (typeof raw === "number") v = raw;
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
            if (f.type === "boolean") {
              input[f.key] = /^(y|yes|true|1|closed|done)$/i.test(String(v).trim());
              continue;
            }
            if (f.type !== "lookup") continue;
            const target = f.lookup!.register;
            const label = String(v).trim();
            const opts = lookupOptions(db, target, true);
            const want = label.toLowerCase();
            const hit =
              opts.find((o) => o.label.toLowerCase() === want) ??
              opts.find((o) => o.label.toLowerCase().startsWith(want + " · ")) ??
              (want.length >= 3 ? opts.find((o) => o.label.toLowerCase().includes(want)) : undefined);
            if (hit) {
              input[f.key] = hit.id;
              continue;
            }
            if (req.createMissingLookups && (target in AUTO_CREATE || target === "assets")) {
              const extra = target === "assets" ? { code: label, name: label, programme_id: programmeId } : AUTO_CREATE[target];
              const created = createRecord(getRegisterDef(target)!, { name: label, ...extra }, user, "import");
              lookupsCreated.push(`${getRegisterDef(target)!.singular}: ${label}`);
              input[f.key] = created.id;
            } else if (target === "programmes") {
              delete input[f.key]; // fall back to the current asset / programme
            }
          }
          if (hasPeriodField && !("period_id" in input)) input.period_id = periodId;
          // link to the cost report line automatically when the package (and contractor) point to exactly one line
          if (hasCostLine && !input.cost_line_id && (input.package_id || input.contractor_id)) {
            const candidates = costLines.filter(
              (l) => (!input.package_id || l.package_id === input.package_id) && (!input.contractor_id || !l.contractor_id || l.contractor_id === input.contractor_id),
            );
            if (candidates.length === 1) input.cost_line_id = candidates[0].id;
          }
          // find existing record by key
          const match = existingRows.find((e) => keyFields.every((k) => String(e[k] ?? "").trim().toLowerCase() === String(input[k] ?? "").trim().toLowerCase()));
          if (match) {
            const before = match.updated_at;
            const after = updateRecord(def, match.id, input, user, "import");
            if (after.updated_at === before) result.unchanged++;
            else result.updated++;
            Object.assign(match, after);
          } else {
            const created = createRecord(def, input, user, "import");
            existingRows.push(created as RecordRow);
            result.created++;
          }
        } catch (e) {
          const msg = e instanceof ValidationError ? [e.message, ...Object.values(e.fieldErrors)].join(" ") : e instanceof Error ? e.message : String(e);
          result.errors.push({ row: r, message: msg });
        }
      }
    });
    tx();
    results.push(result);
  }

  logAudit(db, {
    registerKey: "workbook",
    recordId: periodId,
    action: "import",
    user,
    summary: `Imported workbook for ${period.label}: ${results.map((r) => `${r.sheet} → ${r.register} (${r.created} added, ${r.updated} updated, ${r.errors.length} errors)`).join("; ")}`,
  });

  let locked = false;
  if (req.lock && user.role === "admin") {
    const totalErrors = results.reduce((t, r) => t + r.errors.length, 0);
    if (totalErrors === 0) {
      lockPeriod(periodId, user);
      locked = true;
    }
  }
  return { period: { id: periodId, label: period.label, locked }, sheets: results, lookupsCreated: [...new Set(lookupsCreated)] };
}

