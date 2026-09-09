import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { computeCostReport } from "@/lib/cost-report/compute";

export const GET = withUser(async () => {
  const ctx = getAppContext();
  if (!ctx.programme) return NextResponse.json({ error: "Select a programme in the top bar first." }, { status: 400 });
  return NextResponse.json(computeCostReport(ctx.programme.id, ctx.period?.id ?? null));
});
