import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { getDb, getSetting, setSetting } from "@/lib/db";
import { isEditorRole } from "@/lib/registers/types";
import type { ReportSpec } from "@/lib/report-builder/types";

/** Report configurations the user has saved, so a report they put together once can be re-run later. */

const KEY = "report_builder_saved";

interface Saved {
  id: string;
  name: string;
  source: string;
  spec: ReportSpec;
  savedAt: string;
  savedBy: string;
}

function load(): Saved[] {
  const raw = getSetting(getDb(), KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as Saved[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export const GET = withUser(async () => NextResponse.json({ saved: load() }));

export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (!isEditorRole(user.role)) return NextResponse.json({ error: "Only an admin or editor can save a report configuration." }, { status: 403 });
    const body = await readJson(req);
    const name = String(body.name ?? "").trim();
    const spec = body.spec as ReportSpec | undefined;
    if (!name || !spec?.source) return NextResponse.json({ error: "Give the report a name first." }, { status: 400 });
    const list = load();
    const id = String(body.id ?? "") || `rb-${Date.now().toString(36)}`;
    const entry: Saved = { id, name, source: spec.source, spec, savedAt: new Date().toISOString(), savedBy: user.name };
    const i = list.findIndex((s) => s.id === id || s.name.toLowerCase() === name.toLowerCase());
    if (i >= 0) list[i] = entry;
    else list.push(entry);
    setSetting(getDb(), KEY, JSON.stringify(list.slice(-60)));
    return NextResponse.json({ saved: load(), id });
  })(req, ctx);
}

export async function DELETE(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (!isEditorRole(user.role)) return NextResponse.json({ error: "Only an admin or editor can delete a saved report." }, { status: 403 });
    const id = new URL(req.url).searchParams.get("id");
    setSetting(getDb(), KEY, JSON.stringify(load().filter((s) => s.id !== id)));
    return NextResponse.json({ saved: load() });
  })(req, ctx);
}
