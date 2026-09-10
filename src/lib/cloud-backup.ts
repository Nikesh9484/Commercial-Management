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
 * Storage: a private GitHub repository (BACKUP_GITHUB_TOKEN + BACKUP_GITHUB_REPO) or any
 * S3-compatible bucket (BACKUP_S3_*): Backblaze B2, Cloudflare R2, AWS S3, Wasabi …
 */

const KEY = process.env.BACKUP_S3_OBJECT || "commercial.db";
const INTERVAL_MS = 20_000;

/** Where backups go: an S3-compatible bucket, or a (private) GitHub repository. */
export type Provider = "s3" | "github" | null;

export function provider(): Provider {
  if (process.env.BACKUP_GITHUB_TOKEN && process.env.BACKUP_GITHUB_REPO) return "github";
  if (process.env.BACKUP_S3_ENDPOINT && process.env.BACKUP_S3_BUCKET && process.env.BACKUP_S3_KEY_ID && process.env.BACKUP_S3_SECRET) return "s3";
  return null;
}

interface Store {
  exists(key: string): Promise<boolean>;
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer): Promise<void>;
  label: string;
}

function s3Store(): Store {
  const s3 = client();
  const bucket = process.env.BACKUP_S3_BUCKET!;
  return {
    label: `${bucket} (S3)`,
    async exists(key) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
    async get(key) {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await obj.Body!.transformToByteArray());
    },
    async put(key, body) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/x-sqlite3" }));
    },
  };
}

/** GitHub "contents" API: one file per backup in a private repository (branch = repo default). */
function githubStore(): Store {
  const repo = process.env.BACKUP_GITHUB_REPO!; // owner/name
  const token = process.env.BACKUP_GITHUB_TOKEN!;
  const api = (process.env.BACKUP_GITHUB_API || "https://api.github.com").replace(/\/$/, "");
  const folder = process.env.BACKUP_GITHUB_FOLDER || "backups";
  const headers = { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "commercial-dashboard" };
  const url = (key: string) => `${api}/repos/${repo}/contents/${folder}/${key}`;
  const sha = async (key: string): Promise<string | null> => {
    const r = await fetch(url(key), { headers: { ...headers, Accept: "application/vnd.github+json" } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status} reading ${key}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { sha?: string };
    return j.sha ?? null;
  };
  return {
    label: `${repo} (GitHub)`,
    async exists(key) {
      return (await sha(key)) !== null;
    },
    async get(key) {
      const r = await fetch(url(key), { headers: { ...headers, Accept: "application/vnd.github.raw+json" } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`GitHub ${r.status} downloading ${key}: ${(await r.text()).slice(0, 200)}`);
      return Buffer.from(await r.arrayBuffer());
    },
    async put(key, body) {
      const existing = await sha(key);
      const r = await fetch(url(key), {
        method: "PUT",
        headers: { ...headers, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Backup ${key} ${new Date().toISOString()}`, content: body.toString("base64"), ...(existing ? { sha: existing } : {}) }),
      });
      if (!r.ok) throw new Error(`GitHub ${r.status} uploading ${key}: ${(await r.text()).slice(0, 200)}`);
    },
  };
}

function store(): Store {
  return provider() === "github" ? githubStore() : s3Store();
}

export interface BackupStatus {
  enabled: boolean;
  /** Human label of the storage in use. */
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
  if (!g.__cdBackup) g.__cdBackup = { enabled: isConfigured(), bucket: isConfigured() ? store().label : null, restoredAt: null, restoredFrom: null, lastUploadAt: null, lastError: null, uploads: 0 };
  return g.__cdBackup;
}

export function isConfigured(): boolean {
  return provider() !== null;
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
    const st = store();
    const bytes = await st.get(KEY);
    if (!bytes) {
      status.restoredFrom = "fresh";
      status.restoredAt = new Date().toISOString();
      console.log(`[backup] no backup in ${st.label} yet – starting with a fresh database`);
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    status.restoredFrom = "cloud";
    status.restoredAt = new Date().toISOString();
    console.log(`[backup] restored ${bytes.length} bytes from ${st.label}/${KEY}`);
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
    const st = store();
    await st.put(KEY, body);
    const day = new Date().toISOString().slice(0, 10);
    const dailyKey = `daily/${day}.db`;
    if (!(await st.exists(dailyKey))) await st.put(dailyKey, body);
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
  console.log(`[backup] cloud backup enabled -> ${store().label}/${KEY}`);
}
