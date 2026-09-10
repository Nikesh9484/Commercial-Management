import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { appendUploadPart, finishUploadParts } from "@/lib/workbook/import";
import { addFile, getCase, canUseEar, removeBucket, EAR_MAX_FILE_BYTES } from "@/lib/ear/store";
import { extractText } from "@/lib/ear/extract";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Adds one document (any file type) to a case. The browser sends it in base64 pieces, like the
 * workbook import, so company web filters do not cut large binary uploads short:
 * { uploadId, bucket, name, relPath, mime, size, index, count, data }
 */
export async function POST(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    if (!canUseEar(user)) throw new AuthError("Only Editors and Admins can upload documents to a case.");
    const { id } = await params;
    const c = getCase(Number(id));
    if (!c) return NextResponse.json({ error: "Case not found." }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as { uploadId?: string; bucket?: string; name?: string; relPath?: string; mime?: string; size?: number; index?: number; count?: number; data?: string };
    const part = Buffer.from(body.data ?? "", "base64");
    if (typeof body.size === "number" && body.size > EAR_MAX_FILE_BYTES) return NextResponse.json({ error: `${body.name ?? "This file"} is larger than ${Math.round(EAR_MAX_FILE_BYTES / 1024 / 1024)} MB.` }, { status: 400 });
    const uploadId = appendUploadPart(body.uploadId || null, part);
    if ((body.index ?? 0) < (body.count ?? 1) - 1) return NextResponse.json({ uploadId });
    const bytes = finishUploadParts(uploadId);
    if (typeof body.size === "number" && bytes.length !== body.size) {
      return NextResponse.json({ error: `The upload of ${body.name ?? "the file"} arrived incomplete (${bytes.length.toLocaleString()} of ${body.size.toLocaleString()} bytes). Please try again.` }, { status: 400 });
    }
    const name = String(body.name ?? "file");
    const extracted = await extractText(name, bytes, String(body.mime ?? ""));
    const file = addFile(c.id, String(body.bucket ?? ""), { name, relPath: body.relPath, bytes, mime: String(body.mime ?? "") }, extracted, user);
    return NextResponse.json({ file }, { status: 201 });
  })(req, ctx);
}

/** DELETE ?bucket=submission|template|contract|prev_ear|prev_submission – empties that group; without ?bucket, every group. */
export async function DELETE(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { id } = await params;
    const bucket = new URL(req.url).searchParams.get("bucket");
    const removed = removeBucket(Number(id), bucket || null, user);
    return NextResponse.json({ ok: true, removed });
  })(req, ctx);
}
