import fs from "node:fs";
import path from "node:path";
import { getDb, getSetting, setSetting } from "../db";
import { logAudit } from "../audit";
import { requestBackup } from "../cloud-backup";
import { readWorkbookValues } from "../workbook/read";
import { convertMarinaReport, looksLikeMarinaReport, toSheetValues } from "../workbook/marina";
import { analyzeWorkbook } from "../workbook/analyze";
import { storeUpload, saveConverted, importWorkbook } from "../workbook/import";
import { withHeavyLock } from "../workbook/heavy";
import type { UserInfo } from "../registers/types";
import { allRegisters } from "../registers";

/**
 * One-off rebuild (5 Oct 2026). The Yacht Club's IPC logs were read with faults the corrected converter no
 * longer has: HKS's design-architect sheet went to the competition-fee contract (PS.003D02 instead of
 * PS.003D03); the NSCC sheet's all-plots summary (130.6M) stood in for the AYC plot (16.5M); an undated first
 * certificate read as the latest (Dewan 0.47M instead of 9.03M); five FF&E sheets were skipped and two filed
 * under Enviro; NSCC, Armetal, Hassan Allam and AREEN had no cost line. Reports No 48 and No 49 ship with this
 * version (data-seed/ayc), so their contracts and IPC logs are imported again with the corrected converter –
 * contracts and payment applications only, nothing else – and each covered contract's log is the report's.
 * Runs once in the background, only while those two reports are the project's latest and open.
 */
const FILES = ["AYC_Commercial_Report_No._49_Live.xlsx", "AYC_Commercial_Report_No._48_Final.xlsx"];
// v2 (5 Oct 2026, afternoon): read again with the converter that keeps a settled contract at Schedule H's certified
// (SAB, terminated: 170.6M, not its last IPA's 237.9M), gives a contract certified only in Schedule H its figure, and
// reads Schedule H's short contractor codes as whole words ("SIC" is Soil Improvement Contracting, not "Music System")
const FLAG = "rebuilt_ayc_payment_logs_v2";
const SYSTEM = { id: 0, name: "system", email: "", role: "admin" } as UserInfo;

/** A payment application filed under another project's contract (an import that resolved the PO across projects) goes to its own project's contract with that PO. */
export function repairCrossProjectPayments(): void {
  const db = getDb();
  if (getSetting(db, "repaired_cross_project_payments") === "1") return;
  try {
    const rows = db
      .prepare(
        `SELECT p.id, p.programme_id, p.application_no, c.reef_po_no,
                (SELECT o.id FROM contracts o WHERE o.programme_id = p.programme_id AND TRIM(o.reef_po_no) = TRIM(c.reef_po_no) LIMIT 1) AS own
         FROM payment_applications p JOIN contracts c ON c.id = p.contract_id
         WHERE c.programme_id IS NOT NULL AND p.programme_id IS NOT NULL AND c.programme_id <> p.programme_id`,
      )
      .all() as { id: number; programme_id: number; application_no: string | null; reef_po_no: string | null; own: number | null }[];
    let moved = 0;
    for (const r of rows) {
      if (!r.own) continue;
      db.prepare("UPDATE payment_applications SET contract_id = ? WHERE id = ?").run(r.own, r.id);
      logAudit(db, { registerKey: "payment_applications", recordId: r.id, action: "update", user: null, summary: `${r.application_no ?? "Application"} moved to its own project's contract ${r.reef_po_no ?? ""} (it had been filed under another project's contract with the same PO)` });
      moved++;
    }
    setSetting(db, "repaired_cross_project_payments", "1");
    if (moved) console.log(`[repair] ${moved} payment application(s) moved to their own project's contract.`);
  } catch (e) {
    console.error("[repair] cross-project payments:", e);
  }
}

export async function rebuildAycPaymentLogsAtStart(): Promise<void> {
  const db = getDb();
  if (getSetting(db, FLAG) === "1") return;
  const programme = db.prepare("SELECT id, name FROM programmes WHERE code = '1TB01003'").get() as { id: number; name: string } | undefined;
  if (!programme) return;
  const dir = path.join(process.cwd(), "data-seed", "ayc");
  const files = FILES.map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
  if (files.length !== FILES.length) return;
  const periods = db.prepare("SELECT id, report_no, status FROM reporting_periods WHERE programme_id = ? ORDER BY report_no DESC").all(programme.id) as { id: number; report_no: number; status: string }[];
  const p49 = periods.find((p) => p.report_no === 49);
  const p48 = periods.find((p) => p.report_no === 48);
  setSetting(db, FLAG, "1");
  if (!p49 || !p48 || periods[0].report_no !== 49 || p49.status === "Locked" || p48.status === "Locked") {
    console.log(`[ayc] payment logs not rebuilt – Reports No 48 and 49 are not the Yacht Club's latest open reports; re-import its latest report to rebuild them.`);
    return;
  }
  const keep = { period: getSetting(db, "current_period_id"), programme: getSetting(db, "current_programme_id") };
  try {
    for (const file of files) {
      const name = path.basename(file);
      const period = /No\._49/.test(name) ? p49 : p48;
      await withHeavyLock(async () => {
        const fileId = storeUpload(fs.readFileSync(file));
        let sheets = await readWorkbookValues(file);
        if (!looksLikeMarinaReport(sheets)) throw new Error(`${name} is not in the Marina report layout`);
        const conv = convertMarinaReport(sheets);
        sheets = toSheetValues(conv);
        saveConverted(fileId, sheets);
        const a = analyzeWorkbook(sheets, name, fileId);
        const res = await importWorkbook(
          {
            fileId,
            period: { id: period.id },
            sheets: a.sheets.map((s) => ({ sheet: s.name, headerRow: s.headerRow, register: s.register, columns: Object.fromEntries(s.columns.map((c) => [String(c.index), c.field])) })),
            lock: false,
            createMissingLookups: true,
            allowedRegisters: ["contracts", "payment_applications"],
            programmeId: programme.id,
            fileName: name,
            replacePaymentLogs: true,
          },
          SYSTEM,
        );
        const added = res.sheets.reduce((t, r) => t + r.created, 0);
        const updated = res.sheets.reduce((t, r) => t + r.updated, 0);
        const errors = res.sheets.reduce((t, r) => t + r.errors.length, 0);
        console.log(`[ayc] contracts and IPC logs of ${name} rebuilt → ${added} added, ${updated} updated${errors ? `, ${errors} row(s) could not be read: ${res.sheets.flatMap((r) => r.errors.map((x) => `${r.sheet} row ${x.row}: ${x.message}`)).join("; ")}` : ""}`);
      });
    }
    requestBackup("ayc-payments");
  } catch (e) {
    console.error("[ayc] rebuilding the payment logs failed:", e);
  } finally {
    if (keep.period) setSetting(db, "current_period_id", keep.period);
    if (keep.programme) setSetting(db, "current_programme_id", keep.programme);
  }
}

/**
 * A row linked to another project's cost report line (an import that picked the line by package across projects:
 * the Yacht Club's change "Kitchen Equipment at AYC" on VBH's CN.006C22 instead of its own CN.006C22) goes to its
 * own project's line with that code – in the register and in the report copies that hold it.
 */
export function repairCrossProjectCostLines(): void {
  const db = getDb();
  if (getSetting(db, "repaired_cross_project_cost_lines") === "1") return;
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
    let moved = 0;
    for (const t of tables) {
      const cols = (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);
      if (!cols.includes("programme_id") || t === "cost_lines") continue;
      const key = allRegisters.find((d) => d.table === t)?.key ?? t;
      for (const col of cols.filter((c) => /^(?:from_|to_)?cost_line_id$/.test(c))) {
        const rows = db
          .prepare(
            `SELECT r.id, r.programme_id, l.id AS line, l.code,
                    (SELECT o.id FROM cost_lines o WHERE o.programme_id = r.programme_id AND TRIM(o.code) = TRIM(l.code) LIMIT 1) AS own
             FROM "${t}" r JOIN cost_lines l ON l.id = r."${col}"
             WHERE r.programme_id IS NOT NULL AND l.programme_id IS NOT NULL AND l.programme_id <> r.programme_id`,
          )
          .all() as { id: number; programme_id: number; line: number; code: string; own: number | null }[];
        for (const r of rows) {
          if (!r.own) continue;
          db.prepare(`UPDATE "${t}" SET "${col}" = ? WHERE id = ?`).run(r.own, r.id);
          db.prepare(
            `UPDATE snapshots SET data = json_set(data, '$.${col}', ?)
             WHERE register_key = ? AND record_id = ? AND json_extract(data, '$.${col}') = ? AND period_id IN (SELECT id FROM reporting_periods WHERE programme_id = ?)`,
          ).run(r.own, key, r.id, r.line, r.programme_id);
          logAudit(db, { registerKey: key, recordId: r.id, action: "update", user: null, summary: `Cost report line ${r.code} set to this project's own line (it had been linked to another project's line with the same code)` });
          moved++;
        }
      }
    }
    setSetting(db, "repaired_cross_project_cost_lines", "1");
    if (moved) console.log(`[repair] ${moved} row(s) linked to their own project's cost report line.`);
  } catch (e) {
    console.error("[repair] cross-project cost lines:", e);
  }
}
