import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { requireDef, assertCanEdit } from "@/lib/registers/engine";
import { importRegister } from "@/lib/excel";

type Ctx = { params: Promise<{ key: string }> };

export async function POST(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { key } = await params;
    const def = requireDef(key);
    assertCanEdit(def, user);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose an Excel (.xlsx) file to import." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Only .xlsx files are supported (save as Excel Workbook)." }, { status: 400 });
    const result = await importRegister(def, await file.arrayBuffer(), user);
    return NextResponse.json(result);
  })(req, ctx);
}
