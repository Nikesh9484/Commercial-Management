import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { withHeavyLock } from "@/lib/workbook/heavy";
import { renderBondsTracker } from "@/lib/report/own-layout";

/** GET /api/bonds/tracker?period=ID – the Insurance tracker: the register written into the Bonds & insurance tab of the project's own report workbook, as a workbook of its own. */
async function heavyGET(req: Request, ctx: unknown) {
  return withUser(async () => {
    const app = getAppContext();
    if (!app.programme) return NextResponse.json({ error: "Select a project in the top bar first." }, { status: 400 });
    const url = new URL(req.url);
    const periodId = Number(url.searchParams.get("period") || 0) || app.period?.id || null;
    const out = await renderBondsTracker(app.programme.id, periodId);
    const ascii = out.fileName.replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Uint8Array(out.bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.fileName)}`,
        "X-Report-Notes": out.notes.join(" | ").replace(/[^\x20-\x7E]/g, "?").slice(0, 2000),
      },
    });
  })(req, ctx);
}
export const GET: typeof heavyGET = (...args) => withHeavyLock(() => heavyGET(...args));
