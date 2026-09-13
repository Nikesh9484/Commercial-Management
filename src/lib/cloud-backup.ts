import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getDb, restoreBackupIfMissing } from "./db";

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
  /** Size in bytes of the stored file, null when there is none. */
  size(key: string): Promise<number | null>;
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
    async size(key) {
      try {
        const h = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return h.ContentLength ?? null;
      } catch {
        return null;
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
  const meta = async (key: string): Promise<{ sha: string; size: number } | null> => {
    const r = await fetch(url(key), { headers: { ...headers, Accept: "application/vnd.github+json" } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status} reading ${key}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { sha?: string; size?: number };
    return j.sha ? { sha: j.sha, size: Number(j.size ?? 0) } : null;
  };
  const sha = async (key: string) => (await meta(key))?.sha ?? null;
  return {
    label: `${repo} (GitHub)`,
    async exists(key) {
      return (await sha(key)) !== null;
    },
    async size(key) {
      return (await meta(key))?.size ?? null;
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

type G = typeof globalThis & { __cdBackup?: BackupStatus; __cdBackupTimer?: NodeJS.Timeout; __cdBackupBusy?: boolean; __cdLastSeen?: string; __cdRestoreFailed?: boolean };
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

/**
 * Called once at server start. The actual download happens synchronously inside getDb() the first
 * time the database is opened (src/lib/db.ts, restoreBackupIfMissing) so no request can seed an empty
 * database while a restore is on its way; this only records how the database came to be.
 */
export async function restoreIfNeeded(): Promise<void> {
  const status = backupStatus();
  if (!isConfigured()) return;
  try {
    const how = restoreBackupIfMissing(dbPath());
    getDb();
    status.restoredFrom = how === "restored" ? "cloud" : how === "present" ? "local" : "fresh";
    status.restoredAt = new Date().toISOString();
    console.log(`[backup] database ${how === "restored" ? "restored from" : how === "present" ? "already on disk; backups go to" : "started fresh; backups go to"} ${store().label}/${KEY}`);
  } catch (e) {
    status.lastError = `Restore failed: ${e instanceof Error ? e.message : String(e)}`;
    g.__cdRestoreFailed = true;
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

const TRACE_KEY = "import-trace.json";

/**
 * A small note about the running import (step reached, memory, how the process ended) kept in the
 * backup store, because the server's disk – and with it the database – is wiped when the host restarts
 * the instance, taking the local trace with it.
 */
export async function putTrace(obj: Record<string, unknown>): Promise<void> {
  if (!isConfigured()) return;
  try {
    await store().put(TRACE_KEY, Buffer.from(JSON.stringify({ ...obj, savedAt: new Date().toISOString() }, null, 1)));
  } catch (e) {
    console.error("[backup] trace not saved:", e instanceof Error ? e.message : String(e));
  }
}

/**
 * The same note written synchronously through a child process: used when the process is being stopped
 * or is crashing, when nothing asynchronous would get the chance to finish (Next.js exits on SIGTERM).
 */
export function putTraceSync(obj: Record<string, unknown>): void {
  if (!isConfigured()) return;
  try {
    const r = spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "put-trace.cjs")], { input: JSON.stringify({ ...obj, savedAt: new Date().toISOString() }, null, 1), stdio: ["pipe", "inherit", "inherit"], timeout: 20_000 });
    if (r.status !== 0) console.error(`[backup] trace note not saved (exit ${r.status ?? r.signal})`);
  } catch (e) {
    console.error("[backup] trace note failed:", e instanceof Error ? e.message : String(e));
  }
}

export async function getTrace(): Promise<Record<string, unknown> | null> {
  if (!isConfigured()) return null;
  try {
    const b = await store().get(TRACE_KEY);
    return b ? (JSON.parse(b.toString("utf8")) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The import currently running (set by the job runner) so a shutdown can note where it got to. */
export function currentImportTrace(): Record<string, unknown> | null {
  return (globalThis as { __cdImportTrace?: Record<string, unknown> }).__cdImportTrace ?? null;
}

/** Upload now (used by the timer, the shutdown hook and the Settings button). */
export async function backupNow(reason = "manual", opts: { force?: boolean } = {}): Promise<void> {
  const status = backupStatus();
  if (!isConfigured() || g.__cdBackupBusy) return;
  if (g.__cdRestoreFailed && !opts.force) {
    status.lastError = "Upload skipped: the database could not be restored from the cloud backup when the server started, so the copy on this server is not trusted over the backup. Restart the server once the backup store is reachable.";
    return;
  }
  g.__cdBackupBusy = true;
  let tmp: string | null = null;
  try {
    tmp = await snapshotAsync();
    const body = fs.readFileSync(tmp);
    const st = store();
    // Never replace a backup with a much smaller database: an empty or half-filled database on a fresh
    // disk must not overwrite months of data. An Admin can force it from Settings when it is intended.
    const remote = await st.size(KEY);
    if (!opts.force && remote && body.length < remote / 2) {
      status.lastError = `Upload skipped: the database on this server (${Math.round(body.length / 1048576)} MB) is much smaller than the cloud backup (${Math.round(remote / 1048576)} MB). If this is intended, use "Back up now (replace)" in Settings.`;
      console.error("[backup]", status.lastError);
      return;
    }
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
    const running = currentImportTrace();
    if (running && running.status === "running") putTraceSync({ ...running, ended: `${signal} received by the process while the import was running (the host stopped the instance – a restart, a deploy, or a failed health check)` });
    backupNow("shutdown").finally(() => process.exit(0));
  };
  process.once("SIGTERM", () => onExit("SIGTERM"));
  process.once("SIGINT", () => onExit("SIGINT"));
  // a crash is noted with its reason before the process goes down
  const onCrash = (kind: string) => (e: unknown) => {
    const msg = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : String(e);
    console.error(`[crash] ${kind}: ${msg}`);
    const running = currentImportTrace();
    putTraceSync({ ...(running ?? {}), ended: `${kind}: ${msg.slice(0, 1500)}`, rssMb: Math.round(process.memoryUsage().rss / 1048576) });
    process.exit(1);
  };
  process.on("uncaughtException", onCrash("uncaught exception"));
  process.on("unhandledRejection", onCrash("unhandled rejection"));
  console.log(`[backup] cloud backup enabled -> ${store().label}/${KEY}`);
}
