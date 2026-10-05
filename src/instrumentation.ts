/** Runs once when the server starts, before it accepts requests. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const backup = await import("./lib/cloud-backup");
    await backup.restoreIfNeeded();
    const { repairEarlyWarnings } = await import("./lib/repairs/early-warnings");
    repairEarlyWarnings();
    const { repairPaymentCumulatives } = await import("./lib/repairs/payment-cumulatives");
    repairPaymentCumulatives();
    const { repairFinalAccountBreakdown } = await import("./lib/repairs/final-account-breakdown");
    repairFinalAccountBreakdown();
    const { repairCustomsVendorLinks, repairBareCustomsRows } = await import("./lib/repairs/customs-vendors");
    repairCustomsVendorLinks();
    repairBareCustomsRows();
    const { repairAconexTies } = await import("./lib/repairs/aconex-ties");
    repairAconexTies();
    const { mergeDuplicateLookups } = await import("./lib/repairs/merge-duplicates");
    mergeDuplicateLookups();
    backup.startBackupLoop();
    // the Yacht Club's reports shipped with this version: imported in the background once the server is up
    const { importAycReportsAtStart } = await import("./lib/repairs/ayc-reports");
    // then every project without cost-recovery rows yet is filled from the latest accommodation and customs trackers
    const { fillRecoveryTrackersAtStart } = await import("./lib/repairs/recovery-trackers");
    // and the Aconex Cost exports shipped with this version (data-seed/aconex), each file once
    const { importAconexSeedsAtStart } = await import("./lib/repairs/aconex-seed");
    setTimeout(() => {
      void importAycReportsAtStart()
        .then(() => fillRecoveryTrackersAtStart())
        .then(() => importAconexSeedsAtStart())
        .catch((e) => console.error("[recovery] start-up fill failed:", e));
    }, 20_000);
    // the uploaded files beside the database: anything the disk lost comes back, anything never sent goes up
    const files = await import("./lib/file-store");
    void files.restoreMissingAtStart().then(() => files.uploadUnsentAtStart()).catch((e) => console.error("[files] start-up sync failed:", e));
  }
}
