import fs from "node:fs";
import path from "node:path";
import { getDb, getSetting, setSetting } from "../db";
import { requestBackup } from "../cloud-backup";
import { csvToSheets, looksLikeAconexExport, convertAconexExport, convertAconexChangeEvents } from "../workbook/aconex";
import { toSheetValues } from "../workbook/marina";
import { analyzeWorkbook } from "../workbook/analyze";
import { storeUpload, saveConverted, importWorkbook } from "../workbook/import";
import { withHeavyLock } from "../workbook/heavy";
import { aconexContextFor } from "../recovery/contexts";
import type { UserInfo } from "../registers/types";

/**
 * The Aconex Cost exports on file when this version shipped – data-seed/aconex/<project code>/*.csv, a
 * control-account export and a change-event export per project – are imported at the first start after
 * the deploy, each file once, exactly as an upload from the Aconex import page would be: the project's
 * rows become the export's. So every project's Aconex Cost Check carries its change events (the PVOs,
 * DVOs and budget transfers behind each difference) without an upload. A later upload simply replaces them.
 */
const SYSTEM = { id: 0, name: "system", email: "", role: "admin" } as UserInfo;

export async function importAconexSeedsAtStart(): Promise<void> {
  const db = getDb();
  const root = path.join(process.cwd(), "data-seed", "aconex");
  if (!fs.existsSync(root)) return;
  for (const code of fs.readdirSync(root)) {
    const programme = db.prepare("SELECT id, code, name FROM programmes WHERE code = ?").get(code) as { id: number; code: string; name: string } | undefined;
    const dir = path.join(root, code);
    if (!programme || !fs.statSync(dir).isDirectory()) continue;
    if (!db.prepare("SELECT 1 FROM reporting_periods WHERE programme_id = ? LIMIT 1").get(programme.id)) continue;
    for (const name of fs.readdirSync(dir).filter((f) => /\.csv$/i.test(f)).sort()) {
      const flag = `aconex_seed:${code}:${name}`;
      if (getSetting(db, flag) === "1") continue;
      setSetting(db, flag, "1");
      try {
        await withHeavyLock(async () => {
          const text = fs.readFileSync(path.join(dir, name)).toString("utf8");
          const ws = csvToSheets(text, name);
          const changeEvents = !looksLikeAconexExport(ws);
          const ctx = aconexContextFor(db, programme, name);
          const conv = changeEvents ? convertAconexChangeEvents(ws, ctx) : convertAconexExport(ws, ctx);
          const sheets = toSheetValues(conv);
          const fileId = storeUpload(Buffer.from(text));
          saveConverted(fileId, sheets);
          const a = analyzeWorkbook(sheets, name, fileId);
          const res = await importWorkbook(
            {
              fileId,
              period: {},
              sheets: a.sheets.map((s) => ({ sheet: s.name, headerRow: s.headerRow, register: s.register, columns: Object.fromEntries(s.columns.map((c) => [String(c.index), c.field])) })),
              lock: false,
              createMissingLookups: true,
              allowedRegisters: ["aconex_control_accounts", "aconex_change_events"],
              programmeId: programme.id,
              fileName: name,
            },
            SYSTEM,
          );
          const added = res.sheets.reduce((t, r) => t + r.created, 0);
          const updated = res.sheets.reduce((t, r) => t + r.updated, 0);
          const errors = res.sheets.reduce((t, r) => t + r.errors.length, 0);
          console.log(`[aconex] ${programme.name}: ${name} → ${added} row(s) added, ${updated} updated${errors ? `, ${errors} row(s) could not be read` : ""}. ${conv.notes.join(" ")}`);
        });
        requestBackup("aconex-seed");
      } catch (e) {
        console.error(`[aconex] importing ${name} for ${programme.name} failed:`, e);
      }
    }
  }
}
