import { NextResponse } from "next/server";
import { withHeavyLock } from "@/lib/workbook/heavy";
import { withUser, readJson } from "@/lib/api";
import { ValidationError } from "@/lib/registers/engine";
import { getAppContext } from "@/lib/context";
import { getDb, getSetting } from "@/lib/db";
import { todayIso } from "@/lib/format";
import { listSources, loadSource, defaultColumns } from "@/lib/report-builder/sources";
import { STANDARD_REPORTS, standardSpec } from "@/lib/report-builder/standard";
import { buildReport, type BuildContext } from "@/lib/report-builder/build";
import { renderBuilderPdf } from "@/lib/report-builder/pdf";
import { renderBuilderExcel } from "@/lib/report-builder/excel";
import { renderBuilderWord } from "@/lib/report-builder/word";
import { applyPreset } from "@/lib/report-builder/presets";
import { emptySpec, type ReportSpec } from "@/lib/report-builder/types";

/**
 * "Customise my reports": GET lists the sources, or one source's fields; POST builds the report and
 * returns either the preview as JSON or the finished PDF, Excel or Word file.
 */

function context(): BuildContext {
  const app = getAppContext();
  if (!app.programme) throw new ValidationError("Select a project in the top bar first.");
  const db = getDb();
  const assetId = getSetting(db, "current_asset_id");
  const asset = assetId ? (db.prepare("SELECT code, name FROM assets WHERE id = ? AND programme_id = ?").get(Number(assetId), app.programme.id) as { code: string; name: string } | undefined) : undefined;
  return {
    programmeId: app.programme.id,
    programmeName: app.programme.name,
    programmeCode: app.programme.code,
    assetName: asset ? `${asset.code} ${asset.name}` : null,
    periodLabel: app.period?.label ?? "No reporting period selected",
    periodEnd: app.period?.period_end ?? todayIso(),
    locked: app.period?.status === "Locked",
  };
}

/** GET → the catalogue; GET ?source=bonds → that source's fields, presets and record count. */
export async function GET(req: Request, ctx: unknown) {
  return withUser(async () => {
    const source = new URL(req.url).searchParams.get("source");
    if (!source) {
      const bctx = context();
      return NextResponse.json({
        sources: listSources(),
        // the ready-made reports, and the month they should default to
        standard: STANDARD_REPORTS.map((r) => ({ id: r.id, group: r.group, title: r.title, description: r.description, source: r.source, needs: r.needs })),
        periodEnd: bctx.periodEnd,
        periodLabel: bctx.periodLabel,
      });
    }
    const bctx = context();
    const { info, rows } = loadSource(source, bctx.programmeId);
    return NextResponse.json({
      info: { ...info, count: rows.length },
      defaultColumns: defaultColumns(info.fields),
      context: { periodLabel: bctx.periodLabel, periodEnd: bctx.periodEnd, locked: bctx.locked, programme: `${bctx.programmeCode} ${bctx.programmeName}`, asset: bctx.assetName },
    });
  })(req, ctx);
}

async function heavyPOST(req: Request, ctx: unknown) {
  return withUser(async () => {
    const body = await readJson(req);
    const format = String(body.format ?? "preview");
    const bctx = context();
    // A ready-made report can be asked for by name ({ standard: "dvo_pending" }) as well as by spec,
    // so the same report comes out of the page, an email and a check with the filters already on it -
    // there is only one definition of "DVO pending" and every route goes through it.
    const named = body.standard ? STANDARD_REPORTS.find((r) => r.id === String(body.standard)) : undefined;
    if (body.standard && !named) throw new ValidationError(`There is no standard report called "${String(body.standard)}".`);
    const incoming = (body.spec ?? (named ? standardSpec(named, bctx.periodEnd) : {})) as Partial<ReportSpec>;
    const spec: ReportSpec = { ...emptySpec(String(incoming.source ?? body.source ?? "")), ...incoming } as ReportSpec;
    if (!spec.source) throw new ValidationError("Choose a report to build.");
    if (body.preset) applyPreset(spec, String(body.preset));

    const report = buildReport(spec, bctx);
    const base = `${report.title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}_${bctx.programmeCode}_${todayIso()}`;

    if (format === "pdf") {
      const buf = await renderBuilderPdf(report);
      return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` } });
    }
    if (format === "xlsx") {
      const buf = await renderBuilderExcel(report);
      return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` } });
    }
    if (format === "docx") {
      const buf = await renderBuilderWord(report);
      return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${base}.docx"` } });
    }
    // preview: the same report, trimmed so the page stays quick
    return NextResponse.json({
      ...report,
      rows: report.rows.slice(0, 200),
      groups: report.groups?.map((g) => ({ ...g, rows: g.rows.slice(0, 50) })) ?? null,
      previewTrimmed: report.rows.length > 200,
      spec,
    });
  })(req, ctx);
}

export const POST: typeof heavyPOST = (...args) => withHeavyLock(() => heavyPOST(...args));
