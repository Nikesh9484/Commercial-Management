import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { addSlot, getCase, rebuildValues, removeCase, updateCase } from "@/lib/packs/store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH { revision?, status?, file_name? } – the pack's workflow state and output name.
 * PATCH { refresh: true } – reads every value again from the register item and the uploaded files.
 * PATCH { add_slot: true } – one more "Other attachment" slot.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { id } = await params;
    const cur = getCase(Number(id));
    if (!cur) return NextResponse.json({ error: "That pack is no longer here." }, { status: 404 });
    const body = await readJson(req);
    if (body.add_slot) return NextResponse.json({ case: addSlot(cur.id, user) });
    if (body.refresh) {
      const { sources } = await rebuildValues(cur.id, user);
      return NextResponse.json({ case: getCase(cur.id), refreshed: Object.keys(sources).length });
    }
    const c = updateCase(cur.id, { revision: typeof body.revision === "string" ? body.revision : undefined, status: typeof body.status === "string" ? body.status : undefined, file_name: typeof body.file_name === "string" ? body.file_name : undefined }, user);
    return NextResponse.json({ case: c });
  })(req, ctx);
}

export const DELETE = withUser<Ctx>(async (user, { params }) => {
  const { id } = await params;
  if (!getCase(Number(id))) return NextResponse.json({ error: "That pack is no longer here." }, { status: 404 });
  removeCase(Number(id), user);
  return NextResponse.json({ ok: true });
});
