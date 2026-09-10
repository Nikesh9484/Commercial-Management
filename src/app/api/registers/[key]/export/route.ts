import { withUser } from "@/lib/api";
import { requireDef, assertCanView } from "@/lib/registers/engine";
import { exportRegister } from "@/lib/excel";
import { todayIso } from "@/lib/format";

type Ctx = { params: Promise<{ key: string }> };

export async function GET(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
  const { key } = await params;
  const def = requireDef(key);
  assertCanView(def, user);
  const origin = new URL(req.url).origin;
  const buffer = await exportRegister(def, { url: `${origin}/`, label: "Open the dashboard" });
  const filename = `${def.title.replace(/[^\w]+/g, "_")}_${todayIso()}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
  })(req, ctx);
}
