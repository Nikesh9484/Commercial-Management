import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { getKpiDoc, removeKpiDoc, updateKpiDoc } from "@/lib/kpi/store";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { section?, sort_order?, pages? } – moves a document to another part of the pack or changes the pages it contributes. */
export async function PATCH(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { id } = await params;
    const body = await readJson(req);
    const doc = updateKpiDoc(Number(id), { section: typeof body.section === "string" ? body.section : undefined, sort_order: typeof body.sort_order === "number" ? body.sort_order : undefined, pages: typeof body.pages === "string" ? body.pages : undefined }, user);
    return NextResponse.json({ doc });
  })(req, ctx);
}

export const DELETE = withUser<Ctx>(async (user, { params }) => {
  const { id } = await params;
  if (!getKpiDoc(Number(id))) return NextResponse.json({ error: "That document is no longer here." }, { status: 404 });
  removeKpiDoc(Number(id), user);
  return NextResponse.json({ ok: true });
});
