import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { canUseEar } from "@/lib/ear/store";
import { generateEar } from "@/lib/ear/generate";

type Ctx = { params: Promise<{ id: string }> };

/** Reading a whole claim folder and writing the report can take several minutes. */
export const maxDuration = 900;

export const POST = withUser<Ctx>(async (user, { params }) => {
  if (!canUseEar(user)) throw new AuthError("Only Editors and Admins can create an EAR.");
  const { id } = await params;
  const ctx = getAppContext();
  const programme = [ctx.programme?.name, ctx.asset?.name].filter(Boolean).join(" – ");
  const r = await generateEar(Number(id), user, programme);
  const { output_json: _json, ...rest } = r.case;
  void _json;
  return NextResponse.json({ case: rest, note: r.note });
});
