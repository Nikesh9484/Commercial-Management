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
  const row = getRecord(def, Number(id));
  deleteRecord(def, Number(id), user);
  // a change added from documents and deleted leaves no gap in the CH series: the later ones move up
  if (def.key === "changes" && row?.programme_id) {
    const { closeGaps } = await import("@/lib/changes/from-docs");
    const r = { entries: [], duplicates: [], needsDecision: false, files: [], periods: [], warnings: [] as string[] };
    closeGaps(Number(row.programme_id), user, r);
    return NextResponse.json({ ok: true, renumbered: r.warnings });
  }
  return NextResponse.json({ ok: true });
});
