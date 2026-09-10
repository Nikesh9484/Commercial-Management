import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { getAppContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { saveCell } from "@/lib/cashflow/compute";

export async function PUT(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const app = getAppContext();
    if (!app.programme) return NextResponse.json({ error: "Select a programme first." }, { status: 400 });
    const body = await readJson(req);
    const num = (v: unknown): number | null | undefined => (v === undefined ? undefined : v === null || v === "" ? null : Number(String(v).replace(/,/g, "")));
    const forecast = num(body.forecast);
    const override = num(body.actual_override);
    if (forecast !== undefined && forecast !== null && Number.isNaN(forecast)) return NextResponse.json({ error: "Forecast must be a number." }, { status: 400 });
    if (override !== undefined && override !== null && Number.isNaN(override)) return NextResponse.json({ error: "Actual must be a number." }, { status: 400 });
    saveCell(getDb(), app.programme.id, { contract_id: Number(body.contract_id), month: String(body.month), forecast, actual_override: override }, user);
    return NextResponse.json({ ok: true });
  })(req, ctx);
}
