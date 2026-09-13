import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { appendUploadPart, finishUploadParts } from "@/lib/workbook/import";
import { extractText } from "@/lib/ear/extract";
import { addDoc, assertLibrary, canManageLibrary, listDocs, LIBRARY_MAX_FILE_BYTES } from "@/lib/library/store";
import { readDocument, readerConfigured } from "@/lib/library/read";

type Ctx = { params: Promise<{ library: string }> };

/** GET ?contractor_id=&contract_id=&doc_type=&q= – the documents of this library for the current project. */
export const GET = withUser<Ctx>(async (_user, { params }) => {
  const { library } = await params;
  const key = assertLibrary(library);
  const ctx = getAppContext();
  if (!ctx.programme) return NextResponse.json({ docs: [], engine: readerConfigured() });
  // filters come from the page, parsed there; this endpoint returns everything for the project
  return NextResponse.json({ docs: listDocs(ctx.programme.id, key), engine: readerConfigured() });
});

/**
 * Adds one document. The browser sends it in base64 pieces, like the workbook import, so company
 * web filters do not cut large binary uploads short: { uploadId, name, relPath, mime, size, index, count, data }.
 * When the last piece arrives the text is extracted, the document is read and filed, and the row returned.
 */
export async function POST(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    if (!canManageLibrary(user)) throw new AuthError("Only Editors and Admins can add documents to a library.");
    const { library } = await params;
    const key = assertLibrary(library);
    const app = getAppContext();
    if (!app.programme) return NextResponse.json({ error: "Select a project in the top bar first." }, { status: 400 });
    const body = (await req.json().catch(() => ({}))) as { uploadId?: string; name?: string; relPath?: string; mime?: string; size?: number; index?: number; count?: number; data?: string };
    const part = Buffer.from(body.data ?? "", "base64");
    if (typeof body.size === "number" && body.size > LIBRARY_MAX_FILE_BYTES) return NextResponse.json({ error: `${body.name ?? "This file"} is larger than ${Math.round(LIBRARY_MAX_FILE_BYTES / 1024 / 1024)} MB.` }, { status: 400 });
    const uploadId = appendUploadPart(body.uploadId || null, part);
    if ((body.index ?? 0) < (body.count ?? 1) - 1) return NextResponse.json({ uploadId });
    const bytes = finishUploadParts(uploadId);
    if (typeof body.size === "number" && bytes.length !== body.size) {
      return NextResponse.json({ error: `The upload of ${body.name ?? "the file"} arrived incomplete (${bytes.length.toLocaleString()} of ${body.size.toLocaleString()} bytes). Please try again.` }, { status: 400 });
    }
    const name = String(body.name ?? "file");
    const extracted = await extractText(name, bytes, String(body.mime ?? ""));
    const reading = await readDocument(app.programme.id, key, name, extracted.text);
    const doc = addDoc(app.programme.id, key, { name, relPath: body.relPath, bytes, mime: String(body.mime ?? "") }, extracted, reading, user);
    return NextResponse.json({ doc }, { status: 201 });
  })(req, ctx);
}
