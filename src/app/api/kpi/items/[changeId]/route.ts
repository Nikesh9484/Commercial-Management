import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { saveKpiItemDetails } from "@/lib/kpi/store";

type Ctx = { params: Promise<{ changeId: string }> };

/** PUT { sn?, file_name?, root_cause?, remarks? } – the head-office details of one KPI entry. */
export async function PUT(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { changeId } = await params;
    const body = await readJson(req);
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const item = saveKpiItemDetails(Number(changeId), { sn: str(body.sn), file_name: str(body.file_name), root_cause: str(body.root_cause), remarks: str(body.remarks) }, user);
    return NextResponse.json({ item });
  })(req, ctx);
}
