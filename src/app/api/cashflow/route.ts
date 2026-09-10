import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getCashflow } from "@/lib/cashflow/compute";

export const GET = withUser(async (user) => {
  const ctx = getAppContext();
  if (!ctx.programme) return NextResponse.json({ error: "Select a programme in the top bar first." }, { status: 400 });
  return NextResponse.json({ ...getCashflow(getDb(), ctx.programme.id), canEdit: user.role !== "viewer" });
});
