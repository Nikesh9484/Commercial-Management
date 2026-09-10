import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { getFile, removeFile, filePath, canUseEar } from "@/lib/ear/store";

type Ctx = { params: Promise<{ id: string; fileId: string }> };

/** GET downloads the stored document; DELETE removes it from the case. */
export const GET = withUser<Ctx>(async (user, { params }) => {
  if (!canUseEar(user)) throw new AuthError("Only Editors and Admins can open case documents.");
  const { id, fileId } = await params;
  const f = getFile(Number(id), Number(fileId));
  if (!f) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const p = filePath(Number(id), f);
  if (!fs.existsSync(p)) return NextResponse.json({ error: "The stored file is missing on the server." }, { status: 404 });
  const name = path.basename(f.rel_path).replace(/["\r\n]/g, "");
  return new Response(new Uint8Array(fs.readFileSync(p)), {
    headers: { "Content-Type": f.mime || "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"`, "X-Content-Type-Options": "nosniff" },
  });
});

export const DELETE = withUser<Ctx>(async (user, { params }) => {
  const { id, fileId } = await params;
  removeFile(Number(id), Number(fileId), user);
  return NextResponse.json({ ok: true });
});
