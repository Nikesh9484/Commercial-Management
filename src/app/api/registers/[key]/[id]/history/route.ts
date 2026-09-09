import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { requireDef, assertCanView } from "@/lib/registers/engine";
import { getRecordHistory } from "@/lib/audit";
import { getDb } from "@/lib/db";

type Ctx = { params: Promise<{ key: string; id: string }> };

export const GET = withUser<Ctx>(async (user, { params }) => {
  const { key, id } = await params;
  const def = requireDef(key);
  assertCanView(def, user);
  return NextResponse.json({ history: getRecordHistory(getDb(), def.key, Number(id)) });
});
