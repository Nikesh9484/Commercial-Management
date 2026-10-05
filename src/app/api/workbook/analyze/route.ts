import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { analyzeWorkbook, type WorkbookAnalysis } from "@/lib/workbook/analyze";
import { storeUpload, uploadPath, appendUploadPart, finishUploadParts, saveConverted } from "@/lib/workbook/import";
import { readWorkbookValues, readWorkbookPreview } from "@/lib/workbook/read";
import { withHeavyLock, releaseMemory } from "@/lib/workbook/heavy";
import { looksLikeMarinaReport, convertMarinaReport, toSheetValues } from "@/lib/workbook/marina";
import { looksLikeVbhReport, convertVbhReport } from "@/lib/workbook/vbh";
import { looksLikeClaimsTracker, convertClaimsTracker } from "@/lib/workbook/claims-tracker";
import { looksLikeAccommodationTracker, looksLikeCustomsTracker, convertRecoveryTrackers, trackerReadPlan } from "@/lib/workbook/recovery";
import { recoveryContextsFor, aconexContextFor, claimsContextsFor } from "@/lib/recovery/contexts";
import { keepTrackerUpload } from "@/lib/repairs/recovery-trackers";
import { csvToSheets, looksLikeAconexExport, convertAconexExport, looksLikeAconexChangeEvents, convertAconexChangeEvents } from "@/lib/workbook/aconex";
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
    // a quick look at the first rows first: a cost-recovery tracker is then read without its pivot and ranking sheets
    const plan = csvText !== null ? null : trackerReadPlan(await readWorkbookPreview(uploadPath(fileId)));
    let worksheets = csvText !== null ? csvToSheets(csvText, name || "export.csv") : await readWorkbookValues(uploadPath(fileId), plan ?? {});
    let conversion: WorkbookAnalysis["conversion"];
    // the stand-alone trackers name their project on the import page; everything else follows the top bar
    const programmeFor = () => {
      const app = getAppContext();
      const picked = chosenProgramme ? app.programmes.find((p) => p.id === chosenProgramme) : undefined;
      return picked ?? app.programme;
    };
    if (looksLikeAconexExport(worksheets) || looksLikeAconexChangeEvents(worksheets)) {
      // The Aconex control account export: our project's contracts and budget holds, tied to the cost lines by contract code.
      // The Aconex change-event export: the project's PVOs, budget transfers, RFCs and adjustments, tied the same way.
      const changeEvents = !looksLikeAconexExport(worksheets);
      const programme = programmeFor();
      if (!programme) return NextResponse.json({ error: "Select a programme in the top bar first." }, { status: 400 });
      const app = { programme };
      const db = getDb();
      const actx = aconexContextFor(db, app.programme, name);
      const conv = changeEvents ? convertAconexChangeEvents(worksheets, actx) : convertAconexExport(worksheets, actx);
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
      // The AMAALA Claims Tracker is one file for every project: each project's claims are picked out
      // by contract number or asset code, linked to that project's cost lines (the main contract line –
      // the one with the largest budget – when a contract has several), and filed under that project.
      const db = getDb();
      // the file is kept, so a project set up later (or a fresh start) is filled from it without a new upload
      keepTrackerUpload("claims", uploadPath(fileId), name);
      const ctxs = claimsContextsFor(db, getAppContext().programmes);
      const conv = convertClaimsTracker(worksheets, ctxs);
      worksheets = toSheetValues(conv);
      saveConverted(fileId, worksheets);
      conversion = { notes: conv.notes, reportNo: null, periodEnd: null };
    } else if (looksLikeAccommodationTracker(worksheets) || looksLikeCustomsTracker(worksheets)) {
      // The cost-recovery trackers (accommodation invoices, customs duties) are one AMAALA-wide file:
      // every project's rows are picked out with that project's contractors and cost report lines,
      // and each row is filed under its own project.
      const db = getDb();
      const kind = looksLikeAccommodationTracker(worksheets) ? "accommodation" : "customs";
      // the file is kept, so a project set up later (or on a fresh start) is filled from it without a new upload
      keepTrackerUpload(kind, uploadPath(fileId), name);
      const ctxs = recoveryContextsFor(db, getAppContext().programmes, name);
      const conv = convertRecoveryTrackers(worksheets, ctxs, kind);
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
