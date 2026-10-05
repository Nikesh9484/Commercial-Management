import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { requestBackup } from "@/lib/cloud-backup";
import { attachBondDocuments } from "@/lib/bonds/documents";
import { appendUploadPart, finishUploadParts } from "@/lib/workbook/import";
import { addBondsFromDocuments } from "@/lib/bonds/from-docs";

/** a certificate pack or a scanned guarantee can run to a couple of hundred MB */
const MAX_BYTES = 300 * 1024 * 1024;
const ROLES = ["admin", "editor", "contributor", "reporter"];

/**
 * POST /api/bonds/documents – a file dropped on (or picked for) one bond or insurance row of the register, kept
 * with that entry and opened from its Documents column. The body carries one piece of the file at a time:
 * { bondId, uploadId?, name, index, count, data (base64) } – the last piece files it. A policy, certificate,
 * guarantee or amendment is then read and updates that entry (its number, insurer, amount and validity), as "Add from
 * documents" would – but only when it is that entry's policy or the same cover for the same company; anything else is
 * kept with the entry and the answer says why nothing changed.
 */
export async function POST(req: Request): Promise<Response> {
  return withUser(async (user) => {
    if (!ROLES.includes(user.role)) return NextResponse.json({ error: "Your role cannot add documents to bonds and insurance entries." }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as { bondId?: number; uploadId?: string; name?: string; index?: number; count?: number; data?: string };
    const bondId = Number(body.bondId);
    if (!Number.isInteger(bondId) || bondId <= 0) return NextResponse.json({ error: "Which entry the file belongs to was not given." }, { status: 400 });
    const db = getDb();
    const bond = db.prepare("SELECT id, ref, policy_no FROM bonds WHERE id = ?").get(bondId) as { id: number; ref: string; policy_no: string | null } | undefined;
    if (!bond) return NextResponse.json({ error: "That bond or insurance entry is no longer on the register." }, { status: 404 });
    const part = Buffer.from(String(body.data ?? ""), "base64");
    const uploadId = appendUploadPart(body.uploadId || null, part, MAX_BYTES);
    if ((body.index ?? 0) < (body.count ?? 1) - 1) return NextResponse.json({ uploadId });
    const bytes = finishUploadParts(uploadId);
    const name = String(body.name ?? "document").split(/[\\/]/).pop() || "document";
    const [doc] = attachBondDocuments(bondId, [{ name, bytes }], user, "added on the register");
    logAudit(db, { registerKey: "bonds", recordId: bondId, action: "update", user, summary: `Document added: ${doc.name} (${Math.max(1, Math.round(bytes.length / 1024))} KB)` });
    // read the document and bring the entry up to date with it
    let read = "";
    try {
      const res = await addBondsFromDocuments([{ name, bytes }], user, {}, { bondId });
      const e = res.entries.find((x) => x.id === bondId);
      if (e) {
        const after = db.prepare("SELECT policy_no, expiry_date, amount_provided FROM bonds WHERE id = ?").get(bondId) as { policy_no: string | null; expiry_date: string | null; amount_provided: number | null };
        read = `${bond.ref}: updated from ${name} – policy ${after.policy_no ?? "–"}, expires ${after.expiry_date ?? "–"}${after.amount_provided ? `, ${after.amount_provided.toLocaleString("en-US")} SAR` : ""}.`;
      } else read = res.warnings[0] ?? (res.files[0]?.kind === "transmittal" ? `${name}: a transmittal – kept with the entry (the policy or certificate itself updates it).` : `${name}: kept with the entry – ${res.files[0]?.note ?? "no bond or policy details read from it"}.`);
    } catch (e) {
      read = `${name}: kept with the entry – it could not be read (${e instanceof Error ? e.message.slice(0, 120) : String(e)}).`;
    }
    requestBackup("documents");
    return NextResponse.json({ ok: true, document: { id: doc.id, name: doc.name, note: doc.note }, read });
  })(req, undefined);
}
