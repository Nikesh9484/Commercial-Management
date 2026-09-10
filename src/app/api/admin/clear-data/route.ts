import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { getDb, setSetting } from "@/lib/db";
import { allRegisters, settingsRegisters } from "@/lib/registers";
import { logAudit } from "@/lib/audit";
import type { UserInfo } from "@/lib/registers/types";

/** Settings lists that always stay (the dropdown lists can be cleared on request). */
const CORE_SETTINGS = new Set(["clients", "locations", "programmes", "assets", "users", "reporting_periods"]);

/**
 * POST /api/admin/clear-data – start over: removes every project record (cost lines, changes, claims,
 * bonds, payments, meetings...) and all locked snapshots. Keeps users, programmes, assets and settings.
 * Body: { confirm: "DELETE", periods?: boolean, lookups?: boolean, team?: boolean }
 */
export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => clearData(user, req))(req, ctx);
}

async function clearData(user: UserInfo, req: Request) {
  if (user.role !== "admin") throw new AuthError("Only an Admin can clear the data.");
  const body = (await readJson(req)) as { confirm?: string; periods?: boolean; lookups?: boolean; team?: boolean };
  if (body.confirm !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });
  const db = getDb();
  const settingsKeys = new Set(settingsRegisters.map((d) => d.key));
  const cleared: string[] = [];
  const tx = db.transaction(() => {
    for (const def of allRegisters) {
      const isSetting = settingsKeys.has(def.key);
      if (def.key === "project_team" && !body.team) continue;
      if (isSetting && CORE_SETTINGS.has(def.key) && def.key !== "reporting_periods") continue;
      if (isSetting && def.key === "reporting_periods" && !body.periods) continue;
      if (isSetting && !CORE_SETTINGS.has(def.key) && !body.lookups) continue;
      db.prepare(`DELETE FROM "${def.table}"`).run();
      cleared.push(def.title);
    }
    db.prepare("DELETE FROM snapshots").run();
    db.prepare("DELETE FROM cashflow_cells").run();
    db.prepare("DELETE FROM report_checklist").run();
    db.prepare("DELETE FROM app_settings WHERE key LIKE 'workbook_map:%'").run();
    db.prepare("UPDATE reporting_periods SET status = 'Open', locked_at = NULL, locked_by = NULL").run();
    if (body.periods) db.prepare("DELETE FROM app_settings WHERE key = 'current_period_id'").run();
  });
  tx();
  if (!body.periods) {
    const first = db.prepare("SELECT id FROM reporting_periods ORDER BY report_no LIMIT 1").get() as { id: number } | undefined;
    if (first) setSetting(db, "current_period_id", String(first.id));
  }
  logAudit(db, {
    registerKey: "system",
    recordId: 0,
    action: "delete",
    user,
    summary: `Cleared project data (${cleared.length} registers, snapshots${body.periods ? ", reporting periods" : ""}${body.lookups ? ", dropdown lists" : ""})`,
  });
  return NextResponse.json({ ok: true, cleared });
}
