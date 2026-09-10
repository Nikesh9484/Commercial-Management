import fs from "node:fs";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { getCase, outputPath, canUseEar } from "@/lib/ear/store";

type Ctx = { params: Promise<{ id: string }> };

/** The finished Employer's Assessment Report (Word). */
export const GET = withUser<Ctx>(async (user, { params }) => {
  if (!canUseEar(user)) throw new AuthError("Only Editors and Admins can download an EAR.");
  const { id } = await params;
  const c = getCase(Number(id));
  if (!c || !c.output_name) return NextResponse.json({ error: "No report has been created for this case yet." }, { status: 404 });
  const p = outputPath(c.id);
  if (!fs.existsSync(p)) return NextResponse.json({ error: "The report file is missing on the server – press Create EAR again." }, { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(p)), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${c.output_name.replace(/["\r\n]/g, "")}"` },
  });
});
