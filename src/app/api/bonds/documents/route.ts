import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { requestBackup } from "@/lib/cloud-backup";
import { attachBondDocuments } from "@/lib/bonds/documents";
import { appendUploadPart, finishUploadParts } from "@/lib/workbook/import";

/** a certificate pack or a scanned guarantee can run to a couple of hundred MB */
const MAX_BYTES = 300 * 1024 * 1024;
const ROLES = ["admin", "editor", "contributor", "reporter"];

/**
 * POST /api/bonds/documents – a file dropped on (or picked for) one bond or insurance row of the register, kept
 * with that entry and opened from its Documents column. The body carries one piece of the file at a time:
 * { bondId, uploadId?, name, index, count, data (base64) } – the last piece files it. The entry itself is not
 * changed – use "Add from documents" on the page when the file should update the register.
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
    requestBackup("documents");
    return NextResponse.json({ ok: true, document: { id: doc.id, name: doc.name, note: doc.note } });
  })(req, undefined);
}
