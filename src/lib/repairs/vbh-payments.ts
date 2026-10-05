import fs from "node:fs";
import path from "node:path";
import { getDb, getSetting, setSetting } from "../db";
import { logAudit } from "../audit";
import { requestBackup } from "../cloud-backup";
import { getRegisterDef } from "../registers";
import { listRecords } from "../registers/engine";
import { computeCostReport } from "../cost-report/compute";
import { getCashflow } from "../cashflow/compute";
import { nowIso } from "../format";

/**
 * One-off repair (5 Oct 2026). The Village Boutique Hotel's IPC logs (the "Schedule H …" sheets) had been
 * read with three faults, so "Certified to date" (column P) stood 558M above the report's own figures:
 *  - a sheet holding several blocks lost each block's heading, so every block went to one contract and was
 *    added up – the Foster + Partners whole-PO summary and its MLH / Luxury Village blocks (other projects)
 *    on top of the VBH block (285.5M against 69.7M), the nine ACES purchase orders all on PS.006D01;
 *  - the sheet's cumulative column was followed where it is wrong (an advance row counted twice, a restart);
 *  - advance payments were counted as certified work, which Aconex and SCHD B leave out.
 * The corrected converter reads them right from now on. The project's log on file is replaced here from the
 * corrected reading of Report No 49 (data-seed/payments/1TB01006), the report the live registers belong to:
 * each contract it covers gets the corrected log in place of its old one (every row of it came from a workbook
 * import); each stored VBH report gets the same contracts' applications up to its cut-off, and its stored
 * calculation is refreshed. Runs once, and only while Report No 49 is the project's latest report (a later
 * report imported with the corrected converter carries its own log).
 */
const FLAG = "repaired_vbh_payment_logs_r49";

interface Seed {
  programme: string;
  report_no: number;
  columns: { label: string; key: string }[];
  rows: unknown[][];
}

export function repairVbhPaymentLogs(): void {
  const db = getDb();
  if (getSetting(db, FLAG) === "1") return;
  const file = path.join(process.cwd(), "data-seed", "payments", "1TB01006", "report-49-ipc-log.json");
  if (!fs.existsSync(file)) return;
  try {
    const seed = JSON.parse(fs.readFileSync(file, "utf8")) as Seed;
    const programme = db.prepare("SELECT id, name FROM programmes WHERE code = ?").get(seed.programme) as { id: number; name: string } | undefined;
    if (!programme) return; // a fresh database: the project's report is imported with the corrected converter
    const latest = db.prepare("SELECT id, report_no FROM reporting_periods WHERE programme_id = ? ORDER BY report_no DESC LIMIT 1").get(programme.id) as { id: number; report_no: number } | undefined;
    if (!latest || latest.report_no !== seed.report_no) {
      setSetting(db, FLAG, "1");
      if (latest) console.log(`[repair] ${programme.name}: payment logs not replaced – the latest report is No ${latest.report_no}, not No ${seed.report_no}; re-import it to rebuild its IPC log.`);
      return;
    }
    const col = (key: string) => seed.columns.findIndex((c) => c.key === key);
    const ix = Object.fromEntries(["contract_id", "sr_no", "application_no", "month", "application_aconex_ref", "application_date", "cumulative_claimed", "ipc_no", "ipc_aconex_ref", "ipc_date", "cumulative_certified", "invoice_aconex_ref", "invoice_date", "paid_date", "comments"].map((k) => [k, col(k)])) as Record<string, number>;
    const contracts = new Map((db.prepare("SELECT id, reef_po_no FROM contracts WHERE programme_id = ?").all(programme.id) as { id: number; reef_po_no: string | null }[]).map((c) => [String(c.reef_po_no ?? "").trim(), c.id]));
    const poOf = new Map([...contracts.entries()].map(([po, id]) => [id, po]));
    const byContract = new Map<number, unknown[][]>();
    const unknown = new Set<string>();
    for (const r of seed.rows) {
      const po = String(r[ix.contract_id] ?? "").trim();
      const cid = contracts.get(po);
      if (!cid) {
        unknown.add(po);
        continue;
      }
      byContract.set(cid, [...(byContract.get(cid) ?? []), r]);
    }
    const val = (r: unknown[], k: string) => {
      const v = r[ix[k]];
      return v === undefined || v === "" ? null : v;
    };
    const stamp = nowIso();
    const def = getRegisterDef("payment_applications")!;
    const periods = db.prepare("SELECT id, report_no, period_end FROM reporting_periods WHERE programme_id = ? ORDER BY report_no").all(programme.id) as { id: number; report_no: number; period_end: string }[];
    let removed = 0;
    let added = 0;
    /** each covered contract's latest application in the corrected log, by PO (stored reports have their own contract ids) */
    const lastOf = new Map<string, string>();
    const tx = db.transaction(() => {
      const ins = db.prepare(
        `INSERT INTO payment_applications(created_at, created_by, updated_at, updated_by, programme_id, contract_id, sr_no, fa_id, application_no, month, application_aconex_ref, application_date, cumulative_claimed, ipc_no, ipc_aconex_ref, ipc_date, cumulative_certified, invoice_aconex_ref, invoice_date, paid_date, comments)
         VALUES(?, 'system', ?, 'system', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const [cid, rows] of byContract) {
        const last = rows.map((r) => String(val(r, "application_date") ?? "")).sort().pop() ?? "";
        lastOf.set(poOf.get(cid)!, last);
        // every row of the project's log came from a workbook import (none fed from a document or typed in),
        // and the old reading put other contracts' later applications on this one: the whole log is replaced
        removed += db.prepare("DELETE FROM payment_applications WHERE programme_id = ? AND contract_id = ?").run(programme.id, cid).changes;
        for (const r of rows) {
          ins.run(stamp, stamp, programme.id, cid, val(r, "sr_no"), val(r, "application_no"), val(r, "month"), val(r, "application_aconex_ref"), val(r, "application_date"), val(r, "cumulative_claimed"), val(r, "ipc_no"), val(r, "ipc_aconex_ref"), val(r, "ipc_date"), val(r, "cumulative_certified"), val(r, "invoice_aconex_ref"), val(r, "invoice_date"), val(r, "paid_date"), val(r, "comments"));
          added++;
        }
      }
      // the stored reports: the same applications, as far as each report's cut-off
      const fresh = listRecords(def, { allScopes: true }).filter((r) => Number(r.programme_id) === programme.id && byContract.has(Number(r.contract_id)));
      const del = db.prepare("DELETE FROM snapshots WHERE id = ?");
      const put = db.prepare("INSERT INTO snapshots(period_id, register_key, record_id, data, taken_at) VALUES(?, 'payment_applications', ?, ?, ?)");
      for (const p of periods) {
        const stored = db.prepare("SELECT id, data, taken_at FROM snapshots WHERE period_id = ? AND register_key = 'payment_applications'").all(p.id) as { id: number; data: string; taken_at: string }[];
        if (!stored.length) continue;
        const takenAt = stored[0].taken_at;
        // the report's own contracts (an older stored copy carries the contract ids it had then)
        const own = (db.prepare("SELECT data FROM snapshots WHERE period_id = ? AND register_key = 'contracts'").all(p.id) as { data: string }[]).map((r) => JSON.parse(r.data) as { id: number; reef_po_no?: string | null; title?: string | null; [k: string]: unknown });
        const storedPo = new Map(own.map((c) => [Number(c.id), String(c.reef_po_no ?? "").trim()]));
        const storedByPo = new Map(own.map((c) => [String(c.reef_po_no ?? "").trim(), c]));
        for (const s of stored) {
          const row = JSON.parse(s.data) as { contract_id?: number; application_date?: string | null };
          const last = lastOf.get(storedPo.get(Number(row.contract_id)) ?? poOf.get(Number(row.contract_id)) ?? "");
          if (last === undefined) continue;
          del.run(s.id);
        }
        for (const r of fresh) {
          if (String(r.application_date ?? "") > p.period_end) continue;
          const c = storedByPo.get(poOf.get(Number(r.contract_id)) ?? "");
          if (!c) continue; // a contract this report did not have yet
          const label = String(r.contract_id__label ?? "");
          put.run(p.id, r.id, JSON.stringify({ ...r, contract_id: c.id, contract_id__label: label }), takenAt);
        }
        // the stored calculation (read when a stored copy has no registers) follows its corrected registers
        const lines = computeCostReport(programme.id, p.id).lines;
        db.prepare("DELETE FROM snapshots WHERE period_id = ? AND register_key = 'cost_report'").run(p.id);
        const putLine = db.prepare("INSERT INTO snapshots(period_id, register_key, record_id, data, taken_at) VALUES(?, 'cost_report', ?, ?, ?)");
        for (const l of lines) putLine.run(p.id, l.id, JSON.stringify(l), takenAt);
      }
      // the latest report's stored cash flow is the live one's
      db.prepare("UPDATE snapshots SET data = ? WHERE period_id = ? AND register_key = 'cashflow'").run(JSON.stringify(getCashflow(db, programme.id)), latest.id);
      logAudit(db, {
        registerKey: "payment_applications",
        recordId: null,
        action: "update",
        user: null,
        summary: `${programme.name}: IPC logs of ${byContract.size} contract(s) rebuilt from Report No ${seed.report_no} with the corrected reading – multi-block sheets (Foster + Partners, ACES, DAH, Euro Consult, Contemporain) split to their own contracts, other projects' blocks and whole-PO summaries left out, advance payments not counted as certified work; ${removed} old row(s) replaced by ${added}, and each stored VBH report's applications up to its cut-off the same way${unknown.size ? `; contract(s) not on file: ${[...unknown].join(", ")}` : ""}`,
      });
    });
    tx();
    setSetting(db, FLAG, "1");
    console.log(`[repair] ${programme.name}: IPC logs rebuilt from Report No ${seed.report_no} – ${byContract.size} contract(s), ${removed} row(s) replaced by ${added}.`);
    requestBackup("vbh-payments");
  } catch (e) {
    console.error("[repair] VBH payment logs:", e);
  }
}

/**
 * One-off (5 Oct 2026): the VBH change schedule records "Budget Transfer to 1TB04030.02.CN.98 – CN Budget Hold
 * VBH Cleaning and Restricted Works" against a placeholder code (006D#25) with no RFC / PVO reference, so the
 * import passed it by. It is one of the project's cross-asset budget moves, so the corrected converter keeps it;
 * the row as Report No 49 gives it (data-seed/payments/1TB01006) is added to the change register, live and in
 * that report's stored copy – once, only while Report No 49 is the project's latest report and the row is not there.
 */
export function addVbhBudgetTransferChanges(): void {
  const db = getDb();
  const FLAG2 = "added_vbh_budget_transfer_changes_r49";
  if (getSetting(db, FLAG2) === "1") return;
  const file = path.join(process.cwd(), "data-seed", "payments", "1TB01006", "report-49-budget-transfer-changes.json");
  if (!fs.existsSync(file)) return;
  try {
    const seed = JSON.parse(fs.readFileSync(file, "utf8")) as { programme: string; report_no: number; rows: Record<string, unknown>[] };
    const programme = db.prepare("SELECT id, name FROM programmes WHERE code = ?").get(seed.programme) as { id: number; name: string } | undefined;
    if (!programme) return;
    const latest = db.prepare("SELECT id, report_no, period_end FROM reporting_periods WHERE programme_id = ? ORDER BY report_no DESC LIMIT 1").get(programme.id) as { id: number; report_no: number; period_end: string } | undefined;
    setSetting(db, FLAG2, "1");
    if (!latest || latest.report_no !== seed.report_no) return;
    const idOf = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { id: number } | undefined)?.id ?? null;
    const stamp = nowIso();
    const def = getRegisterDef("changes")!;
    const tx = db.transaction(() => {
      for (const r of seed.rows) {
        if (db.prepare("SELECT 1 FROM changes WHERE programme_id = ? AND item_no = ?").get(programme.id, r.item_no)) continue;
        const assetId = idOf("SELECT id FROM assets WHERE code = ? AND programme_id = ?", r.asset_id, programme.id);
        const info = db
          .prepare(
            `INSERT INTO changes(created_at, created_by, updated_at, updated_by, programme_id, item_no, description, overall_status_id, date_raised, asset_id, package_id, cost_line_id, project_stage_id, change_category_id, action_pending_by, ew_ref, ew_date, notes)
             VALUES(?, 'system', ?, 'system', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            stamp,
            stamp,
            programme.id,
            r.item_no,
            r.description,
            idOf("SELECT id FROM approval_statuses WHERE name = ?", r.overall_status_id),
            r.date_raised ?? null,
            assetId,
            idOf("SELECT id FROM packages WHERE name = ? AND (asset_id IS NULL OR asset_id IN (SELECT id FROM assets WHERE programme_id = ?))", r.package_id, programme.id),
            idOf("SELECT id FROM cost_lines WHERE code = ? AND programme_id = ?", r.cost_line_id, programme.id),
            idOf("SELECT id FROM project_stages WHERE name = ?", r.project_stage_id),
            idOf("SELECT id FROM change_categories WHERE name = ?", r.change_category_id),
            r.action_pending_by ?? null,
            r.ew_ref ?? null,
            r.ew_date ?? null,
            r.notes ?? null,
          );
        const id = Number(info.lastInsertRowid);
        // the report's stored copy carries it too (Report No 49 is read from its stored copy once locked)
        const row = listRecords(def, { allScopes: true }).find((x) => Number(x.id) === id);
        const taken = (db.prepare("SELECT taken_at FROM snapshots WHERE period_id = ? AND register_key = 'changes' LIMIT 1").get(latest.id) as { taken_at: string } | undefined)?.taken_at;
        if (row && taken) db.prepare("INSERT INTO snapshots(period_id, register_key, record_id, data, taken_at) VALUES(?, 'changes', ?, ?, ?)").run(latest.id, id, JSON.stringify(row), taken);
        logAudit(db, { registerKey: "changes", recordId: id, action: "create", user: null, summary: `${String(r.item_no)} added from Report No ${seed.report_no}'s change schedule: ${String(r.description)} (a budget transfer the import had passed by)` });
      }
    });
    tx();
  } catch (e) {
    console.error("[repair] VBH budget-transfer changes:", e);
  }
}

/**
 * VBH's Schedule C shades its inter-asset transfers green; the import reads the shading from this version on. The
 * entries of Report No 49 – the report already in – are marked from the shipped list of its green rows (item numbers
 * as the import gave them), in the register and in the report's stored copy. Only the mark is set; nothing else changes.
 */
export function markVbhInterAssetChanges(): void {
  const db = getDb();
  const FLAG3 = "marked_vbh_inter_asset_changes_r49";
  if (getSetting(db, FLAG3) === "1") return;
  const file = path.join(process.cwd(), "data-seed", "changes", "1TB01006", "report-49-inter-asset.json");
  if (!fs.existsSync(file)) return;
  try {
    const seed = JSON.parse(fs.readFileSync(file, "utf8")) as { programme: string; report_no: number; items: { item_no: string }[] };
    const programme = db.prepare("SELECT id FROM programmes WHERE code = ?").get(seed.programme) as { id: number } | undefined;
    if (!programme) return;
    const latest = db.prepare("SELECT id, report_no FROM reporting_periods WHERE programme_id = ? ORDER BY report_no DESC LIMIT 1").get(programme.id) as { id: number; report_no: number } | undefined;
    setSetting(db, FLAG3, "1");
    if (!latest || latest.report_no !== seed.report_no) return;
    let marked = 0;
    const tx = db.transaction(() => {
      for (const it of seed.items) {
        const row = db.prepare("SELECT id, inter_asset FROM changes WHERE programme_id = ? AND item_no = ?").get(programme.id, it.item_no) as { id: number; inter_asset: number | null } | undefined;
        if (!row || row.inter_asset === 1) continue;
        db.prepare("UPDATE changes SET inter_asset = 1 WHERE id = ?").run(row.id);
        db.prepare("UPDATE snapshots SET data = json_set(data, '$.inter_asset', json('true')) WHERE period_id = ? AND register_key = 'changes' AND record_id = ?").run(latest.id, row.id);
        logAudit(db, { registerKey: "changes", recordId: row.id, action: "update", user: null, summary: `${it.item_no} marked as an inter-asset transfer (shaded green in Report No ${seed.report_no}'s Schedule C)` });
        marked++;
      }
    });
    tx();
    if (marked) console.log(`[repair] ${marked} VBH change(s) marked as inter-asset transfers from Report No ${seed.report_no}'s Schedule C.`);
  } catch (e) {
    console.error("[repair] VBH inter-asset marks:", e);
  }
}
