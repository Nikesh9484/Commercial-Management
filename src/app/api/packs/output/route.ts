import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { withHeavyLock } from "@/lib/workbook/heavy";
import { renderOutput, type OutputFormat } from "@/lib/packs/output";
import { getCase } from "@/lib/packs/store";

/** GET /api/packs/output?case=ID&format=docx|pdf|pack – the Word form, the PDF form or the compiled pack of one document. */
async function heavyGET(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const url = new URL(req.url);
    const c = getCase(Number(url.searchParams.get("case") || 0));
    if (!c) return NextResponse.json({ error: "That pack is no longer here." }, { status: 404 });
    const format = String(url.searchParams.get("format") || "pdf") as OutputFormat;
    if (!["docx", "pdf", "pack"].includes(format)) return NextResponse.json({ error: "Unknown format." }, { status: 400 });
    const out = await renderOutput(c, format, user);
    // the header takes Latin-1 only: an ASCII name for old browsers, the real one RFC 5987-encoded
    const ascii = out.fileName.replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Uint8Array(out.bytes), { headers: { "Content-Type": out.mime, "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.fileName)}`, "X-Pack-Note": out.note.replace(/[^\x20-\x7E]/g, "?") } });
  })(req, ctx);
}

export const GET: typeof heavyGET = (...args) => withHeavyLock(() => heavyGET(...args));
