import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { closeDb, getDb, restoreBackupIfMissing } from "./db";

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
/** A changed database is uploaded at most this often (each upload is the whole file, ~25 MB of bandwidth). */
const MIN_UPLOAD_GAP_MS = 90_000;
/** After a start, the cloud copy is watched this long for the previous server's final upload. */
const STARTUP_WATCH_MS = 10 * 60_000;
/** The plain size of the copy in the store travels beside it (the copy itself is compressed). */
const META_KEY = `${KEY}.json`;

/** Backups go up gzip-compressed (a 40 MB database is about 6 MB): a fraction of the memory and time of the plain file. */
function pack(plain: Buffer): Buffer {
  return zlib.gzipSync(plain, { level: 6 });
}
/** A copy from the store as a plain SQLite file, whether it was stored compressed or (older copies) plain. */
export function unpack(bytes: Buffer): Buffer {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b ? zlib.gunzipSync(bytes) : bytes;
}
function isSqlite(b: Buffer): boolean {
  return b.length >= 100 && b.subarray(0, 15).toString("latin1") === "SQLite format 3";
}
/** The last audit entry made by a person (the top-bar context switch is not one): how "has anything been done here?" is answered. */
function auditMark(): number {
  try {
    return Number((getDb().prepare("SELECT COALESCE(MAX(id), 0) AS n FROM audit_log WHERE action <> 'context'").get() as { n: number }).n);
  } catch {
    return -1;
  }
}

/** Where backups go: an S3-compatible bucket, or a (private) GitHub repository. */
export type Provider = "s3" | "github" | null;

export function provider(): Provider {
  if (process.env.BACKUP_GITHUB_TOKEN && process.env.BACKUP_GITHUB_REPO) return "github";
  if (process.env.BACKUP_S3_ENDPOINT && process.env.BACKUP_S3_BUCKET && process.env.BACKUP_S3_KEY_ID && process.env.BACKUP_S3_SECRET) return "s3";
  return null;
}

export interface StoredCopy {
  key: string;
  size: number;
  modified: string | null;
}

interface Store {
  exists(key: string): Promise<boolean>;
  /** Size in bytes of the stored file, null when there is none. */
  size(key: string): Promise<number | null>;
  /** An identity for the stored version (ETag or content sha): changes whenever someone uploads. */
  stamp(key: string): Promise<string | null>;
  /** The copies under a prefix ("daily/", "conflict/"), newest first. */
  list(prefix: string): Promise<StoredCopy[]>;
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer): Promise<void>;
  del(key: string): Promise<void>;
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
    async stamp(key) {
      try {
        const h = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return `${h.ETag ?? ""}|${h.ContentLength ?? 0}|${h.LastModified?.toISOString() ?? ""}`;
      } catch {
        return null;
      }
    },
    async list(prefix) {
      const out: StoredCopy[] = [];
      let token: string | undefined;
      do {
        const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of r.Contents ?? []) if (o.Key && o.Key !== prefix) out.push({ key: o.Key, size: Number(o.Size ?? 0), modified: o.LastModified?.toISOString() ?? null });
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      return out.sort((a, b) => b.key.localeCompare(a.key));
    },
    async get(key) {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await obj.Body!.transformToByteArray());
    },
    async put(key, body) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: key.endsWith(".db") ? "application/x-sqlite3" : "application/octet-stream" }));
    },
    async del(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
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
    async stamp(key) {
      return (await sha(key)) ?? null;
    },
    async list(prefix) {
      const dir = prefix.replace(/\/$/, "");
      const r = await fetch(url(dir), { headers: { ...headers, Accept: "application/vnd.github+json" } });
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`GitHub ${r.status} listing ${dir}: ${(await r.text()).slice(0, 200)}`);
      const j = (await r.json()) as { name: string; size?: number; type?: string }[];
      return (Array.isArray(j) ? j : []).filter((x) => x.type === "file").map((x) => ({ key: `${dir}/${x.name}`, size: Number(x.size ?? 0), modified: null })).sort((a, b) => b.key.localeCompare(a.key));
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
    async del(key) {
      const existing = await sha(key);
      if (!existing) return;
      const r = await fetch(url(key), {
        method: "DELETE",
        headers: { ...headers, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Remove ${key} ${new Date().toISOString()}`, sha: existing }),
      });
      if (!r.ok && r.status !== 404) throw new Error(`GitHub ${r.status} removing ${key}: ${(await r.text()).slice(0, 200)}`);
    },
  };
}

/** The backup store, for the uploaded files that live beside the database (see file-store.ts). */
export function backupStore(): Store | null {
  return provider() ? store() : null;
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
  /** Something worth telling the Admin: a newer copy adopted at start, or a conflicting copy kept aside. */
  notice: string | null;
}

type G = typeof globalThis & {
  __cdBackup?: BackupStatus;
  __cdBackupTimer?: NodeJS.Timeout;
  __cdBackupBusy?: boolean;
  __cdLastSeen?: string;
  __cdRestoreFailed?: boolean;
  /** the cloud copy's identity as last seen by this server (restored from it, or uploaded by it) */
  __cdKnownStamp?: string | null;
  /** the local file's signature right after the restore: unchanged means nothing was written here yet */
  __cdRestoreSig?: string;
  /** the last audit entry right after the restore: the same later means nobody has done anything here yet */
  __cdRestoreAudit?: number;
  __cdBackupWanted?: string | null;
};
const g = globalThis as G;

export function backupStatus(): BackupStatus {
  if (!g.__cdBackup) g.__cdBackup = { enabled: isConfigured(), bucket: isConfigured() ? store().label : null, restoredAt: null, restoredFrom: null, lastUploadAt: null, lastError: null, uploads: 0, notice: null };
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
    g.__cdKnownStamp = await store().stamp(KEY).catch(() => null);
    g.__cdRestoreSig = changeSignature();
    g.__cdRestoreAudit = auditMark();
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
    const st = store();
    // Another server uploaded since this one last saw the cloud copy (a deploy: the old instance's final
    // upload lands after the new one has already restored). Nothing written here yet → take that copy;
    // something written here → keep the other copy aside before this one goes up, so nothing is lost.
    if (!opts.force && (await reconcileWithRemote(st))) {
      return;
    }
    tmp = await snapshotAsync();
    const plain = fs.readFileSync(tmp);
    fs.rm(tmp, { force: true }, () => {});
    tmp = null;
    // Never replace a backup with a much smaller database: an empty or half-filled database on a fresh
    // disk must not overwrite months of data. An Admin can force it from Settings when it is intended.
    // (The copy in the store is compressed; its plain size is kept beside it. An older plain copy has none.)
    const remoteStored = await st.size(KEY);
    let remotePlain = remoteStored;
    try {
      const meta = await st.get(META_KEY);
      const parsed = meta ? (JSON.parse(meta.toString("utf8")) as { plainSize?: number }) : null;
      if (parsed?.plainSize) remotePlain = parsed.plainSize;
    } catch {
      /* no meta yet */
    }
    if (!opts.force && remotePlain && plain.length < remotePlain / 2) {
      status.lastError = `Upload skipped: the database on this server (${Math.round(plain.length / 1048576)} MB) is much smaller than the cloud backup (${Math.round(remotePlain / 1048576)} MB). If this is intended, use "Back up now (replace)" in Settings.`;
      console.error("[backup]", status.lastError);
      return;
    }
    const body = pack(plain);
    await st.put(KEY, body);
    await st.put(META_KEY, Buffer.from(JSON.stringify({ plainSize: plain.length, storedSize: body.length, at: new Date().toISOString(), reason }), "utf8")).catch(() => {});
    const day = new Date().toISOString().slice(0, 10);
    const dailyKey = `daily/${day}.db`;
    if (!(await st.exists(dailyKey))) await st.put(dailyKey, body);
    status.lastUploadAt = new Date().toISOString();
    status.lastError = null;
    status.uploads++;
    g.__cdLastSeen = changeSignature();
    g.__cdBackupWanted = null;
    g.__cdKnownStamp = await st.stamp(KEY).catch(() => null);
    console.log(`[backup] uploaded ${body.length} bytes compressed, ${plain.length} plain (${reason})`);
  } catch (e) {
    status.lastError = `Upload failed: ${e instanceof Error ? e.message : String(e)}`;
    console.error("[backup]", status.lastError);
  } finally {
    if (tmp) fs.rm(tmp, { force: true }, () => {});
    g.__cdBackupBusy = false;
  }
}

/** The cloud copy changed under us: adopt it when nothing was written here, otherwise keep it aside. Returns true when the upload must be skipped. */
async function reconcileWithRemote(st: Store): Promise<boolean> {
  const status = backupStatus();
  const known = g.__cdKnownStamp;
  if (known === undefined || known === null) return false; // nothing to compare with (fresh store)
  const now = await st.stamp(KEY).catch(() => null);
  if (!now || now === known) return false;
  // nothing done here yet: no upload of our own and no audit entry by a person since the restore (the
  // start-up housekeeping writes to the file, so the file's signature alone would say "touched")
  const untouched = status.uploads === 0 && ((g.__cdRestoreAudit !== undefined && g.__cdRestoreAudit >= 0 && auditMark() === g.__cdRestoreAudit) || (g.__cdRestoreSig !== undefined && changeSignature() === g.__cdRestoreSig));
  if (untouched) {
    const ok = await adoptRemote(st, KEY);
    if (ok) {
      status.notice = `A newer cloud copy was found at ${new Date().toISOString().slice(0, 16).replace("T", " ")} (uploaded by the previous server as it stopped) and has been taken into use – nothing had been changed here yet.`;
      console.log("[backup] newer cloud copy adopted – nothing had been written locally");
      return true;
    }
    return false;
  }
  const keep = `conflict/${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  try {
    const bytes = await st.get(KEY);
    if (bytes) {
      await st.put(keep, bytes);
      status.notice = `The cloud backup had been changed by another server after this one started; that copy was kept as ${keep} before this server's data replaced it. If anything is missing here, restore ${keep} from Settings → Database backup.`;
      console.warn(`[backup] cloud copy changed by another writer – kept as ${keep}`);
    }
  } catch (e) {
    console.error("[backup] could not keep the conflicting copy:", e instanceof Error ? e.message : String(e));
  }
  g.__cdKnownStamp = now;
  return false;
}

/** Replaces the database on this server with a copy from the store (validated), reopening it afterwards. */
async function adoptRemote(st: Store, key: string): Promise<boolean> {
  const status = backupStatus();
  try {
    const stored = await st.get(key);
    const bytes = stored ? unpack(stored) : null;
    if (!bytes || !isSqlite(bytes)) throw new Error(`${key} is not a SQLite database`);
    const file = dbPath();
    fs.writeFileSync(`${file}.incoming`, bytes);
    closeDb();
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${file}${suffix}`, { force: true });
    fs.renameSync(`${file}.incoming`, file);
    getDb();
    g.__cdKnownStamp = await st.stamp(KEY).catch(() => null);
    g.__cdRestoreSig = changeSignature();
    g.__cdRestoreAudit = auditMark();
    g.__cdLastSeen = g.__cdRestoreSig;
    status.restoredFrom = "cloud";
    status.restoredAt = new Date().toISOString();
    return true;
  } catch (e) {
    status.lastError = `Could not take the cloud copy ${key} into use: ${e instanceof Error ? e.message : String(e)}`;
    console.error("[backup]", status.lastError);
    return false;
  }
}

/** Asks for an upload at the next tick, whatever the usual gap between uploads – after an import, a lock, documents filed. */
export function requestBackup(reason: string): void {
  if (!isConfigured()) return;
  g.__cdBackupWanted = reason;
}

/** The copies in the store: the current one, the dated daily copies and any copies kept aside. */
export async function listCopies(): Promise<StoredCopy[]> {
  if (!isConfigured()) return [];
  const st = store();
  const current = await st.size(KEY);
  const out: StoredCopy[] = current ? [{ key: KEY, size: current, modified: null }] : [];
  for (const prefix of ["conflict/", "daily/"]) {
    try {
      out.push(...(await st.list(prefix)));
    } catch (e) {
      console.error(`[backup] could not list ${prefix}:`, e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}

/** A copy from the store, for downloading. */
export async function getCopy(key: string): Promise<Buffer | null> {
  if (!isConfigured()) return null;
  const stored = await store().get(key);
  return stored ? unpack(stored) : null;
}

/**
 * Restores a copy from the store over the database on this server (Admin, on purpose). The database
 * as it stands is first uploaded as conflict/before-restore-….db, so the step can be undone.
 */
export async function restoreCopy(key: string): Promise<{ keptAs: string }> {
  if (!isConfigured()) throw new Error("Cloud backup is not set up.");
  const st = store();
  const keptAs = `conflict/before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  const tmp = await snapshotAsync();
  try {
    await st.put(keptAs, pack(fs.readFileSync(tmp)));
  } finally {
    fs.rm(tmp, { force: true }, () => {});
  }
  const ok = await adoptRemote(st, key);
  if (!ok) throw new Error(backupStatus().lastError ?? "The copy could not be restored.");
  backupStatus().notice = `Restored ${key}; the database as it was before is kept as ${keptAs}.`;
  await backupNow("restore", { force: true });
  return { keptAs };
}

/** Starts the periodic upload loop and the shutdown hook (once per process). */
export function startBackupLoop(): void {
  if (!isConfigured() || g.__cdBackupTimer) return;
  g.__cdLastSeen = changeSignature();
  const startedAt = Date.now();
  g.__cdBackupTimer = setInterval(() => {
    // in the minutes after a start, watch for the previous server's final upload even when nothing
    // has been written here: it is taken into use while this server is still untouched
    if (Date.now() - startedAt < STARTUP_WATCH_MS && !g.__cdBackupBusy) {
      g.__cdBackupBusy = true;
      void reconcileWithRemote(store())
        .catch((e) => console.error("[backup] start-up check failed:", e instanceof Error ? e.message : String(e)))
        .finally(() => {
          g.__cdBackupBusy = false;
        });
      return;
    }
    const sig = changeSignature();
    if (sig === g.__cdLastSeen) return;
    // not while an import is writing (its result goes up once it is done), and not more than every few minutes
    const running = currentImportTrace();
    if (running && running.status === "running") return;
    const last = backupStatus().lastUploadAt ? Date.parse(backupStatus().lastUploadAt!) : 0;
    if (!g.__cdBackupWanted && Date.now() - last < MIN_UPLOAD_GAP_MS) return;
    void backupNow(g.__cdBackupWanted ?? "changed");
  }, INTERVAL_MS);
  g.__cdBackupTimer.unref();
  const onExit = (signal: string) => {
    console.log(`[backup] ${signal} received – final upload${process.env.NEXT_MANUAL_SIG_HANDLE ? "" : " (NEXT_MANUAL_SIG_HANDLE is not set: the framework may stop the process before the upload is through)"}`);
    const running = currentImportTrace();
    if (running && running.status === "running") putTraceSync({ ...running, ended: `${signal} received by the process while the import was running (the host stopped the instance – a restart, a deploy, or a failed health check)` });
    const done = backupNow("shutdown")
      .then(() => console.log("[backup] final upload done"))
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 25_000).unref();
    void done;
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
