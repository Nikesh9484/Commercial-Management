import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { appendUploadPart, finishUploadParts } from "@/lib/workbook/import";
import { addKpiDoc, canManageKpi, KPI_MAX_FILE_BYTES } from "@/lib/kpi/store";

/**
 * Adds one supporting document to a KPI entry (a change). The browser sends the file in base64
 * pieces, like the workbook import and the libraries: { uploadId, changeId, name, relPath, mime,
 * size, index, count, data, section? }. The last piece files the document and returns the row.
 */
export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (!canManageKpi(user)) throw new AuthError("Only Editors and Admins can add KPI documents.");
    const body = (await req.json().catch(() => ({}))) as { uploadId?: string; changeId?: number; name?: string; relPath?: string; mime?: string; size?: number; index?: number; count?: number; data?: string; section?: string };
    const changeId = Number(body.changeId);
    if (!Number.isInteger(changeId) || changeId <= 0) return NextResponse.json({ error: "Which change the document belongs to was not given." }, { status: 400 });
    if (typeof body.size === "number" && body.size > KPI_MAX_FILE_BYTES) return NextResponse.json({ error: `${body.name ?? "This file"} is larger than ${Math.round(KPI_MAX_FILE_BYTES / 1024 / 1024)} MB.` }, { status: 400 });
    const part = Buffer.from(body.data ?? "", "base64");
    const uploadId = appendUploadPart(body.uploadId || null, part);
    if ((body.index ?? 0) < (body.count ?? 1) - 1) return NextResponse.json({ uploadId });
    const bytes = finishUploadParts(uploadId);
    if (typeof body.size === "number" && bytes.length !== body.size) return NextResponse.json({ error: `The upload of ${body.name ?? "the file"} arrived incomplete (${bytes.length.toLocaleString()} of ${body.size.toLocaleString()} bytes). Please try again.` }, { status: 400 });
    const doc = addKpiDoc(changeId, { name: String(body.name ?? "file"), relPath: body.relPath, bytes, mime: String(body.mime ?? ""), section: body.section }, user);
    return NextResponse.json({ doc }, { status: 201 });
  })(req, ctx);
}
