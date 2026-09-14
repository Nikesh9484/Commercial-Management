import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { appendUploadPart, finishUploadParts } from "@/lib/workbook/import";
import { extractText } from "@/lib/ear/extract";
import { addDoc, assertLibrary, canManageLibrary, getDoc, listDocs, removeDoc, LIBRARY_MAX_FILE_BYTES } from "@/lib/library/store";
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

/**
 * Removes several documents at once – the whole of one contract, from the library page. It is one
 * request rather than one per document so clearing out a folder that was picked by mistake does not
 * mean hundreds of round trips. Each document is still removed and logged one by one, so the change
 * history shows exactly what went.
 */
export async function DELETE(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    if (!canManageLibrary(user)) throw new AuthError("Only Editors and Admins can remove documents from a library.");
    const { library } = await params;
    const key = assertLibrary(library);
    const app = getAppContext();
    if (!app.programme) return NextResponse.json({ error: "Select a project in the top bar first." }, { status: 400 });
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (!ids.length) return NextResponse.json({ error: "No documents were given to remove." }, { status: 400 });
    const removed: number[] = [];
    for (const id of ids) {
      // a document only goes if it really belongs to this library and this project
      const doc = getDoc(id);
      if (!doc || doc.library !== key || doc.programme_id !== app.programme.id) continue;
      removeDoc(id, user);
      removed.push(id);
    }
    return NextResponse.json({ removed, skipped: ids.length - removed.length });
  })(req, ctx);
}
