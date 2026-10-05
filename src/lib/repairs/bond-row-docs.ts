import { getDb, getSetting, setSetting } from "../db";
import { requestBackup } from "../cloud-backup";
import { ensureBondDocuments, readBondDocument } from "../bonds/documents";
import { addBondsFromDocuments } from "../bonds/from-docs";
import type { UserInfo } from "../registers/types";

/**
 * One-off (5 Oct 2026). Until this version a document dropped on one row of the Bonds & Insurance register was only
 * kept with that row – its details were not read. They are now; the documents filed that way before are read once,
 * one at a time, and each updates its own row under the same checks as a new upload: only that row's policy, or the
 * same cover for the same company, never a validity taken backwards. A document of another policy changes nothing.
 */
const FLAG = "applied_row_bond_documents_v1";
const SYSTEM = { id: 0, name: "system", email: "", role: "admin" } as UserInfo;

export async function applyRowBondDocumentsAtStart(): Promise<void> {
  const db = getDb();
  if (getSetting(db, FLAG) === "1") return;
  setSetting(db, FLAG, "1");
  ensureBondDocuments(db);
  const docs = db.prepare("SELECT id, bond_id, name FROM bond_documents WHERE note = 'added on the register' ORDER BY id").all() as { id: number; bond_id: number; name: string }[];
  let updated = 0;
  for (const d of docs) {
    try {
      if (!db.prepare("SELECT 1 FROM bonds WHERE id = ?").get(d.bond_id)) continue;
      const file = readBondDocument(d.id);
      if (!file) continue;
      const res = await addBondsFromDocuments([{ name: d.name, bytes: file.bytes }], SYSTEM, {}, { bondId: d.bond_id });
      if (res.entries.some((e) => e.id === d.bond_id)) updated++;
      console.log(`[bonds] ${d.name} (on entry ${d.bond_id}): ${res.entries.length ? "entry updated" : (res.warnings[0] ?? res.files[0]?.note ?? "nothing read").slice(0, 160)}`);
    } catch (e) {
      console.error(`[bonds] ${d.name} could not be read:`, e instanceof Error ? e.message : e);
    }
  }
  if (updated) requestBackup("bond-documents");
}
