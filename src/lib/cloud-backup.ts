import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getDb } from "./db";

/**
 * Cloud backup of the SQLite database file.
 *
 * Free hosting services (Render, Railway, Fly …) wipe their disk whenever the app restarts.
 * When the BACKUP_S3_* settings are present, the app:
 *   - downloads the last backup when it starts on a fresh disk (restore),
 *   - uploads a fresh copy whenever the database has changed (checked every 20 seconds),
 *   - keeps one dated copy per day under backups/YYYY-MM-DD.db,
 *   - uploads once more when the host asks it to shut down.
 * Works with any S3-compatible storage: Backblaze B2, Cloudflare R2, AWS S3, Wasabi …
 */

const KEY = process.env.BACKUP_S3_OBJECT || "commercial.db";
const INTERVAL_MS = 20_000;

export interface BackupStatus {
  enabled: boolean;
  bucket: string | null;
  restoredAt: string | null;
  restoredFrom: "cloud" | "local" | "fresh" | null;
  lastUploadAt: string | null;
  lastError: string | null;
  uploads: number;
}

type G = typeof globalThis & { __cdBackup?: BackupStatus; __cdBackupTimer?: NodeJS.Timeout; __cdBackupBusy?: boolean; __cdLastSeen?: string };
const g = globalThis as G;

export function backupStatus(): BackupStatus {
  if (!g.__cdBackup) g.__cdBackup = { enabled: isConfigured(), bucket: process.env.BACKUP_S3_BUCKET ?? null, restoredAt: null, restoredFrom: null, lastUploadAt: null, lastError: null, uploads: 0 };
  return g.__cdBackup;
}

export function isConfigured(): boolean {
  return !!(process.env.BACKUP_S3_ENDPOINT && process.env.BACKUP_S3_BUCKET && process.env.BACKUP_S3_KEY_ID && process.env.BACKUP_S3_SECRET);
}

function client(): S3Client {
  return new S3Client({
    endpoint: process.env.BACKUP_S3_ENDPOINT,
    region: process.env.BACKUP_S3_REGION || "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.BACKUP_S3_KEY_ID!, secretAccessKey: process.env.BACKUP_S3_SECRET! },
  });
}

export function dbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), "data", "commercial.db");
}

/** Called once at server start: fetch the last backup if there is no local database yet. */
export async function restoreIfNeeded(): Promise<void> {
  const status = backupStatus();
  if (!isConfigured()) return;
  const file = dbPath();
  if (fs.existsSync(file)) {
    status.restoredFrom = "local";
    status.restoredAt = new Date().toISOString();
    return;
  }
  try {
    const s3 = client();
    const bucket = process.env.BACKUP_S3_BUCKET!;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: KEY }));
    } catch {
      status.restoredFrom = "fresh";
      status.restoredAt = new Date().toISOString();
      console.log("[backup] no backup in the bucket yet – starting with a fresh database");
      return;
    }
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: KEY }));
    const bytes = await obj.Body!.transformToByteArray();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(bytes));
    status.restoredFrom = "cloud";
    status.restoredAt = new Date().toISOString();
    console.log(`[backup] restored ${bytes.length} bytes from ${bucket}/${KEY}`);
  } catch (e) {
    status.lastError = `Restore failed: ${e instanceof Error ? e.message : String(e)}`;
    console.error("[backup]", status.lastError);
  }
}

async function snapshotAsync(): Promise<string> {
  const tmp = path.join(os.tmpdir(), `commercial-backup-${process.pid}-${Date.now()}.db`);
  await getDb().backup(tmp);
  return tmp;
}

function changeSignature(): string {
  const file = dbPath();
  const parts = [file, `${file}-wal`].map((f) => {
    try {
      const st = fs.statSync(f);
      return `${st.size}:${st.mtimeMs}`;
    } catch {
      return "-";
    }
  });
  return parts.join("|");
}

/** Upload now (used by the timer, the shutdown hook and the Settings button). */
export async function backupNow(reason = "manual"): Promise<void> {
  const status = backupStatus();
  if (!isConfigured() || g.__cdBackupBusy) return;
  g.__cdBackupBusy = true;
  let tmp: string | null = null;
  try {
    tmp = await snapshotAsync();
    const body = fs.readFileSync(tmp);
    const s3 = client();
    const bucket = process.env.BACKUP_S3_BUCKET!;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: KEY, Body: body, ContentType: "application/x-sqlite3" }));
    const day = new Date().toISOString().slice(0, 10);
    const dailyKey = `backups/${day}.db`;
    let hasDaily = true;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: dailyKey }));
    } catch {
      hasDaily = false;
    }
    if (!hasDaily) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: dailyKey, Body: body, ContentType: "application/x-sqlite3" }));
    status.lastUploadAt = new Date().toISOString();
    status.lastError = null;
    status.uploads++;
    g.__cdLastSeen = changeSignature();
    console.log(`[backup] uploaded ${body.length} bytes (${reason})`);
  } catch (e) {
    status.lastError = `Upload failed: ${e instanceof Error ? e.message : String(e)}`;
    console.error("[backup]", status.lastError);
  } finally {
    if (tmp) fs.rm(tmp, { force: true }, () => {});
    g.__cdBackupBusy = false;
  }
}

/** Starts the periodic upload loop and the shutdown hook (once per process). */
export function startBackupLoop(): void {
  if (!isConfigured() || g.__cdBackupTimer) return;
  g.__cdLastSeen = changeSignature();
  g.__cdBackupTimer = setInterval(() => {
    const sig = changeSignature();
    if (sig !== g.__cdLastSeen) void backupNow("changed");
  }, INTERVAL_MS);
  g.__cdBackupTimer.unref();
  const onExit = (signal: string) => {
    console.log(`[backup] ${signal} received – final upload`);
    backupNow("shutdown").finally(() => process.exit(0));
  };
  process.once("SIGTERM", () => onExit("SIGTERM"));
  process.once("SIGINT", () => onExit("SIGINT"));
  console.log(`[backup] cloud backup enabled → ${process.env.BACKUP_S3_BUCKET}/${KEY}`);
}
