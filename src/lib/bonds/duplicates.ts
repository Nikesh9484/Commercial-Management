import { getDb } from "../db";
import { getRegisterDef } from "../registers";
import { deleteRecord, getRecord, listRecords, updateRecord, ValidationError } from "../registers/engine";
import { isEditorRole, type RecordRow, type UserInfo } from "../registers/types";
import { formatDate, formatMoney, todayIso } from "../format";
import { contractorKey } from "./name-key";
import { ensureBondDocuments } from "./documents";

/**
 * The same bond or policy entered twice on the Bonds & Insurance tracker – a renewal keyed in as a
 * new row, an amendment matched to the wrong row, a register imported from two places. Each group is
 * one bond: the original entry is kept (its start date is the date the bond was first put in place),
 * the later copies are folded into it and removed. A validity extension never changes the start date;
 * it only moves the expiry date on.
 */
export interface DuplicateRow {
  id: number;
  ref: string;
  contractor: string;
  contract: string;
  type: string;
  policy_no: string;
  issuer: string;
  amount: number | null;
  start_date: string;
  expiry_date: string;
  approved: boolean;
  documents: number;
  created_at: string;
}
export interface DuplicateGroup {
  key: string;
  /** why the rows count as one bond */
  reason: string;
  rows: DuplicateRow[];
  /** the original entry – the earliest start date, else the first recorded */
  suggestedKeep: number;
  /** the expiry the group would carry if the later copies are renewals */
  latestExpiry: string;
}

/** A policy number without the bits that change on a renewal: spaces, "POLICY NO." labels, /R1 and /E1 endorsement suffixes. */
export function policyKey(v: unknown): string {
  return String(v ?? "")
    .toUpperCase()
    .replace(/POLICY\s*NO\.?\s*:?/g, "")
    .replace(/\s*[-–]?\s*ENDORS\.?\s*NO\.?.*$/g, "")
    .replace(/\s+/g, "")
    .replace(/[/\-.](?:R|E|REV|END)\d{1,3}$/i, "")
    .replace(/^[-/.]+|[-/.]+$/g, "");
}
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const same = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) < 0.5;

function samePolicy(a: RecordRow, b: RecordRow): string | null {
  if (contractorKey(a.contractor_id__label) !== contractorKey(b.contractor_id__label)) return null;
  const ka = policyKey(a.policy_no);
  const kb = policyKey(b.policy_no);
  if (ka && kb && ka === kb) return "the same policy / bond number";
  const da = digits(a.policy_no);
  const db = digits(b.policy_no);
  if (Number(a.type_id) === Number(b.type_id) && da.length >= 7 && db.length >= 7 && (da.startsWith(db) || db.startsWith(da))) return "the same policy / bond number (one with an endorsement suffix)";
  if (Number(a.type_id) === Number(b.type_id) && same(num(a.amount_provided), num(b.amount_provided)) && (num(a.amount_provided) ?? 0) > 0 && String(a.expiry_date ?? "") === String(b.expiry_date ?? "") && !!a.expiry_date) return "the same type, amount and expiry date for the same contractor";
  return null;
}

/** The duplicate groups on one programme's tracker. */
export function findBondDuplicates(programmeId: number): DuplicateGroup[] {
  const db = getDb();
  const def = getRegisterDef("bonds")!;
  ensureBondDocuments(db);
  // with their contractor, type and contract names, and the usual working out (released, superseded)
  const rows = listRecords(def, { allScopes: true })
    .filter((r) => Number(r.programme_id) === programmeId)
    .sort((a, b) => Number(a.id) - Number(b.id));
  if (rows.length < 2) return [];
  const docCount = new Map((db.prepare("SELECT bond_id, COUNT(*) AS n FROM bond_documents GROUP BY bond_id").all() as { bond_id: number; n: number }[]).map((r) => [r.bond_id, r.n]));
  // union-find: a row joins the group of any row it is the same bond as
  const parent = new Map<number, number>();
  const find = (i: number): number => (parent.get(i) === i || !parent.has(i) ? i : find(parent.get(i)!));
  const reasons = new Map<number, Set<string>>();
  rows.forEach((r) => parent.set(Number(r.id), Number(r.id)));
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) {
      const why = samePolicy(rows[i], rows[j]);
      if (!why) continue;
      const a = find(Number(rows[i].id));
      const b = find(Number(rows[j].id));
      if (a !== b) parent.set(b, a);
      const root = find(a);
      reasons.set(root, new Set([...(reasons.get(a) ?? []), ...(reasons.get(b) ?? []), why]));
    }
  const groups = new Map<number, RecordRow[]>();
  for (const r of rows) {
    const root = find(Number(r.id));
    groups.set(root, [...(groups.get(root) ?? []), r]);
  }
  const out: DuplicateGroup[] = [];
  for (const [root, list] of groups) {
    if (list.length < 2) continue;
    const toRow = (r: RecordRow): DuplicateRow => ({
      id: Number(r.id),
      ref: String(r.ref ?? ""),
      contractor: String(r.contractor_id__label ?? ""),
      contract: String(r.cost_line_id__label ?? r.package_id__label ?? ""),
      type: String(r.type_id__label ?? ""),
      policy_no: String(r.policy_no ?? ""),
      issuer: String(r.issuer ?? ""),
      amount: num(r.amount_provided),
      start_date: String(r.start_date ?? ""),
      expiry_date: String(r.expiry_date ?? ""),
      approved: !!r.approved,
      documents: docCount.get(Number(r.id)) ?? 0,
      created_at: String(r.created_at ?? ""),
    });
    const drows = list.map(toRow);
    const withStart = drows.filter((r) => r.start_date);
    const keep = (withStart.length ? withStart.reduce((a, b) => (b.start_date < a.start_date ? b : a)) : drows.reduce((a, b) => (b.created_at < a.created_at ? b : a))).id;
    out.push({
      key: `dup:${programmeId}:${root}`,
      reason: `${[...(reasons.get(root) ?? [])].join("; ") || "the same bond"}${new Set(drows.map((r) => r.contract)).size > 1 ? " – listed under more than one contract" : ""}`,
      rows: drows,
      suggestedKeep: keep,
      latestExpiry: drows.map((r) => r.expiry_date).filter(Boolean).sort().at(-1) ?? "",
    });
  }
  return out.sort((a, b) => a.rows[0].contractor.localeCompare(b.rows[0].contractor) || a.rows[0].type.localeCompare(b.rows[0].type));
}

/**
 * Folds the later copies into the entry kept. The kept entry's own details stand; what it lacks is
 * filled from the copies; the start date becomes the earliest of the group (when the bond was first
 * put in place); the expiry date moves to the latest of the group only when the copies are
 * renewals (carryExpiry). The copies' documents move across, then the copies are removed.
 */
export function mergeBondDuplicates(input: { keep: number; remove: number[]; carryExpiry: boolean }, user: UserInfo): RecordRow {
  if (!isEditorRole(user.role)) throw new ValidationError("Only an admin or editor can merge entries (the copies are removed).");
  const def = getRegisterDef("bonds")!;
  const db = getDb();
  ensureBondDocuments(db);
  const keep = getRecord(def, input.keep);
  if (!keep) throw new ValidationError("The entry to keep was not found (it may have been deleted).");
  const remove = [...new Set(input.remove.map(Number))].filter((id) => id !== Number(keep.id)).map((id) => getRecord(def, id)).filter((r): r is RecordRow => !!r);
  if (!remove.length) throw new ValidationError("Choose at least one copy to fold into the entry kept.");
  if (remove.some((r) => Number(r.programme_id) !== Number(keep.programme_id))) throw new ValidationError("The entries are not on the same programme.");
  // the names are what the finder compared; the ids may differ when the same company was entered twice
  const names = db.prepare("SELECT id, name FROM contractors").all() as { id: number; name: string }[];
  const nameOf = (id: unknown) => contractorKey(names.find((n) => n.id === Number(id))?.name ?? "");
  if (remove.some((r) => Number(r.contractor_id) !== Number(keep.contractor_id) && nameOf(r.contractor_id) !== nameOf(keep.contractor_id))) throw new ValidationError("The entries are for different contractors – they cannot be one bond.");
  const all = [keep, ...remove];
  const patch: Record<string, unknown> = {};
  const starts = all.map((r) => String(r.start_date ?? "")).filter(Boolean).sort();
  if (starts.length && starts[0] !== String(keep.start_date ?? "")) patch.start_date = starts[0];
  const expiries = all.map((r) => String(r.expiry_date ?? "")).filter(Boolean).sort();
  if (input.carryExpiry && expiries.length && expiries.at(-1) !== String(keep.expiry_date ?? "")) patch.expiry_date = expiries.at(-1);
  for (const k of ["policy_no", "issuer", "amount_provided", "requirement_value", "original_contract_sum", "cost_line_id", "package_id"]) {
    if (keep[k] === null || keep[k] === undefined || keep[k] === "") {
      const v = remove.map((r) => r[k]).find((x) => x !== null && x !== undefined && x !== "");
      if (v !== undefined) patch[k] = v;
    }
  }
  if (!keep.approved && remove.some((r) => r.approved)) patch.approved = true;
  if (!keep.bank_verification && remove.some((r) => r.bank_verification)) patch.bank_verification = true;
  const notes = remove.map((r) => `Ref ${r.ref}${r.policy_no ? ` – policy ${r.policy_no}` : ""}${r.expiry_date ? `, expiry ${formatDate(String(r.expiry_date))}` : ""}${r.amount_provided ? `, ${formatMoney(Number(r.amount_provided))} SAR` : ""}`);
  const extra = remove.map((r) => String(r.comments ?? "").trim()).filter((c) => c && c !== String(keep.comments ?? "").trim());
  patch.comments = [String(keep.comments ?? "").trim(), `Merged on ${formatDate(todayIso())}: ${notes.join("; ")} – the same bond entered more than once; one entry kept${patch.expiry_date ? `, validity carried to ${formatDate(String(patch.expiry_date))}` : ""}${patch.start_date ? `, start date ${formatDate(String(patch.start_date))}` : ""}.`, ...extra.map((c) => `From the merged entry: ${c}`)].filter(Boolean).join("\n");
  const move = db.prepare("UPDATE bond_documents SET bond_id = ? WHERE bond_id = ?");
  const tx = db.transaction(() => {
    const row = updateRecord(def, Number(keep.id), patch, user, "form");
    for (const r of remove) {
      // a document of the same name already on the kept entry stays; the copy's is dropped with it
      const names = new Set((db.prepare("SELECT name FROM bond_documents WHERE bond_id = ?").all(Number(keep.id)) as { name: string }[]).map((d) => d.name));
      for (const d of db.prepare("SELECT id, name FROM bond_documents WHERE bond_id = ?").all(Number(r.id)) as { id: number; name: string }[]) {
        if (names.has(d.name)) db.prepare("DELETE FROM bond_documents WHERE id = ?").run(d.id);
      }
      move.run(Number(keep.id), Number(r.id));
      deleteRecord(def, Number(r.id), user);
    }
    return row;
  });
  tx();
  return getRecord(def, Number(keep.id))!;
}
