import fs from "node:fs";
import path from "node:path";
import { getDb, getSetting, setSetting } from "../db";
import { readWorkbookValues } from "../workbook/read";
import { looksLikeMarinaReport, convertMarinaReport, toSheetValues } from "../workbook/marina";
import { analyzeWorkbook } from "../workbook/analyze";
import { storeUpload, saveConverted, importWorkbook } from "../workbook/import";
import { withHeavyLock } from "../workbook/heavy";
import { requestBackup } from "../cloud-backup";
import type { UserInfo } from "../registers/types";

/**
 * One-off (5 Oct 2026): the Amaala Yacht Club's monthly reports No 48 (September, final) and No 49
 * (October, live) ship with this version under data-seed/ayc and are imported into the AYC project on
 * the first start after the deploy – the same path as the monthly import page, one file after the
 * other, lowest report first – so the project is complete without an upload. Runs once in the
 * background after the server is up; a start that already tried is not retried on its own (the files
 * can always be imported from the import page), and a project that already holds those reports is
 * left as it is.
 */
const FILES = ["AYC_Commercial_Report_No._48_Final.xlsx", "AYC_Commercial_Report_No._49_Live.xlsx"];
const SYSTEM = { id: 0, name: "system", email: "", role: "admin" } as UserInfo;

export function importAycReportsAtStart(): Promise<void> {
  const db = getDb();
  if (getSetting(db, "ayc_reports_imported") === "1") return Promise.resolve();
  const programme = db.prepare("SELECT id FROM programmes WHERE code = '1TB01003'").get() as { id: number } | undefined;
  if (!programme) return Promise.resolve();
  const dir = path.join(process.cwd(), "data-seed", "ayc");
  const files = FILES.map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
  if (!files.length) return Promise.resolve();
  if (getSetting(db, "ayc_reports_attempted") === "1") {
    console.warn("[ayc] the start-up import of the Yacht Club reports was tried before and did not finish – import them from the monthly import page.");
    return Promise.resolve();
  }
  setSetting(db, "ayc_reports_attempted", "1");
  const run = async () => {
    for (const file of files) {
      const name = path.basename(file);
      const reportNo = Number(/No\.?_?\s*(\d+)/i.exec(name)?.[1] ?? 0);
      if (reportNo && db.prepare("SELECT 1 FROM reporting_periods WHERE programme_id = ? AND report_no = ?").get(programme.id, reportNo)) {
        console.log(`[ayc] Report No ${reportNo} is already in the Yacht Club library – skipped.`);
        continue;
      }
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
            period: { report_no: conv.reportNo ?? undefined, period_end: conv.periodEnd ?? undefined },
            sheets: a.sheets.map((s) => ({ sheet: s.name, headerRow: s.headerRow, register: s.register, columns: Object.fromEntries(s.columns.map((c) => [String(c.index), c.field])) })),
            lock: false,
            createMissingLookups: true,
            programmeId: programme.id,
            fileName: name,
            excelCheck: conv.level1 ?? null,
            control: conv.control ?? null,
          },
          SYSTEM,
        );
        const added = res.sheets.reduce((t, r) => t + r.created, 0);
        const updated = res.sheets.reduce((t, r) => t + r.updated, 0);
        const errors = res.sheets.reduce((t, r) => t + r.errors.length, 0);
        console.log(`[ayc] ${name} → ${res.period.label}: ${added} added, ${updated} updated${errors ? `, ${errors} row(s) could not be read` : ""}`);
      });
    }
    setSetting(db, "ayc_reports_imported", "1");
    requestBackup("ayc-reports");
  };
  return run().catch((e) => console.error("[ayc] start-up import failed:", e));
}
