import { withHeavyLock } from "@/lib/workbook/heavy";
import { withUser } from "@/lib/api";
import { requireDef, assertCanView } from "@/lib/registers/engine";
import { exportRegister } from "@/lib/excel";
import { todayIso } from "@/lib/format";
import { parseBondsFilter, isFiltered, matchesBondsFilter, bondsFilterSlug } from "@/lib/bonds/filter";
import type { RecordRow } from "@/lib/registers/types";

type Ctx = { params: Promise<{ key: string }> };

async function heavyGET(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
  const { key } = await params;
  const def = requireDef(key);
  assertCanView(def, user);
  const url = new URL(req.url);
  const origin = url.origin;
  // the Bonds & Insurance page can filter itself (expiry window, bond / insurance); its table export follows
  const bonds = key === "bonds" ? parseBondsFilter(url.searchParams) : null;
  const rowFilter = bonds && isFiltered(bonds) ? (r: RecordRow) => matchesBondsFilter(r, bonds) : undefined;
  const buffer = await exportRegister(def, { url: `${origin}/`, label: "Open the dashboard" }, rowFilter);
  const tag = bonds ? bondsFilterSlug(bonds) : "";
  const filename = `${def.title.replace(/[^\w]+/g, "_")}${tag ? `_${tag}` : ""}_${todayIso()}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
  })(req, ctx);
}

/** Heavy work runs one request at a time and hands memory back afterwards (small hosting plan). */
export const GET: typeof heavyGET = (...args) => withHeavyLock(() => heavyGET(...args));
