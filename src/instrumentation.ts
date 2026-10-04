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
    backup.startBackupLoop();
    // the uploaded files beside the database: anything the disk lost comes back, anything never sent goes up
    const files = await import("./lib/file-store");
    void files.restoreMissingAtStart().then(() => files.uploadUnsentAtStart()).catch((e) => console.error("[files] start-up sync failed:", e));
  }
}
