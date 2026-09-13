import fs from "node:fs";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { assertLibrary, getDoc, docDiskPath } from "@/lib/library/store";

type Ctx = { params: Promise<{ library: string; id: string }> };

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** The original file, opened inline (PDF) or downloaded. ?download=1 forces a download. */
export const GET = withUser<Ctx>(async (_user, { params }, ) => {
  const { library, id } = await params;
  assertLibrary(library);
  const doc = getDoc(Number(id));
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const p = docDiskPath(doc);
  if (!fs.existsSync(p)) return NextResponse.json({ error: "The file is missing on the server – upload it again." }, { status: 404 });
  const ext = (/\.([a-z0-9]+)$/i.exec(doc.name)?.[1] ?? "").toLowerCase();
  const type = doc.mime || TYPES[ext] || "application/octet-stream";
  const inline = ext === "pdf" || type.startsWith("image/");
  return new Response(new Uint8Array(fs.readFileSync(p)), {
    headers: { "Content-Type": type, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${doc.name.replace(/["\r\n]/g, "")}"` },
  });
});
