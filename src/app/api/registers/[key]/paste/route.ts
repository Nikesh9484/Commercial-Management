import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { requireDef, assertCanCreate } from "@/lib/registers/engine";
import { pasteRows } from "@/lib/registers/paste";

type Ctx = { params: Promise<{ key: string }> };

/** Adds rows pasted from another tracker or from Excel (tab-separated text with a heading row). */
export async function POST(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { key } = await params;
    const def = requireDef(key);
    assertCanCreate(def, user);
    const body = (await req.json().catch(() => ({}))) as { text?: string; after?: string | null };
    const text = String(body.text ?? "");
    if (!text.trim()) return NextResponse.json({ error: "Nothing was pasted." }, { status: 400 });
    if (text.length > 2_000_000) return NextResponse.json({ error: "That is too much text for one paste – paste it in parts." }, { status: 400 });
    return NextResponse.json(pasteRows(def, text, user, { after: body.after ? String(body.after).slice(0, 200) : null }));
  })(req, ctx);
}
