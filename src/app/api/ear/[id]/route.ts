import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { getCase, listFiles, updateCase, deleteCase, canUseEar } from "@/lib/ear/store";
import { engineConfigured } from "@/lib/ear/generate";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withUser<Ctx>(async (user, { params }) => {
  if (!canUseEar(user)) throw new AuthError("Only Editors and Admins can use the Claim EAR automation.");
  const { id } = await params;
  const c = getCase(Number(id));
  if (!c) return NextResponse.json({ error: "Case not found." }, { status: 404 });
  const { output_json: _json, ...rest } = c;
  void _json;
  return NextResponse.json({ case: rest, files: listFiles(c.id), engine: engineConfigured() });
});

export async function PATCH(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { id } = await params;
    const body = await readJson(req);
    const c = updateCase(Number(id), body, user);
    const { output_json: _json, ...rest } = c;
    void _json;
    return NextResponse.json({ case: rest });
  })(req, ctx);
}

export const DELETE = withUser<Ctx>(async (user, { params }) => {
  const { id } = await params;
  deleteCase(Number(id), user);
  return NextResponse.json({ ok: true });
});
