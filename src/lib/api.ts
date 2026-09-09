import { NextResponse } from "next/server";
import { AuthError, requireUser } from "./auth";
import { ValidationError } from "./registers/engine";
import type { UserInfo } from "./registers/types";

/** Wraps a route handler: checks login, turns known errors into tidy JSON responses. */
export function withUser<T>(handler: (user: UserInfo, ctx: T) => Promise<Response> | Response) {
  return async (_req: Request, ctx: T) => {
    try {
      const user = await requireUser();
      return await handler(user, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message, fieldErrors: e.fieldErrors }, { status: 400 });
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(e);
  const msg = e instanceof Error ? e.message : "Something went wrong.";
  return NextResponse.json({ error: msg }, { status: 500 });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
