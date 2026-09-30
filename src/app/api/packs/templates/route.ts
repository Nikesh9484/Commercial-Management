import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { appendUploadPart, finishUploadParts } from "@/lib/workbook/import";
import { canManagePacks, saveTemplate, TEMPLATE_MAX_BYTES } from "@/lib/packs/store";
import { packType, type TemplateInspection } from "@/lib/packs/shared";
import { inspectTemplate } from "@/lib/packs/word";
import { inspectExcelTemplate, isExcelTemplate } from "@/lib/packs/excel";
import { inspectPdfTemplate } from "@/lib/packs/extract";

/**
 * Sets the RSG template of one pack category – the form as a Word file or as an Excel workbook. The browser sends the file in base64 pieces:
 * { uploadId, packType, name, mime, size, index, count, data }. The last piece stores the template
 * and returns it with what it will take (placeholders and matched labels).
 */
export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (!canManagePacks(user)) throw new AuthError("A viewer account cannot change the templates.");
    const body = (await req.json().catch(() => ({}))) as { uploadId?: string; packType?: string; name?: string; mime?: string; size?: number; index?: number; count?: number; data?: string };
    const t = packType(String(body.packType ?? ""));
    if (!t) return NextResponse.json({ error: "Which pack category the template is for was not given." }, { status: 400 });
    if (typeof body.size === "number" && body.size > TEMPLATE_MAX_BYTES) return NextResponse.json({ error: `${body.name ?? "This file"} is larger than ${Math.round(TEMPLATE_MAX_BYTES / 1024 / 1024)} MB.` }, { status: 400 });
    const part = Buffer.from(body.data ?? "", "base64");
    const uploadId = appendUploadPart(body.uploadId || null, part);
    if ((body.index ?? 0) < (body.count ?? 1) - 1) return NextResponse.json({ uploadId });
    const bytes = finishUploadParts(uploadId);
    if (typeof body.size === "number" && bytes.length !== body.size) return NextResponse.json({ error: `The upload of ${body.name ?? "the file"} arrived incomplete. Please try again.` }, { status: 400 });
    const name = String(body.name ?? "template.docx");
    // any file is kept as the template; a workbook, a Word file or a PDF is also read and filled
    let inspection: TemplateInspection = { placeholders: [], labels: [], unmatched: t.fields.map((f) => f.key) };
    try {
      if (/\.pdf$/i.test(name)) inspection = await inspectPdfTemplate(bytes, t);
      else if (isExcelTemplate(name)) inspection = await inspectExcelTemplate(bytes, t);
      else if (/\.(docx|dotx|docm)$/i.test(name)) inspection = await inspectTemplate(bytes, t);
    } catch {
      return NextResponse.json({ error: `The file could not be read as ${/\.pdf$/i.test(name) ? "a PDF" : isExcelTemplate(name) ? "an Excel workbook" : "a Word document"}.` }, { status: 400 });
    }
    const template = saveTemplate(t.key, { name, bytes, mime: String(body.mime ?? ""), inspection }, user);
    return NextResponse.json({ template, inspection }, { status: 201 });
  })(req, ctx);
}
