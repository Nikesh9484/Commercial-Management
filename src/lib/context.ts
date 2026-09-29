import { getDb, getSetting, setSetting } from "./db";
import { getCurrentPeriod, getPreviousPeriod, latestPeriod, type PeriodRow } from "./snapshots";
import { logAudit } from "./audit";
import type { UserInfo } from "./registers/types";
import { AuthError } from "./auth";
import { PERSONAL_ROLES, type PersonalChoice } from "./personal-context";

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

/**
 * The top bar. A "project" is a programme row (1TB01031 The Marina, 1TB01006 Village Boutique
 * Hotel …): every project keeps its own registers, reporting periods, report library and stored
 * copies, and switching the project in the top bar switches all of them at once. Assets are the
 * sub-assets of the project (the cost report rolls up by asset).
 */
export interface AppContext {
  programme: Programme | null;
  asset: Asset | null;
  period: PeriodRow | null;
  previousPeriod: PeriodRow | null;
  programmes: Programme[];
  assets: Asset[];
  periods: { id: number; label: string; status: string; report_no: number }[];
}

/** Programme / Asset / Reporting Period shown in the top bar. Shared by the people who keep the data;
 *  a read-only account sees its own choice instead (personal-context.ts). */
export function getAppContext(): AppContext {
  const db = getDb();
  const programmes = db.prepare("SELECT id, code, name FROM programmes ORDER BY code").all() as Programme[];
  const assets = db.prepare("SELECT id, programme_id, code, name FROM assets ORDER BY code").all() as Asset[];

  let programme = programmes.find((p) => String(p.id) === getSetting(db, "current_programme_id")) ?? programmes[0] ?? null;
  let asset = assets.find((a) => String(a.id) === getSetting(db, "current_asset_id")) ?? null;
  if (asset && programme && asset.programme_id !== programme.id) {
    programme = programmes.find((p) => p.id === asset!.programme_id) ?? programme;
  }
  if (!asset && programme) asset = assets.find((a) => a.programme_id === programme!.id) ?? null;

  const periods = programme
    ? (db.prepare("SELECT id, label, status, report_no FROM reporting_periods WHERE programme_id = ? ORDER BY report_no DESC").all(programme.id) as AppContext["periods"])
    : [];
  const period = getCurrentPeriod(programme?.id ?? null);
  return { programme, asset, period, previousPeriod: getPreviousPeriod(period), programmes, assets, periods };
}

/**
 * A read-only account's own choice (Viewer / Reports only): worked out the same way as the shared
 * one below – a new project brings its first sub-asset and its latest report – but returned to be
 * kept in that user's browser instead of written to the shared settings.
 */
export function personalContextChoice(input: { programme_id?: number; asset_id?: number; period_id?: number }): PersonalChoice {
  const db = getDb();
  const now = getAppContext();
  let programmeId = now.programme?.id;
  let assetId = now.asset?.id;
  let periodId = now.period?.id;
  if (input.asset_id) {
    const a = db.prepare("SELECT id, programme_id FROM assets WHERE id = ?").get(input.asset_id) as Asset | undefined;
    if (!a) throw new AuthError("That sub-asset no longer exists.", 400);
    assetId = a.id;
    programmeId = a.programme_id;
  } else if (input.programme_id) {
    if (!db.prepare("SELECT 1 FROM programmes WHERE id = ?").get(input.programme_id)) throw new AuthError("That project no longer exists.", 400);
    programmeId = input.programme_id;
    if (programmeId !== now.programme?.id) {
      assetId = (db.prepare("SELECT id FROM assets WHERE programme_id = ? ORDER BY code LIMIT 1").get(programmeId) as { id: number } | undefined)?.id;
    }
  }
  if (programmeId !== now.programme?.id) periodId = programmeId ? latestPeriod(db, programmeId)?.id : undefined;
  if (input.period_id) {
    const p = db.prepare("SELECT id, programme_id FROM reporting_periods WHERE id = ?").get(input.period_id) as { id: number; programme_id: number } | undefined;
    if (!p) throw new AuthError("That report no longer exists.", 400);
    if (p.programme_id !== programmeId) throw new AuthError("That report belongs to another project. Switch the project in the top bar first.", 400);
    periodId = p.id;
  }
  return { p: programmeId, a: assetId, r: periodId };
}

export function setAppContext(input: { programme_id?: number; asset_id?: number; period_id?: number }, user: UserInfo) {
  if (PERSONAL_ROLES.has(user.role)) throw new AuthError("Your role keeps its own project / period choice.");
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
    // keep the asset last used for that project, else its first asset
    const remembered = getSetting(db, `current_asset_id:${input.programme_id}`);
    const keep = remembered ? (db.prepare("SELECT id FROM assets WHERE id = ? AND programme_id = ?").get(Number(remembered), input.programme_id) as { id: number } | undefined) : undefined;
    const firstAsset = keep ?? (db.prepare("SELECT id FROM assets WHERE programme_id = ? ORDER BY code LIMIT 1").get(input.programme_id) as { id: number } | undefined);
    setSetting(db, "current_asset_id", firstAsset ? String(firstAsset.id) : null);
  }
  const programmeNow = Number(getSetting(db, "current_programme_id") ?? 0);
  if (before.programme && programmeNow && before.programme.id !== programmeNow) {
    // switching project: remember where the old project was, and go to the new project's last-used (else latest) report
    if (before.period) setSetting(db, `current_period_id:${before.programme.id}`, String(before.period.id));
    if (before.asset) setSetting(db, `current_asset_id:${before.programme.id}`, String(before.asset.id));
    const remembered = getSetting(db, `current_period_id:${programmeNow}`);
    const back = remembered ? (db.prepare("SELECT id FROM reporting_periods WHERE id = ? AND programme_id = ?").get(Number(remembered), programmeNow) as { id: number } | undefined) : undefined;
    const next = back ?? latestPeriod(db, programmeNow);
    setSetting(db, "current_period_id", next ? String(next.id) : null);
  }
  if (input.period_id) {
    const p = db.prepare("SELECT id, programme_id FROM reporting_periods WHERE id = ?").get(input.period_id) as { id: number; programme_id: number } | undefined;
    if (p && p.programme_id === programmeNow) setSetting(db, "current_period_id", String(p.id));
    else if (p) throw new AuthError("That report belongs to another project. Switch the project in the top bar first.");
  }
  const after = getAppContext();
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (before.programme?.id !== after.programme?.id) changes.programme = { from: before.programme?.code ?? null, to: after.programme?.code ?? null };
  if (before.asset?.id !== after.asset?.id) changes.asset = { from: before.asset?.code ?? null, to: after.asset?.code ?? null };
  if (before.period?.id !== after.period?.id) changes.period = { from: before.period?.label ?? null, to: after.period?.label ?? null };
  if (Object.keys(changes).length) {
    logAudit(db, { registerKey: "context", recordId: null, action: "context", user, summary: "Changed the current project / asset / period in the top bar", changes });
  }
  return after;
}
