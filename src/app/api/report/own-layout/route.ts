import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { withHeavyLock } from "@/lib/workbook/heavy";
import fs from "node:fs";
import { appendUploadPart, finishUploadParts, uploadPath } from "@/lib/workbook/import";
import { renderOwnLayout } from "@/lib/report/own-layout";
import { getReportTemplate, saveReportTemplate } from "@/lib/report/own-layout/templates";

/** GET /api/report/own-layout?period=ID – the month's report written into the project's own report workbook. */
async function heavyGET(req: Request, ctx: unknown) {
  return withUser(async () => {
    const app = getAppContext();
    if (!app.programme) return NextResponse.json({ error: "Select a project in the top bar first." }, { status: 400 });
    const url = new URL(req.url);
    const periodId = Number(url.searchParams.get("period") || 0) || null;
    const out = await renderOwnLayout(app.programme.id, periodId);
    const ascii = out.fileName.replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Uint8Array(out.bytes), {
      headers: {
        "Content-Type": out.fileName.endsWith(".xlsm") ? "application/vnd.ms-excel.sheet.macroEnabled.12" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.fileName)}`,
        "X-Report-Notes": out.notes.join(" | ").replace(/[^\x20-\x7E]/g, "?").slice(0, 2000),
      },
    });
  })(req, ctx);
}
export const GET: typeof heavyGET = (...args) => withHeavyLock(() => heavyGET(...args));

/** POST { uploadId?, name, index, count, data } – the project's report workbook kept as the template (base64 pieces); Admin and editors. */
export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (!["admin", "editor"].includes(user.role)) return NextResponse.json({ error: "Only an Admin or an editor can change the report template." }, { status: 403 });
    const app = getAppContext();
    if (!app.programme) return NextResponse.json({ error: "Select a project in the top bar first." }, { status: 400 });
    const body = (await req.json().catch(() => ({}))) as { uploadId?: string; name?: string; index?: number; count?: number; data?: string; fileId?: string };
    // a workbook already uploaded for import (a locked month's report, skipped by the import) kept as the template
    if (body.fileId) {
      const file = uploadPath(String(body.fileId));
      if (!fs.existsSync(file)) return NextResponse.json({ error: "The uploaded workbook is no longer on the server – upload it again." }, { status: 404 });
      const t = saveReportTemplate(app.programme.id, String(body.name ?? "report.xlsx"), fs.readFileSync(file), user);
      return NextResponse.json({ template: { name: t.name, size: t.size, uploaded_at: t.uploaded_at, uploaded_by: t.uploaded_by } });
    }
    const uploadId = appendUploadPart(body.uploadId || null, Buffer.from(String(body.data ?? ""), "base64"));
    if ((body.index ?? 0) < (body.count ?? 1) - 1) return NextResponse.json({ uploadId });
    const bytes = finishUploadParts(uploadId);
    const t = saveReportTemplate(app.programme.id, String(body.name ?? "report.xlsx"), bytes, user);
    return NextResponse.json({ template: { name: t.name, size: t.size, uploaded_at: t.uploaded_at, uploaded_by: t.uploaded_by } });
  })(req, ctx);
}

/** The template kept for the project in the top bar. */
export async function HEAD() {
  const app = getAppContext();
  const t = app.programme ? getReportTemplate(app.programme.id) : null;
  return new Response(null, { status: t ? 200 : 404 });
}
