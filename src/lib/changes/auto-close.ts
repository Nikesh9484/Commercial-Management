import type Database from "better-sqlite3";
import { logAudit } from "../audit";
import { closedContracts } from "../bonds/closed";
import { nowIso } from "../format";
import { CLOSED_STATUSES } from "../registers/defs/changes";

/** The overall status a change takes when the contract it belongs to is finished. */
export const CONTRACT_CLOSED_STATUS = "Closed";

/** Makes sure the approval statuses list carries the status the auto-close writes. */
export function ensureClosedStatus(db: Database.Database): number {
  const row = db.prepare("SELECT id FROM approval_statuses WHERE name = ? COLLATE NOCASE").get(CONTRACT_CLOSED_STATUS) as { id: number } | undefined;
  if (row) return row.id;
  const stamp = nowIso();
  const max = (db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM approval_statuses").get() as { m: number }).m;
  const r = db
    .prepare("INSERT INTO approval_statuses(name, sort_order, active, created_at, created_by, updated_at, updated_by) VALUES(?, ?, 1, ?, 'system', ?, 'system')")
    .run(CONTRACT_CLOSED_STATUS, max + 10, stamp, stamp);
  return Number(r.lastInsertRowid);
}

type Row = {
  id: number;
  item_no: string | null;
  overall_status_id: number | null;
  cost_line_id: number | null;
  contractor_id: number | null;
  dvo_closed: number | null;
  closed_by_contract: number | null;
  status_before_close_id: number | null;
};

/**
 * Closes every open change on a contract the Final Account Status (or, failing that, Payment
 * Tracking) says is finished – whatever stage or status it was left at – and reopens the ones it
 * closed itself when the contract is opened again. The status it writes is "Closed"; a change
 * already approved, rejected, cancelled, superseded or transferred is left as it is. Runs over the
 * live rows only: issued reports keep what they were issued with.
 */
export function syncContractClosedChanges(db: Database.Database, programmeId?: number): { closed: number; reopened: number } {
  const closedId = ensureClosedStatus(db);
  const names = new Map((db.prepare("SELECT id, name FROM approval_statuses").all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
  const pendingId = [...names.entries()].find(([, n]) => n === "Pending")?.[0] ?? null;
  const programmes = programmeId !== undefined ? [programmeId] : (db.prepare("SELECT id FROM programmes").all() as { id: number }[]).map((r) => r.id);
  const stamp = nowIso();
  const close = db.prepare(
    "UPDATE changes SET overall_status_id = ?, closed_by_contract = 1, status_before_close_id = ?, updated_at = ?, updated_by = 'system' WHERE id = ?",
  );
  const reopen = db.prepare("UPDATE changes SET overall_status_id = ?, closed_by_contract = 0, status_before_close_id = NULL, updated_at = ?, updated_by = 'system' WHERE id = ?");
  const forget = db.prepare("UPDATE changes SET closed_by_contract = 0, status_before_close_id = NULL WHERE id = ?");
  let closedCount = 0;
  let reopened = 0;
  const run = db.transaction(() => {
    for (const p of programmes) {
      const closed = closedContracts(db, p);
      const rows = db
        .prepare("SELECT id, item_no, overall_status_id, cost_line_id, contractor_id, dvo_closed, closed_by_contract, status_before_close_id FROM changes WHERE programme_id = ?")
        .all(p) as Row[];
      for (const r of rows) {
        const lineId = r.cost_line_id === null ? null : Number(r.cost_line_id);
        const contractClosed = lineId !== null ? closed.lines.has(lineId) : r.contractor_id !== null && closed.contractors.has(Number(r.contractor_id));
        const label = r.overall_status_id === null ? "" : (names.get(Number(r.overall_status_id)) ?? "");
        const isOpen = r.dvo_closed !== 1 && !CLOSED_STATUSES.includes(label);
        if (contractClosed && isOpen) {
          close.run(closedId, r.overall_status_id, stamp, r.id);
          closedCount++;
          logAudit(db, {
            registerKey: "changes",
            recordId: r.id,
            action: "update",
            user: null,
            summary: `Closed Change "${r.item_no ?? r.id}" automatically – the contract it belongs to is closed in the Final Account Status`,
            changes: { overall_status_id: { from: label || null, to: CONTRACT_CLOSED_STATUS } },
          });
        } else if (!contractClosed && r.closed_by_contract === 1 && label === CONTRACT_CLOSED_STATUS) {
          const back = r.status_before_close_id !== null && names.has(Number(r.status_before_close_id)) ? Number(r.status_before_close_id) : pendingId;
          reopen.run(back, stamp, r.id);
          reopened++;
          logAudit(db, {
            registerKey: "changes",
            recordId: r.id,
            action: "update",
            user: null,
            summary: `Reopened Change "${r.item_no ?? r.id}" – its contract is open again in the Final Account Status`,
            changes: { overall_status_id: { from: CONTRACT_CLOSED_STATUS, to: back === null ? null : (names.get(back) ?? null) } },
          });
        } else if (r.closed_by_contract === 1 && (label !== CONTRACT_CLOSED_STATUS || !contractClosed)) {
          // the status moved on by other means (a DVO approved, say): nothing to put back any more
          forget.run(r.id);
        }
      }
    }
  });
  run();
  return { closed: closedCount, reopened };
}
