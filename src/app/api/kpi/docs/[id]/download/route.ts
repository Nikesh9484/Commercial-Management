import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getKpiDoc, readKpiDocBytes } from "@/lib/kpi/store";

type Ctx = { params: Promise<{ id: string }> };

/** The uploaded file itself, to open or check before the pack is made. */
export const GET = withUser<Ctx>(async (_user, { params }) => {
  const { id } = await params;
  const doc = getKpiDoc(Number(id));
  const bytes = doc ? readKpiDocBytes(doc) : null;
  if (!doc || !bytes) return NextResponse.json({ error: "That document is no longer here." }, { status: 404 });
  const type = doc.mime || (/\.pdf$/i.test(doc.name) ? "application/pdf" : "application/octet-stream");
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": type, "Content-Disposition": `${/pdf|image/.test(type) ? "inline" : "attachment"}; filename="${doc.name.replace(/["\\]/g, "_")}"` } });
});
