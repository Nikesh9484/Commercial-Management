import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getDb } from "@/lib/db";
import { ensurePackTables, readTemplateBytes, removeTemplate, type PackTemplate } from "@/lib/packs/store";

type Ctx = { params: Promise<{ id: string }> };

/** The template file itself. */
export const GET = withUser<Ctx>(async (_user, { params }) => {
  const { id } = await params;
  const db = getDb();
  ensurePackTables(db);
  const t = db.prepare("SELECT * FROM pack_templates WHERE id = ?").get(Number(id)) as PackTemplate | undefined;
  const bytes = t ? readTemplateBytes(t) : null;
  if (!t || !bytes) return NextResponse.json({ error: "That template is no longer here." }, { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${t.name.replace(/["\\]/g, "_")}"` } });
});

export const DELETE = withUser<Ctx>(async (user, { params }) => {
  const { id } = await params;
  removeTemplate(Number(id), user);
  return NextResponse.json({ ok: true });
});
