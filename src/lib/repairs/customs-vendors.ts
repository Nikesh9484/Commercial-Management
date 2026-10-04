import { getDb, getSetting, setSetting } from "../db";
import { getRegisterDef } from "../registers";
import { updateRecord } from "../registers/engine";
import type { RecordRow, RegisterDef } from "../registers/types";
import { matchContractor, type KnownContractor } from "../workbook/recovery";
import { codeFrag } from "../workbook/claims-tracker";

/**
 * One-off (4 Oct 2026): customs tracker rows whose vendor name fitted more than one of our contractors
 * were left without a contract ("Nova Composites Industries" against Nova Composite Industrial Company
 * and Nova Composites Manufacturing). Name matching now tells words of the same stem apart, so those
 * rows – the vendor's summary line and its declarations – are tied to the contractor and, where that
 * contractor holds one contract in the project, to its contract code and cost report line.
 */
const SYSTEM = { id: 0, name: "system", email: "", role: "admin" } as never;
const AMBIGUOUS = /\s*Vendor fits more than one of our contractors[^\n]*(?:\n|$)/g;

export function repairCustomsVendorLinks(): void {
  const db = getDb();
  if (getSetting(db, "repaired_customs_vendors") === "1") return;
  try {
    const recDef: RegisterDef | undefined = getRegisterDef("customs_recovery");
    const declDef: RegisterDef | undefined = getRegisterDef("customs_declarations");
    if (!recDef || !declDef) return;
    const programmes = db.prepare("SELECT id, code, name FROM programmes").all() as { id: number; code: string; name: string }[];
    let tied = 0;
    for (const p of programmes) {
      const contractors = new Map<number, KnownContractor>();
      const lines = db.prepare("SELECT l.code, l.contractor_id, c.name AS contractor FROM cost_lines l LEFT JOIN contractors c ON c.id = l.contractor_id WHERE l.programme_id = ? AND l.is_budget_hold IS NOT 1").all(p.id) as { code: string; contractor_id: number | null; contractor: string | null }[];
      for (const l of lines) if (l.contractor_id && l.contractor) contractors.set(l.contractor_id, { id: l.contractor_id, name: l.contractor, primary: true });
      for (const c of db.prepare("SELECT DISTINCT c.id, c.name FROM contractors c JOIN (SELECT contractor_id FROM contracts WHERE programme_id = ? UNION SELECT contractor_id FROM bonds WHERE programme_id = ? UNION SELECT contractor_id FROM final_accounts WHERE programme_id = ?) x ON x.contractor_id = c.id").all(p.id, p.id, p.id) as { id: number; name: string }[]) if (!contractors.has(c.id)) contractors.set(c.id, { id: c.id, name: c.name, primary: false });
      const known = [...contractors.values()];
      const contracts = db.prepare("SELECT id, acc_ref, contractor_id, cost_line_id FROM contracts WHERE programme_id = ?").all(p.id) as { id: number; acc_ref: string | null; contractor_id: number | null; cost_line_id: number | null }[];
      const linkFor = (vendor: string) => {
        const c = matchContractor(vendor, known);
        if (!c) return null;
        const mine = contracts.filter((x) => Number(x.contractor_id) === c.id);
        const one = mine.length === 1 ? mine[0] : null;
        return { contractor_id: c.id, contract_code: one ? codeFrag(String(one.acc_ref ?? "")) ?? (one.acc_ref || null) : null, cost_line_id: one?.cost_line_id ?? null };
      };
      const defs: RegisterDef[] = [recDef, declDef];
      for (const def of defs) {
        const rows = db.prepare(`SELECT * FROM "${def.table}" WHERE programme_id = ? AND contractor_id IS NULL AND vendor IS NOT NULL AND vendor <> ''`).all(p.id) as RecordRow[];
        for (const r of rows) {
          const link = linkFor(String(r.vendor));
          if (!link) continue;
          const patch: Record<string, unknown> = { contractor_id: link.contractor_id };
          if (link.contract_code && !r.contract_code) patch.contract_code = link.contract_code;
          if (link.cost_line_id && !r.cost_line_id) patch.cost_line_id = link.cost_line_id;
          if (def === recDef) {
            const comments = String(r.comments ?? "").replace(AMBIGUOUS, "").trim();
            patch.comments = [comments, `Tied to ${contractors.get(link.contractor_id)?.name ?? "the contractor"}${link.contract_code ? ` (${link.contract_code})` : ""} by name on start-up (4 Oct 2026).`].filter(Boolean).join("\n");
          }
          updateRecord(def, Number(r.id), patch, SYSTEM, "import", { bypassRoles: true });
          tied++;
        }
      }
    }
    if (tied) console.log(`[repair] customs vendor rows tied to their contractor: ${tied}`);
    setSetting(db, "repaired_customs_vendors", "1");
  } catch (e) {
    console.error("[repair] customs vendor links failed:", e);
  }
}
