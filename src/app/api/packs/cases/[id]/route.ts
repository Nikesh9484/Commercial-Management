import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { autoValues } from "@/lib/packs/data";
import { caseValues, getCase, removeCase, updateCase } from "@/lib/packs/store";
import type { PackValues } from "@/lib/packs/shared";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH { ref?, title?, revision?, status?, file_name?, values? } – saves the pack.
 * PATCH { refresh: true } – pulls the register values again (typed values on other fields are kept).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { id } = await params;
    const cur = getCase(Number(id));
    if (!cur) return NextResponse.json({ error: "That pack is no longer here." }, { status: 404 });
    const body = await readJson(req);
    if (body.refresh) {
      const auto = autoValues(cur.pack_type, cur.programme_id, cur.source_id, user);
      const merged: PackValues = { ...caseValues(cur) };
      for (const [k, v] of Object.entries(auto.values)) if (v) merged[k] = v;
      const c = updateCase(cur.id, { values: merged, ref: cur.ref || auto.ref, title: cur.title || auto.title }, user);
      return NextResponse.json({ case: c, refreshed: Object.keys(auto.values).filter((k) => auto.values[k]).length });
    }
    const c = updateCase(cur.id, { ref: typeof body.ref === "string" ? body.ref : undefined, title: typeof body.title === "string" ? body.title : undefined, revision: typeof body.revision === "string" ? body.revision : undefined, status: typeof body.status === "string" ? body.status : undefined, file_name: typeof body.file_name === "string" ? body.file_name : undefined, values: body.values && typeof body.values === "object" ? (body.values as PackValues) : undefined }, user);
    return NextResponse.json({ case: c });
  })(req, ctx);
}

export const DELETE = withUser<Ctx>(async (user, { params }) => {
  const { id } = await params;
  if (!getCase(Number(id))) return NextResponse.json({ error: "That pack is no longer here." }, { status: 404 });
  removeCase(Number(id), user);
  return NextResponse.json({ ok: true });
});
