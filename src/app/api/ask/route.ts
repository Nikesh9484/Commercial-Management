import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { ask, askConfigured, type AskTurn } from "@/lib/ask/answer";
import { buildPack } from "@/lib/ask/pack";

export const maxDuration = 600;

/** GET – is the assistant configured? (?stats=1 also reports the size of the data pack.) POST { question, history? } – ask it. */
export async function GET(req: Request, ctx: unknown) {
  return withUser(async () => {
    const stats = new URL(req.url).searchParams.get("stats") === "1";
    if (!stats) return NextResponse.json({ configured: askConfigured() });
    const pack = buildPack();
    return NextResponse.json({ configured: askConfigured(), chars: pack.chars, project: pack.project, period: pack.period, sections: [...pack.text.matchAll(/^# .*$/gm)].map((m) => m[0]) });
  })(req, ctx);
}

export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const body = await readJson(req);
    const history = Array.isArray(body.history) ? (body.history as AskTurn[]).filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string") : [];
    const result = await ask(String(body.question ?? ""), history, user);
    return NextResponse.json(result);
  })(req, ctx);
}
