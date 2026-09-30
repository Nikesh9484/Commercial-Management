import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { analyzeWorkbook, type WorkbookAnalysis } from "@/lib/workbook/analyze";
import { storeUpload, uploadPath, appendUploadPart, finishUploadParts, saveConverted } from "@/lib/workbook/import";
import { readWorkbookValues } from "@/lib/workbook/read";
import { withHeavyLock, releaseMemory } from "@/lib/workbook/heavy";
import { looksLikeMarinaReport, convertMarinaReport, toSheetValues } from "@/lib/workbook/marina";
import { looksLikeVbhReport, convertVbhReport } from "@/lib/workbook/vbh";
import { looksLikeClaimsTracker, convertClaimsTracker, codeFrag, type KnownLine } from "@/lib/workbook/claims-tracker";
import { looksLikeAccommodationTracker, convertAccommodationTracker, looksLikeCustomsTracker, convertCustomsTracker, type RecoveryContext } from "@/lib/workbook/recovery";
import { csvToSheets, looksLikeAconexExport, convertAconexExport } from "@/lib/workbook/aconex";
import { todayIso } from "@/lib/format";
import { getAppContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getRegisterDef } from "@/lib/registers";
import { listRecords } from "@/lib/registers/engine";

export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (user.role !== "admin" && user.role !== "editor") throw new AuthError("Only Editors and Admins can import a workbook.");
    let name = "";
    let bytes: Buffer;
    let chosenProgramme: number | null = null;
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      // the app sends the file in base64 pieces so company web filters do not cut it short
      const body = (await req.json()) as { uploadId?: string; name?: string; size?: number; index?: number; count?: number; data?: string; programmeId?: number };
      if (body.programmeId) chosenProgramme = Number(body.programmeId);
      const part = Buffer.from(body.data ?? "", "base64");
      const id = appendUploadPart(body.uploadId || null, part);
      if ((body.index ?? 0) < (body.count ?? 1) - 1) return NextResponse.json({ uploadId: id });
      name = body.name ?? "";
      bytes = finishUploadParts(id);
      if (typeof body.size === "number" && bytes.length !== body.size) {
        return NextResponse.json(
          { error: `The upload arrived incomplete: the server received ${bytes.length.toLocaleString()} of ${body.size.toLocaleString()} bytes. Your network is cutting the upload short; please try again, or use your phone or another network.` },
          { status: 400 },
        );
      }
    } else if (type.startsWith("multipart/form-data")) {
      // older clients / curl: a normal form upload
      let file: FormDataEntryValue | null = null;
      try {
        file = (await req.formData()).get("file");
      } catch (e) {
        return NextResponse.json({ error: `The upload could not be read (${e instanceof Error ? e.message : String(e)}). Please reload the page and try again.` }, { status: 400 });
      }
      if (!(file instanceof File)) return NextResponse.json({ error: "Choose an Excel (.xlsx) file." }, { status: 400 });
      name = file.name;
      bytes = Buffer.from(await file.arrayBuffer());
    } else {
      // the app sends the raw file bytes with the name in a header
      try {
        name = decodeURIComponent(req.headers.get("x-file-name") ?? "");
      } catch {
        name = req.headers.get("x-file-name") ?? "";
      }
      bytes = Buffer.from(await req.arrayBuffer());
    }
    if (!bytes.length) return NextResponse.json({ error: "The uploaded file is empty. Choose an Excel (.xlsx) file." }, { status: 400 });
    const isCsv = /\.csv$/i.test(name) || (!/\.xls[xm]$/i.test(name) && !(bytes[0] === 0x50 && bytes[1] === 0x4b) && /^[﻿"A-Za-z]/.test(bytes.subarray(0, 3).toString("utf8")));
    if (name && !/\.xls[xm]$/i.test(name) && !isCsv) return NextResponse.json({ error: "Only .xlsx, .xlsm and .csv files are supported. In Excel use Save As → Excel Workbook (.xlsx)." }, { status: 400 });
    // .xlsx / .xlsm files are zip archives and start with "PK"
    if (!isCsv && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) return NextResponse.json({ error: "This does not look like an Excel workbook. In Excel use Save As → Excel Workbook (.xlsx)." }, { status: 400 });
    const fileId = storeUpload(bytes);
    const csvText = isCsv ? bytes.toString("utf8") : null;
    bytes = Buffer.alloc(0); // let the copy go before parsing
    return withHeavyLock(async () => {
    releaseMemory();
    let worksheets = csvText !== null ? csvToSheets(csvText, name || "export.csv") : await readWorkbookValues(uploadPath(fileId));
    let conversion: WorkbookAnalysis["conversion"];
    // the stand-alone trackers name their project on the import page; everything else follows the top bar
    const programmeFor = () => {
      const app = getAppContext();
      const picked = chosenProgramme ? app.programmes.find((p) => p.id === chosenProgramme) : undefined;
      return picked ?? app.programme;
    };
    if (looksLikeAconexExport(worksheets)) {
      // The Aconex control account export: our project's contracts and budget holds, tied to the cost lines by contract code.
      const programme = programmeFor();
      if (!programme) return NextResponse.json({ error: "Select a programme in the top bar first." }, { status: 400 });
      const app = { programme };
      const db = getDb();
      const linesByFrag = new Map<string, { code: string; contractor: string }>();
      const holdLinesByKey = new Map<string, string>();
      const lines = db
        .prepare("SELECT l.code, l.is_budget_hold, a.code AS asset, c.name AS contractor FROM cost_lines l JOIN assets a ON a.id = l.asset_id LEFT JOIN contractors c ON c.id = l.contractor_id WHERE l.programme_id = ? ORDER BY COALESCE(l.approved_baseline_budget, 0) + COALESCE(l.opening_transfers, 0) DESC, l.sort_order, l.code")
        .all(app.programme.id) as { code: string; is_budget_hold: number | null; asset: string; contractor: string | null }[];
      for (const l of lines) {
        if (l.is_budget_hold) {
          // "01.PS.98" / "PS.98" under asset 1TB01006.01 → "1TB01006.01.PS"
          const m = String(l.code).match(/([A-Z&\s]+)\.98$/i);
          if (m) holdLinesByKey.set(`${l.asset}.${m[1].replace(/[^A-Z]/gi, "").toUpperCase()}`, l.code);
          continue;
        }
        const frag = codeFrag(l.code);
        if (frag && !linesByFrag.has(frag)) linesByFrag.set(frag, { code: l.code, contractor: l.contractor ?? "" });
      }
      const conv = convertAconexExport(worksheets, { programmeCode: app.programme.code, programmeName: app.programme.name, linesByFrag, holdLinesByKey, fileName: name, today: todayIso() });
      worksheets = toSheetValues(conv);
      saveConverted(fileId, worksheets);
      conversion = { notes: conv.notes, reportNo: null, periodEnd: null };
    } else if (looksLikeMarinaReport(worksheets)) {
      // The Marina CM Report layout: convert the schedules into clean register sheets first.
      const conv = convertMarinaReport(worksheets);
      worksheets = toSheetValues(conv);
      saveConverted(fileId, worksheets);
      conversion = { notes: conv.notes, reportNo: conv.reportNo, periodEnd: conv.periodEnd, level1: conv.level1 ?? null, control: conv.control ?? null };
    } else if (looksLikeVbhReport(worksheets)) {
      // The VBH Commercial Report layout (SCHD A–G + DATA): same idea, its own converter.
      const conv = convertVbhReport(worksheets);
      worksheets = toSheetValues(conv);
      saveConverted(fileId, worksheets);
      conversion = { notes: conv.notes, reportNo: conv.reportNo, periodEnd: conv.periodEnd, level1: conv.level1 ?? null, control: conv.control ?? null };
    } else if (looksLikeClaimsTracker(worksheets)) {
      // The AMAALA Claims Tracker: keep our programme's claims and link them to our cost lines
      // (the main contract line – the one with the largest budget – when a contract has several lines).
      const app = getAppContext();
      if (!app.programme) return NextResponse.json({ error: "Select a programme in the top bar first." }, { status: 400 });
      const db = getDb();
      const linesByFrag = new Map<string, KnownLine>();
      const lines = db
        .prepare("SELECT l.code, p.name AS package, c.name AS contractor FROM cost_lines l LEFT JOIN packages p ON p.id = l.package_id LEFT JOIN contractors c ON c.id = l.contractor_id WHERE l.programme_id = ? AND l.is_budget_hold IS NOT 1 ORDER BY COALESCE(l.approved_baseline_budget, 0) + COALESCE(l.opening_transfers, 0) DESC, l.sort_order, l.code")
        .all(app.programme.id) as { code: string; package: string | null; contractor: string | null }[];
      for (const l of lines) {
        const frag = codeFrag(l.code);
        if (frag && !linesByFrag.has(frag)) linesByFrag.set(frag, { code: l.code, package: l.package ?? "", contractor: l.contractor ?? "" });
      }
      const existingClaims = listRecords(getRegisterDef("claims")!).map((c) => ({ claim_no: String(c.claim_no), detail_letter_ref: c.detail_letter_ref as string | null, notice_letter_ref: c.notice_letter_ref as string | null, description: c.description as string | null }));
      const conv = convertClaimsTracker(worksheets, {
        programmeCode: app.programme.code,
        assetCode: app.asset?.code ?? app.programme.code,
        assetLabel: app.asset?.code ?? app.programme.code,
        linesByFrag,
        existingClaims,
      });
      worksheets = toSheetValues(conv);
      saveConverted(fileId, worksheets);
      conversion = { notes: conv.notes, reportNo: null, periodEnd: null };
    } else if (looksLikeAccommodationTracker(worksheets) || looksLikeCustomsTracker(worksheets)) {
      // The cost-recovery trackers (accommodation invoices, customs duties): keep our programme's rows
      // and tie each to our contractor and cost report line.
      const programme = programmeFor();
      if (!programme) return NextResponse.json({ error: "Select a programme in the top bar first." }, { status: 400 });
      const app = { programme };
      const db = getDb();
      const linesByFrag = new Map<string, { code: string; contractor: string }>();
      const contractors = new Map<number, { id: number; name: string; primary: boolean }>();
      const lines = db
        .prepare("SELECT l.code, l.contractor_id, c.name AS contractor FROM cost_lines l LEFT JOIN contractors c ON c.id = l.contractor_id WHERE l.programme_id = ? AND l.is_budget_hold IS NOT 1 ORDER BY COALESCE(l.approved_baseline_budget, 0) + COALESCE(l.opening_transfers, 0) DESC, l.sort_order, l.code")
        .all(app.programme.id) as { code: string; contractor_id: number | null; contractor: string | null }[];
      for (const l of lines) {
        const frag = codeFrag(l.code);
        if (frag && !linesByFrag.has(frag)) linesByFrag.set(frag, { code: l.code, contractor: l.contractor ?? "" });
        if (l.contractor_id && l.contractor) contractors.set(l.contractor_id, { id: l.contractor_id, name: l.contractor, primary: true });
      }
      for (const c of db.prepare("SELECT DISTINCT c.id, c.name FROM contractors c JOIN (SELECT contractor_id FROM bonds WHERE programme_id = ? UNION SELECT contractor_id FROM final_accounts WHERE programme_id = ? UNION SELECT contractor_id FROM early_warnings WHERE programme_id = ?) x ON x.contractor_id = c.id").all(app.programme.id, app.programme.id, app.programme.id) as { id: number; name: string }[]) if (!contractors.has(c.id)) contractors.set(c.id, { id: c.id, name: c.name, primary: false });
      const rctx: RecoveryContext = { programmeCode: app.programme.code, programmeName: app.programme.name, contractors: [...contractors.values()], linesByFrag, fileName: name };
      const conv = looksLikeAccommodationTracker(worksheets) ? convertAccommodationTracker(worksheets, rctx) : convertCustomsTracker(worksheets, rctx);
      worksheets = toSheetValues(conv);
      saveConverted(fileId, worksheets);
      conversion = { notes: conv.notes, reportNo: null, periodEnd: null };
    }
    const analysis = { ...analyzeWorkbook(worksheets, name || "workbook.xlsx", fileId), conversion };
    worksheets = [];
    return NextResponse.json(analysis);
    });
  })(req, ctx);
}
