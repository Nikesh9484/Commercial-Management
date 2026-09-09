import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { lockPeriod } from "@/lib/snapshots";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withUser<Ctx>(async (user, { params }) => {
  const { id } = await params;
  const result = lockPeriod(Number(id), user);
  return NextResponse.json({ ok: true, ...result });
});
