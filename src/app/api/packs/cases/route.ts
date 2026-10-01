import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { autoValues } from "@/lib/packs/data";
import { packType } from "@/lib/packs/shared";
import { createCase, listCases, rebuildValues } from "@/lib/packs/store";

/** POST { type, sourceId?, title?, reuse? } – starts a pack for the current project, filled from the register item picked; with reuse, the pack already started for that item is returned instead. */
export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const app = getAppContext();
    if (!app.programme) return NextResponse.json({ error: "Select a project in the top bar first." }, { status: 400 });
    const body = await readJson(req);
    const t = packType(String(body.type ?? ""));
    if (!t) return NextResponse.json({ error: "Unknown pack category." }, { status: 400 });
    const sourceId = Number(body.sourceId) > 0 ? Number(body.sourceId) : null;
    // a pack already started for this register item: open it rather than start a second one
    if (sourceId && body.reuse) {
      const existing = listCases(app.programme.id, t.key).find((c) => c.source_id === sourceId && c.status !== "Superseded");
      if (existing) return NextResponse.json({ case: existing, existing: true });
    }
    const auto = autoValues(t.key, app.programme.id, sourceId, user);
    const title = String(body.title ?? "").trim() || auto.title || t.label;
    const c = createCase({ type: t.key, programmeId: app.programme.id, sourceId, ref: auto.ref, title, values: auto.values }, user);
    await rebuildValues(c.id, user);
    return NextResponse.json({ case: c }, { status: 201 });
  })(req, ctx);
}
