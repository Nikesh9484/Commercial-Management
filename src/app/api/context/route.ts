import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { getAppContext, setAppContext, personalContextChoice } from "@/lib/context";
import { PERSONAL_ROLES, VIEW_COOKIE } from "@/lib/personal-context";

export const GET = withUser(async () => NextResponse.json(getAppContext()));

export async function PUT(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const body = await readJson(req);
    const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
    const input = { programme_id: num(body.programme_id), asset_id: num(body.asset_id), period_id: num(body.period_id) };
    if (PERSONAL_ROLES.has(user.role)) {
      // read-only accounts: the choice is theirs alone, kept in their browser – nobody else's screen moves
      const choice = personalContextChoice(input);
      const res = NextResponse.json({ personal: true, choice });
      res.cookies.set(VIEW_COOKIE, JSON.stringify(choice), { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false", maxAge: 60 * 60 * 24 * 90 });
      return res;
    }
    return NextResponse.json(setAppContext(input, user));
  })(req, ctx);
}
