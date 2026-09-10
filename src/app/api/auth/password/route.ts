import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { authenticate, passwordProblem, setOwnPassword, AuthError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/** POST /api/auth/password { current, next } – a user sets their own password. */
export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const body = await readJson(req);
    const current = String(body.current ?? "");
    const next = String(body.next ?? "");
    if (!current) throw new AuthError("Enter your current password.", 400);
    const ok = await authenticate(user.email, current);
    if (!ok) throw new AuthError("The current password is not correct.", 400);
    const problem = passwordProblem(next, user.email);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    if (next === current) return NextResponse.json({ error: "Choose a password different from the current one." }, { status: 400 });
    setOwnPassword(user.id, next);
    logAudit(getDb(), { registerKey: "auth", recordId: user.id, action: "password", user, summary: `${user.name} changed their password` });
    return NextResponse.json({ ok: true });
  })(req, ctx);
}
