import fs from "node:fs";
import path from "node:path";
import { getDb, getSetting, setSetting } from "../db";
import { requestBackup } from "../cloud-backup";
import { dataDir, keepFile, restoreFileSync } from "../file-store";
import { readWorkbookValues, readWorkbookPreview } from "../workbook/read";
import { toSheetValues } from "../workbook/marina";
import { analyzeWorkbook } from "../workbook/analyze";
import { storeUpload, saveConverted, importWorkbook } from "../workbook/import";
import { withHeavyLock } from "../workbook/heavy";
import { looksLikeAccommodationTracker, looksLikeCustomsTracker, convertRecoveryTrackers, trackerReadPlan } from "../workbook/recovery";
import { looksLikeClaimsTracker, convertClaimsTracker } from "../workbook/claims-tracker";
import { recoveryContextsFor, claimsContextsFor } from "../recovery/contexts";
import type { UserInfo } from "../registers/types";

/**
 * The cost-recovery trackers (accommodation invoices, customs duties) are one AMAALA-wide file each,
 * covering every asset and package. Uploading one files its rows under every project – but a project
 * set up after the upload (the Yacht Club, added with a later version) holds nothing until the tracker
 * is uploaded again. So the tracker last uploaded is kept beside the database (and in the cloud
 * backup with it), the ones current when this version shipped are under data-seed/trackers, and on
 * every start a project with no rows yet is filled from the latest file, as if the tracker had just
 * been uploaded for it. Projects that already hold rows are not touched: their rows change only when
 * a tracker is uploaded.
 */
export type TrackerKind = "accommodation" | "customs" | "claims";
/**
 * additive: the Claims Tracker only adds and updates claims (a claim entered by hand, or dropped from the
 * tracker, stays), so the file shipped with a version is applied to every project once – the latest
 * remarks reach the projects that already hold claims too. The accommodation and customs trackers mirror
 * the file whole for the projects they feed, so they only fill projects with no rows yet.
 */
const KINDS: Record<TrackerKind, { seed: string; registers: string[]; table: string; label: string; additive: boolean }> = {
  accommodation: { seed: "Accomodation_Invoice_Tracker_for_Finance_Team_-_As_of_2026.09.23.xlsx", registers: ["accommodation_recovery", "accommodation_invoices"], table: "accommodation_recovery", label: "accommodation invoice tracker", additive: false },
  customs: { seed: "TRSP_-_Customs_Recovery_Tracker_2026-10-04.xlsx", registers: ["customs_recovery", "customs_declarations"], table: "customs_recovery", label: "customs recovery tracker", additive: false },
  claims: { seed: "AMA-CM-MARINA_VILLAGE_ClaimTracker_R65.xlsx", registers: ["claims"], table: "claims", label: "claims tracker", additive: true },
};
const SYSTEM = { id: 0, name: "system", email: "", role: "admin" } as UserInfo;

function keptPath(kind: TrackerKind): string {
  return path.join(dataDir(), "trackers", `${kind}.xlsx`);
}

/** Keeps the tracker just uploaded as the latest one of its kind (file beside the database, name in the settings). */
export function keepTrackerUpload(kind: TrackerKind, file: string, name: string): void {
  try {
    const dest = keptPath(kind);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    const db = getDb();
    setSetting(db, `recovery_tracker_name:${kind}`, name);
    // an additive tracker uploaded from the page has just been applied to every project: not again at the next start
    if (KINDS[kind].additive) for (const p of db.prepare("SELECT id FROM programmes").all() as { id: number }[]) setSetting(db, `tracker_applied:${kind}:${name}:${p.id}`, "1");
    keepFile(dest);
  } catch (e) {
    console.warn(`[recovery] the ${KINDS[kind].label} could not be kept for later projects:`, e instanceof Error ? e.message : e);
  }
}

/** The latest tracker of a kind: the one last uploaded (fetched back from the backup when the disk lost it), else the one shipped with this version. */
export function latestTrackerFile(kind: TrackerKind): { file: string; name: string } | null {
  const kept = keptPath(kind);
  if (!fs.existsSync(kept)) restoreFileSync(kept);
  if (fs.existsSync(kept)) return { file: kept, name: getSetting(getDb(), `recovery_tracker_name:${kind}`) || KINDS[kind].seed.replace(/_/g, " ") };
  const seed = path.join(process.cwd(), "data-seed", "trackers", KINDS[kind].seed);
  return fs.existsSync(seed) ? { file: seed, name: KINDS[kind].seed.replace(/_/g, " ") } : null;
}

/** Fills every project that has no rows of a tracker yet from the latest file of that tracker. Tried once per project and kind. */
export async function fillRecoveryTrackersAtStart(): Promise<void> {
  const db = getDb();
  const programmes = db.prepare("SELECT id, code, name FROM programmes ORDER BY id").all() as { id: number; code: string; name: string }[];
  for (const kind of Object.keys(KINDS) as TrackerKind[]) {
    const k = KINDS[kind];
    const src = latestTrackerFile(kind);
    const withPeriod = programmes.filter((p) => !!db.prepare("SELECT 1 FROM reporting_periods WHERE programme_id = ? LIMIT 1").get(p.id));
    // an additive tracker: every project once per file; a mirrored one: the projects with no rows yet
    const missing = k.additive
      ? src
        ? withPeriod.filter((p) => getSetting(db, `tracker_applied:${kind}:${src.name}:${p.id}`) !== "1")
        : []
      : withPeriod.filter((p) => getSetting(db, `recovery_filled:${kind}:${p.id}`) !== "1" && !db.prepare(`SELECT 1 FROM "${k.table}" WHERE programme_id = ? LIMIT 1`).get(p.id));
    if (!missing.length) continue;
    if (!src) {
      console.warn(`[recovery] no ${k.label} on file – ${missing.map((p) => p.name).join(", ")} stay empty until one is uploaded.`);
      continue;
    }
    // tried once: a fill that fails is not repeated at every start – the tracker can always be uploaded from the import page
    for (const p of missing) setSetting(db, k.additive ? `tracker_applied:${kind}:${src.name}:${p.id}` : `recovery_filled:${kind}:${p.id}`, "1");
    try {
      await withHeavyLock(async () => {
        const fileId = storeUpload(fs.readFileSync(src.file));
        const plan = trackerReadPlan(await readWorkbookPreview(src.file));
        let sheets = await readWorkbookValues(src.file, plan ?? {});
        const isKind = kind === "accommodation" ? looksLikeAccommodationTracker(sheets) : kind === "customs" ? looksLikeCustomsTracker(sheets) : looksLikeClaimsTracker(sheets);
        if (!isKind) throw new Error(`${src.name} is not a ${k.label}`);
        const conv = kind === "claims" ? convertClaimsTracker(sheets, claimsContextsFor(db, missing)) : convertRecoveryTrackers(sheets, recoveryContextsFor(db, missing, src.name), kind);
        sheets = toSheetValues(conv);
        saveConverted(fileId, sheets);
        const a = analyzeWorkbook(sheets, src.name, fileId);
        const res = await importWorkbook(
          {
            fileId,
            period: {},
            sheets: a.sheets.map((s) => ({ sheet: s.name, headerRow: s.headerRow, register: s.register, columns: Object.fromEntries(s.columns.map((c) => [String(c.index), c.field])) })),
            lock: false,
            createMissingLookups: true,
            allowedRegisters: k.registers,
            programmeId: missing[0].id,
            fileName: src.name,
          },
          SYSTEM,
        );
        const added = res.sheets.reduce((t, r) => t + r.created, 0);
        const updated = res.sheets.reduce((t, r) => t + r.updated, 0);
        const errors = res.sheets.reduce((t, r) => t + r.errors.length, 0);
        console.log(`[recovery] ${k.label} (${src.name}) → ${missing.map((p) => p.name).join(", ")}: ${added} row(s) added, ${updated} updated${errors ? `, ${errors} row(s) could not be read` : ""}. ${conv.notes.join(" ")}`);
      });
      requestBackup("recovery-trackers");
    } catch (e) {
      console.error(`[recovery] filling ${missing.map((p) => p.name).join(", ")} from the ${k.label} failed:`, e);
    }
  }
}
