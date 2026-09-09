import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { requireDef, assertCanView, getRecord, updateRecord, deleteRecord } from "@/lib/registers/engine";

type Ctx = { params: Promise<{ key: string; id: string }> };

export const GET = withUser<Ctx>(async (user, { params }) => {
  const { key, id } = await params;
  const def = requireDef(key);
  assertCanView(def, user);
  const row = getRecord(def, Number(id));
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ row });
});

export async function PUT(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { key, id } = await params;
    const def = requireDef(key);
    const row = updateRecord(def, Number(id), await readJson(req), user);
    return NextResponse.json({ row });
  })(req, ctx);
}

export const DELETE = withUser<Ctx>(async (user, { params }) => {
  const { key, id } = await params;
  const def = requireDef(key);
  deleteRecord(def, Number(id), user);
  return NextResponse.json({ ok: true });
});
