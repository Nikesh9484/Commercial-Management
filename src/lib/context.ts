import { getDb, getSetting, setSetting } from "./db";
import { getCurrentPeriod, getPreviousPeriod, type PeriodRow } from "./snapshots";
import { logAudit } from "./audit";
import type { UserInfo } from "./registers/types";
import { AuthError } from "./auth";

export interface Programme {
  id: number;
  code: string;
  name: string;
}
export interface Asset {
  id: number;
  programme_id: number;
  code: string;
  name: string;
}

export interface AppContext {
  programme: Programme | null;
  asset: Asset | null;
  period: PeriodRow | null;
  previousPeriod: PeriodRow | null;
  programmes: Programme[];
  assets: Asset[];
  periods: { id: number; label: string; status: string; report_no: number }[];
}

/** Programme / Asset / Reporting Period shown in the top bar. Shared by all users. */
export function getAppContext(): AppContext {
  const db = getDb();
  const programmes = db.prepare("SELECT id, code, name FROM programmes ORDER BY code").all() as Programme[];
  const assets = db.prepare("SELECT id, programme_id, code, name FROM assets ORDER BY code").all() as Asset[];
  const periods = db.prepare("SELECT id, label, status, report_no FROM reporting_periods ORDER BY report_no DESC").all() as AppContext["periods"];

  let programme = programmes.find((p) => String(p.id) === getSetting(db, "current_programme_id")) ?? programmes[0] ?? null;
  let asset = assets.find((a) => String(a.id) === getSetting(db, "current_asset_id")) ?? null;
  if (asset && programme && asset.programme_id !== programme.id) {
    programme = programmes.find((p) => p.id === asset!.programme_id) ?? programme;
  }
  if (!asset && programme) asset = assets.find((a) => a.programme_id === programme!.id) ?? null;

  const period = getCurrentPeriod();
  return { programme, asset, period, previousPeriod: getPreviousPeriod(period), programmes, assets, periods };
}

export function setAppContext(input: { programme_id?: number; asset_id?: number; period_id?: number }, user: UserInfo) {
  if (user.role === "viewer") throw new AuthError("Viewers cannot change the current programme / asset / period.");
  const db = getDb();
  const before = getAppContext();
  if (input.asset_id) {
    const asset = db.prepare("SELECT id, programme_id FROM assets WHERE id = ?").get(input.asset_id) as Asset | undefined;
    if (asset) {
      setSetting(db, "current_asset_id", String(asset.id));
      setSetting(db, "current_programme_id", String(asset.programme_id));
    }
  } else if (input.programme_id) {
    setSetting(db, "current_programme_id", String(input.programme_id));
    const firstAsset = db.prepare("SELECT id FROM assets WHERE programme_id = ? ORDER BY code LIMIT 1").get(input.programme_id) as { id: number } | undefined;
    setSetting(db, "current_asset_id", firstAsset ? String(firstAsset.id) : null);
  }
  if (input.period_id) setSetting(db, "current_period_id", String(input.period_id));
  const after = getAppContext();
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (before.programme?.id !== after.programme?.id) changes.programme = { from: before.programme?.code ?? null, to: after.programme?.code ?? null };
  if (before.asset?.id !== after.asset?.id) changes.asset = { from: before.asset?.code ?? null, to: after.asset?.code ?? null };
  if (before.period?.id !== after.period?.id) changes.period = { from: before.period?.label ?? null, to: after.period?.label ?? null };
  if (Object.keys(changes).length) {
    logAudit(db, { registerKey: "context", recordId: null, action: "context", user, summary: "Changed the current programme / asset / period in the top bar", changes });
  }
  return after;
}
