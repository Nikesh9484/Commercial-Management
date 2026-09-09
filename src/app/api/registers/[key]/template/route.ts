import { withUser } from "@/lib/api";
import { requireDef, assertCanView } from "@/lib/registers/engine";
import { exportTemplate } from "@/lib/excel";

type Ctx = { params: Promise<{ key: string }> };

export const GET = withUser<Ctx>(async (user, { params }) => {
  const { key } = await params;
  const def = requireDef(key);
  assertCanView(def, user);
  const buffer = await exportTemplate(def);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${def.title.replace(/[^\w]+/g, "_")}_template.xlsx"`,
    },
  });
});
