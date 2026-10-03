import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { readBondDocument } from "@/lib/bonds/documents";

type Ctx = { params: Promise<{ id: string }> };

const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", msg: "application/vnd.ms-outlook", eml: "message/rfc822" };

/** GET /api/bonds/documents/[id] – a document kept with a bond or insurance entry. */
export const GET = withUser<Ctx>(async (_user, { params }) => {
  const { id } = await params;
  const hit = readBondDocument(Number(id));
  if (!hit) return NextResponse.json({ error: "That document is no longer on the server." }, { status: 404 });
  const ext = hit.doc.name.split(".").pop()?.toLowerCase() ?? "";
  const inline = ext === "pdf" || ext === "png" || ext === "jpg" || ext === "jpeg";
  return new Response(new Uint8Array(hit.bytes), { headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(hit.doc.name)}` } });
});
