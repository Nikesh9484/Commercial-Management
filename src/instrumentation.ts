/** Runs once when the server starts, before it accepts requests. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const backup = await import("./lib/cloud-backup");
    await backup.restoreIfNeeded();
    backup.startBackupLoop();
  }
}
