import { getDb, getSetting, setSetting } from "../db";
import { getRegisterDef } from "../registers";
import { updateRecord, deleteRecord } from "../registers/engine";
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

/**
 * One-off (5 Oct 2026): customs rows that were nothing but a contract code – the tracker lists the Yacht
 * Club's direct-payment codes (003C203 …) with no vendor, figures or notes – are removed; the converter no
 * longer makes them.
 */
export function repairBareCustomsRows(): void {
  const db = getDb();
  if (getSetting(db, "repaired_bare_customs") === "1") return;
  setSetting(db, "repaired_bare_customs", "1");
  const def = getRegisterDef("customs_recovery");
  if (!def) return;
  const keys = ["legal_entity", "action_lead", "contract_value", "remaining_to_pay", "customs_payer", "other_contract_note", "vat_deferred", "vat_definitive", "customs_fasah", "customs_naif", "customs_rsg_paid", "customs_contractor_paid", "to_recover", "actual_customs_cost", "unrecoverable", "recoverable_via_contractor", "ps_exceeds", "notice_ref", "pvo_ref", "pvo_date", "pvo_value", "ewn_ref", "ewn_value", "comments"];
  const rows = db.prepare("SELECT * FROM customs_recovery").all() as RecordRow[];
  let gone = 0;
  for (const r of rows) {
    const codeOnly = !r.vendor || String(r.vendor) === String(r.contract_code ?? "");
    if (!codeOnly || !keys.every((k) => r[k] === null || r[k] === undefined || r[k] === "" || r[k] === 0)) continue;
    try {
      deleteRecord(def, Number(r.id), SYSTEM);
      gone++;
    } catch (e) {
      console.warn("[customs] bare row not removed:", e instanceof Error ? e.message : e);
    }
  }
  if (gone) console.log(`[customs] ${gone} code-only customs row(s) removed.`);
}
