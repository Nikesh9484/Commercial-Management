import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { VIEW_COOKIE } from "@/lib/personal-context";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(VIEW_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
