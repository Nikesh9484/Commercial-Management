import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { analyzeWorkbook } from "@/lib/workbook/analyze";
import { storeUpload } from "@/lib/workbook/import";

export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (user.role === "viewer") throw new AuthError("Viewers cannot import.");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose an Excel (.xlsx) file." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Only .xlsx files are supported. In Excel use Save As → Excel Workbook (.xlsx)." }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const fileId = storeUpload(bytes);
    const analysis = await analyzeWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, file.name, fileId);
    return NextResponse.json(analysis);
  })(req, ctx);
}
