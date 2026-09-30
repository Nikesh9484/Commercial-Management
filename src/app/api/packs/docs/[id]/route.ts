import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { getDoc, removeDocAndRebuild, updateDoc } from "@/lib/packs/store";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { slot?, sort_order?, pages? } – moves a document to another slot or changes the pages it contributes. */
export async function PATCH(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { id } = await params;
    const body = await readJson(req);
    const doc = updateDoc(Number(id), { slot: typeof body.slot === "string" ? body.slot : undefined, sort_order: typeof body.sort_order === "number" ? body.sort_order : undefined, pages: typeof body.pages === "string" ? body.pages : undefined }, user);
    return NextResponse.json({ doc });
  })(req, ctx);
}

export const DELETE = withUser<Ctx>(async (user, { params }) => {
  const { id } = await params;
  if (!getDoc(Number(id))) return NextResponse.json({ error: "That document is no longer here." }, { status: 404 });
  await removeDocAndRebuild(Number(id), user);
  return NextResponse.json({ ok: true });
});
