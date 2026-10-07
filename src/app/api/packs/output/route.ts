import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { withHeavyLock } from "@/lib/workbook/heavy";
import { renderOutput, renderPackDocument, type OutputFormat } from "@/lib/packs/output";
import type { DocFormat } from "@/lib/packs/documents";
import { getCase, rebuildValues } from "@/lib/packs/store";

/**
 * GET /api/packs/output?case=ID&format=docx|xlsx|pdf|pack – the Word form, the Excel form, the PDF form or the compiled pack of one document.
 * With &doc=<id> (letter, vo_form, appendix01, summary, basis, assessment, budget, contract_summary, change_log) one document of the pack on its own, in that file type.
 */
async function heavyGET(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const url = new URL(req.url);
    let c = getCase(Number(url.searchParams.get("case") || 0));
    if (!c) return NextResponse.json({ error: "That pack is no longer here." }, { status: 404 });
    // every value is read again at output time: the register, the template and the files as they are today
    try {
      await rebuildValues(c.id, user);
      c = getCase(c.id) ?? c;
    } catch (e) {
      console.error("pack values not refreshed:", e instanceof Error ? e.message : e);
    }
    const format = String(url.searchParams.get("format") || "pdf") as OutputFormat;
    if (!["docx", "xlsx", "pdf", "pack"].includes(format)) return NextResponse.json({ error: "Unknown format." }, { status: 400 });
    const doc = String(url.searchParams.get("doc") || "");
    if (doc && format === "pack") return NextResponse.json({ error: "A single document comes as PDF, Word or Excel." }, { status: 400 });
    const out = doc ? await renderPackDocument(c, doc, format as DocFormat, user) : await renderOutput(c, format, user);
    // the header takes Latin-1 only: an ASCII name for old browsers, the real one RFC 5987-encoded
    const ascii = out.fileName.replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Uint8Array(out.bytes), { headers: { "Content-Type": out.mime, "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.fileName)}`, "X-Pack-Note": out.note.replace(/[^\x20-\x7E]/g, "?") } });
  })(req, ctx);
}

export const GET: typeof heavyGET = (...args) => withHeavyLock(() => heavyGET(...args));
