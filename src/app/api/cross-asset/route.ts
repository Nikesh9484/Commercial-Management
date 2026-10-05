import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { isEditorRole } from "@/lib/registers/types";
import { cleanAssets, cleanRules, loadCrossAssetConfig, saveCrossAssetConfig, type Override } from "@/lib/report/cross-asset-rules";

/**
 * The cross-asset budget transfer report's rules, kept on the dashboard: PUT saves a project's rules and the list of
 * assets (or puts a project's rules back to their defaults), POST places one change entry by hand (or hands it back to
 * the rules). Admins and editors only; every change goes in the audit log.
 */
function projectOf(code: unknown): string | null {
  const c = String(code ?? "").trim();
  return c && getDb().prepare("SELECT 1 FROM programmes WHERE code = ?").get(c) ? c : null;
}

export const GET = withUser(async () => NextResponse.json(loadCrossAssetConfig()));

export async function PUT(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (!isEditorRole(user.role)) return NextResponse.json({ error: "Only an admin or editor can change the rules." }, { status: 403 });
    const body = await readJson(req);
    const code = projectOf(body.programmeCode);
    if (!code) return NextResponse.json({ error: "Unknown project." }, { status: 400 });
    const config = loadCrossAssetConfig();
    const said: string[] = [];
    if (body.reset === true) {
      delete config.projects[code];
      said.push(`rules for ${code} put back to their defaults`);
    } else if (body.rules && typeof body.rules === "object") {
      config.projects[code] = cleanRules(body.rules as Record<string, unknown>);
      said.push(`rules for ${code} saved`);
    }
    if (body.assets !== undefined) {
      const assets = cleanAssets(body.assets);
      if (!assets) return NextResponse.json({ error: "The list of assets needs at least one asset with a name." }, { status: 400 });
      config.assets = assets;
      said.push(`list of assets saved (${assets.length})`);
    }
    saveCrossAssetConfig(config);
    logAudit(getDb(), { registerKey: "cross_asset", recordId: null, action: "update", user, summary: `Cross-asset budget transfers: ${said.join("; ") || "nothing changed"}` });
    return NextResponse.json({ ok: true });
  })(req, ctx);
}

export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (!isEditorRole(user.role)) return NextResponse.json({ error: "Only an admin or editor can place an entry." }, { status: 403 });
    const body = await readJson(req);
    const code = projectOf(body.programmeCode);
    const itemNo = String(body.itemNo ?? "").trim().slice(0, 80);
    const dir = String(body.dir ?? "");
    if (!code || !itemNo) return NextResponse.json({ error: "Project and item number are needed." }, { status: 400 });
    if (!["out", "into", "confirm", "exclude", "auto"].includes(dir)) return NextResponse.json({ error: "Choose where the entry goes." }, { status: 400 });
    if (dir !== "auto" && !getDb().prepare("SELECT 1 FROM changes c JOIN programmes p ON p.id = c.programme_id WHERE p.code = ? AND c.item_no = ?").get(code, itemNo))
      return NextResponse.json({ error: `No change ${itemNo} in this project's change register.` }, { status: 400 });
    const config = loadCrossAssetConfig();
    const list = (config.overrides[code] ??= {});
    const label: Record<string, string> = { out: "Budget out", into: "Budget in", confirm: "To confirm", exclude: "Left out", auto: "back to the rules" };
    if (dir === "auto") delete list[itemNo];
    else {
      const o: Override = { dir: dir as Override["dir"], by: user.name, at: new Date().toISOString() };
      const asset = String(body.asset ?? "").trim().slice(0, 80);
      const note = String(body.note ?? "").trim().slice(0, 300);
      if (asset) o.asset = asset;
      if (note) o.note = note;
      list[itemNo] = o;
    }
    saveCrossAssetConfig(config);
    logAudit(getDb(), { registerKey: "cross_asset", recordId: null, action: "update", user, summary: `Cross-asset budget transfers (${code}): ${itemNo} → ${label[dir]}${body.asset ? ` (${String(body.asset)})` : ""}${body.note ? ` – ${String(body.note)}` : ""}` });
    return NextResponse.json({ ok: true });
  })(req, ctx);
}
