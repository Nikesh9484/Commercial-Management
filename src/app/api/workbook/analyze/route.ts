import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { analyzeWorkbook } from "@/lib/workbook/analyze";
import { storeUpload, appendUploadPart, finishUploadParts } from "@/lib/workbook/import";

export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (user.role === "viewer") throw new AuthError("Viewers cannot import.");
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
    const analysis = await analyzeWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, name || "workbook.xlsx", fileId);
    return NextResponse.json(analysis);
  })(req, ctx);
}
