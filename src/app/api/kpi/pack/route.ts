import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { withHeavyLock } from "@/lib/workbook/heavy";
import { getAppContext } from "@/lib/context";
import { nowIso } from "@/lib/format";
import { loadKpi } from "@/lib/kpi/load";
import { defaultPackName } from "@/lib/kpi/model";
import { buildKpiPack, packFileName } from "@/lib/kpi/pack";
import { listKpiDocs, listKpiItemDetails, readKpiDocBytes } from "@/lib/kpi/store";

/** GET /api/kpi/pack?change=ID&period=ID – the supporting-document pack of one KPI entry, as a PDF. */
async function heavyGET(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const app = getAppContext();
    if (!app.programme) return NextResponse.json({ error: "Select a project in the top bar first." }, { status: 400 });
    const url = new URL(req.url);
    const changeId = Number(url.searchParams.get("change") || 0);
    const periodId = Number(url.searchParams.get("period") || app.period?.id || 0);
    if (!changeId || !periodId) return NextResponse.json({ error: "Which entry and which report were not given." }, { status: 400 });
    const { data, kpi } = loadKpi(app.programme.id, periodId);
    const item = kpi.items.find((i) => i.changeId === changeId);
    if (!item) return NextResponse.json({ error: "That change is not a KPI entry on this report." }, { status: 404 });
    const details = listKpiItemDetails([changeId]).get(changeId);
    const docs = listKpiDocs([changeId]).map((doc) => ({ doc, bytes: readKpiDocBytes(doc) }));
    const fileBase = details?.file_name?.trim() || defaultPackName(item, details?.sn ?? "");
    const pdf = await buildKpiPack({ item, sn: details?.sn ?? "", fileName: fileBase, rootCause: details?.root_cause ?? "", programme: { code: data.programme.code, name: data.programme.name }, periodLabel: data.period.label, docs, generatedAt: nowIso(), by: user.name });
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${packFileName(fileBase).replace(/["\\]/g, "_")}"` } });
  })(req, ctx);
}

export const GET: typeof heavyGET = (...args) => withHeavyLock(() => heavyGET(...args));
