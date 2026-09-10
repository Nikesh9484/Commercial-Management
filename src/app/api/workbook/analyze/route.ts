import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { analyzeWorkbook } from "@/lib/workbook/analyze";
import { storeUpload, uploadPath, appendUploadPart, finishUploadParts, saveConverted } from "@/lib/workbook/import";
import { readWorkbookValues } from "@/lib/workbook/read";
import { looksLikeMarinaReport, convertMarinaReport, toSheetValues } from "@/lib/workbook/marina";
import { looksLikeClaimsTracker, convertClaimsTracker, codeFrag, type KnownLine } from "@/lib/workbook/claims-tracker";
import { getAppContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getRegisterDef } from "@/lib/registers";
import { listRecords } from "@/lib/registers/engine";

export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (user.role !== "admin" && user.role !== "editor") throw new AuthError("Only Editors and Admins can import a workbook.");
    let name = "";
    let bytes: Buffer;
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      // the app sends the file in base64 pieces so company web filters do not cut it short
      const body = (await req.json()) as { uploadId?: string; name?: string; size?: number; index?: number; count?: number; data?: string };
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
    if (name && !name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Only .xlsx files are supported. In Excel use Save As → Excel Workbook (.xlsx)." }, { status: 400 });
    // .xlsx files are zip archives and start with "PK"
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return NextResponse.json({ error: "This does not look like an .xlsx workbook. In Excel use Save As → Excel Workbook (.xlsx)." }, { status: 400 });
    const fileId = storeUpload(bytes);
    bytes = Buffer.alloc(0); // let the copy go before parsing
    let worksheets = await readWorkbookValues(uploadPath(fileId));
    let conversion: { notes: string[]; reportNo: number | null; periodEnd: string | null } | undefined;
    if (looksLikeMarinaReport(worksheets)) {
      // The Marina CM Report layout: convert the schedules into clean register sheets first.
      const conv = convertMarinaReport(worksheets);
      worksheets = toSheetValues(conv);
      saveConverted(fileId, worksheets);
      conversion = { notes: conv.notes, reportNo: conv.reportNo, periodEnd: conv.periodEnd };
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
    }
    const analysis = { ...analyzeWorkbook(worksheets, name || "workbook.xlsx", fileId), conversion };
    return NextResponse.json(analysis);
  })(req, ctx);
}
