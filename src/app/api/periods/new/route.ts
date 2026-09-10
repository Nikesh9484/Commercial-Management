import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { startPeriod, proposeNextPeriod } from "@/lib/month";

/** GET -> proposed next period; POST { report_no, period_end } -> creates it, makes it current, adds its checklist. */
export const GET = withUser(async () => NextResponse.json(proposeNextPeriod()));

export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const body = await readJson(req);
    const row = startPeriod({ report_no: Number(body.report_no), period_end: String(body.period_end ?? "") }, user);
    return NextResponse.json({ period: { id: row.id, label: row.label } }, { status: 201 });
  })(req, ctx);
}
