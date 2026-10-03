import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { appendUploadPart, finishUploadParts } from "@/lib/workbook/import";
import { addDoc, canManagePacks, PACK_MAX_FILE_BYTES } from "@/lib/packs/store";

/** Adds one supporting file to a pack, in base64 pieces: { uploadId, caseId, name, relPath, mime, size, index, count, data, slot? }. */
export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (!canManagePacks(user)) throw new AuthError("A viewer account cannot add documents to a pack.");
    const body = (await req.json().catch(() => ({}))) as { uploadId?: string; caseId?: number; name?: string; relPath?: string; mime?: string; size?: number; index?: number; count?: number; data?: string; slot?: string };
    const caseId = Number(body.caseId);
    if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: "Which pack the document belongs to was not given." }, { status: 400 });
    if (typeof body.size === "number" && body.size > PACK_MAX_FILE_BYTES) return NextResponse.json({ error: `${body.name ?? "This file"} is larger than ${Math.round(PACK_MAX_FILE_BYTES / 1024 / 1024)} MB.` }, { status: 400 });
    const part = Buffer.from(body.data ?? "", "base64");
    const uploadId = appendUploadPart(body.uploadId || null, part, PACK_MAX_FILE_BYTES);
    if ((body.index ?? 0) < (body.count ?? 1) - 1) return NextResponse.json({ uploadId });
    const bytes = finishUploadParts(uploadId);
    if (typeof body.size === "number" && bytes.length !== body.size) return NextResponse.json({ error: `The upload of ${body.name ?? "the file"} arrived incomplete (${bytes.length.toLocaleString()} of ${body.size.toLocaleString()} bytes). Please try again.` }, { status: 400 });
    const doc = await addDoc(caseId, { name: String(body.name ?? "file"), relPath: body.relPath, bytes, mime: String(body.mime ?? ""), slot: body.slot }, user);
    return NextResponse.json({ doc }, { status: 201 });
  })(req, ctx);
}
