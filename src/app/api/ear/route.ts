import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { listCases, createCase, canUseEar } from "@/lib/ear/store";
import { engineConfigured } from "@/lib/ear/generate";

/** Automation → Claim EAR: GET lists the cases of the current programme; POST creates one. */
export const GET = withUser(async (user) => {
  if (!canUseEar(user)) throw new AuthError("Only Editors and Admins can use the Claim EAR automation.");
  const ctx = getAppContext();
  return NextResponse.json({ cases: listCases(ctx.programme?.id ?? null), engine: engineConfigured() });
});

export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const body = await readJson(req);
    const app = getAppContext();
    const row = createCase(body, app.programme?.id ?? null, user);
    return NextResponse.json({ case: row }, { status: 201 });
  })(req, ctx);
}
