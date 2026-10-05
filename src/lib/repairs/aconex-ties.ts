import { getDb, getSetting, setSetting } from "../db";
import { requestBackup } from "../cloud-backup";
import { aconexContextFor } from "../recovery/contexts";
import { contractRowTie, exactLineOf } from "../workbook/aconex";

/**
 * One-off (5 Oct 2026): the Aconex control-account rows already uploaded are tied to their cost report
 * lines again the way a fresh upload would tie them – the contract code read whole (the Yacht Club's
 * 003C270 is not 003C27), the section honoured (MS.003F02 is not FFEOSE.003F02), the direct payments on
 * behalf of the main contractor marked as such, and a contract the cost report codes under another line
 * tied by its contract number or name. Budget-hold rows are left as they are.
 */
export function repairAconexTies(): void {
  const db = getDb();
  if (getSetting(db, "repaired_aconex_ties") === "1") return;
  setSetting(db, "repaired_aconex_ties", "1");
  let changed = 0;
  const programmes = db.prepare("SELECT id, code, name FROM programmes ORDER BY id").all() as { id: number; code: string; name: string }[];
  for (const programme of programmes) {
    const rows = db.prepare("SELECT id, code, name, row_type, cost_line_id FROM aconex_control_accounts WHERE programme_id = ? AND row_type IS NOT 'Budget hold'").all(programme.id) as { id: number; code: string; name: string | null; row_type: string | null; cost_line_id: number | null }[];
    if (!rows.length) continue;
    const ctx = aconexContextFor(db, programme, "");
    const lineId = new Map((db.prepare("SELECT id, code FROM cost_lines WHERE programme_id = ?").all(programme.id) as { id: number; code: string }[]).map((l) => [l.code, l.id]));
    const exact = new Set<string>();
    for (const r of rows) {
      const l = exactLineOf(String(r.code), ctx);
      if (l?.code) exact.add(l.code);
    }
    let own = 0;
    for (const r of rows) {
      const tie = contractRowTie(String(r.code), String(r.name ?? ""), ctx, exact);
      const want = tie.line ? (lineId.get(tie.line.code) ?? null) : null;
      if (tie.rowType === (r.row_type ?? "") && want === (r.cost_line_id ?? null)) continue;
      db.prepare("UPDATE aconex_control_accounts SET row_type = ?, cost_line_id = ?, updated_at = ?, updated_by = 'system' WHERE id = ?").run(tie.rowType, want, new Date().toISOString(), r.id);
      own++;
    }
    if (own) console.log(`[aconex] ${programme.name}: ${own} control-account row(s) re-tied to their cost report lines.`);
    changed += own;
  }
  if (changed) requestBackup("aconex-ties");
}
