import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { setChecklistItem } from "@/lib/checklist";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { id } = await params;
    const body = await readJson(req);
    const item = setChecklistItem(Number(id), { done: typeof body.done === "boolean" ? body.done : undefined, comment: "comment" in body ? (body.comment as string | null) : undefined }, user);
    return NextResponse.json({ item });
  })(req, ctx);
}
