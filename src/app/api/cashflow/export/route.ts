import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getCashflow } from "@/lib/cashflow/compute";
import { exportCashflow } from "@/lib/cashflow/excel";
import { todayIso } from "@/lib/format";

export const GET = withUser(async () => {
  const ctx = getAppContext();
  if (!ctx.programme) return NextResponse.json({ error: "Select a programme first." }, { status: 400 });
  const buffer = await exportCashflow(getCashflow(getDb(), ctx.programme.id), `${ctx.programme.code} ${ctx.programme.name}`);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Cash_Flow_${ctx.programme.code}_${todayIso()}.xlsx"`,
    },
  });
});
