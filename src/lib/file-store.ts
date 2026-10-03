import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { backupStore, provider } from "./cloud-backup";
import { getDb } from "./db";

/**
 * The uploaded files that live beside the database – pack documents and templates, KPI documents,
 * the report workbooks – kept in the same cloud backup as the database. A hosting plan without a
 * disk of its own loses the data folder at every deploy or restart; the database comes back from the
 * backup, and so must every file the database refers to. A file is sent to the store when it is
 * written, removed from it when it is deleted, fetched back when it is read and found missing, and
 * everything the database knows of is fetched in the background when the server starts.
 */
/** The largest file the backup store takes: GitHub's contents API stops at 100 MB, a bucket takes far more. */
export function backupFileLimit(): number | null {
  const p = provider();
  if (!p) return null;
  return p === "github" ? 95 * 1024 * 1024 : 2 * 1024 * 1024 * 1024;
}

export function dataDir(): string {
  return process.env.DATA_DIR || (process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(process.cwd(), "data"));
}
/** the store key of a file under the data folder: files/packs/7/11-name.pdf */
export function keyOf(absPath: string): string | null {
  const rel = path.relative(dataDir(), absPath).split(path.sep).join("/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return `files/${rel}`;
}

type Job = { key: string; abs: string | null };
const queue: Job[] = [];
let running = false;
async function drain() {
  if (running) return;
  running = true;
  try {
    const store = backupStore();
    while (queue.length) {
      const job = queue.shift()!;
      if (!store) continue;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (job.abs) {
            if (!fs.existsSync(job.abs)) break;
            const bytes = fs.readFileSync(job.abs);
            if (bytes.length > (backupFileLimit() ?? Infinity)) {
              console.warn(`[files] ${job.key} is ${Math.round(bytes.length / 1048576)} MB – too large for the backup store, kept on this server only`);
              break;
            }
            await store.put(job.key, bytes);
          } else await store.del(job.key);
          break;
        } catch (e) {
          console.error(`[files] ${job.abs ? "upload" : "removal"} of ${job.key} failed (attempt ${attempt}):`, e instanceof Error ? e.message : e);
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
    }
  } finally {
    running = false;
  }
}

/** A file just written under the data folder: sent to the backup store in the background. */
export function keepFile(absPath: string): void {
  const key = keyOf(absPath);
  if (!key || !backupStore()) return;
  queue.push({ key, abs: absPath });
  void drain();
}
/** A file just deleted: removed from the backup store in the background. */
export function dropFile(absPath: string): void {
  const key = keyOf(absPath);
  if (!key || !backupStore()) return;
  queue.push({ key, abs: null });
  void drain();
}

/**
 * A file the database refers to but the disk has lost: fetched from the backup store, in a child
 * process so the (synchronous) readers can wait for it. True when the file is on disk afterwards.
 */
export function restoreFileSync(absPath: string): boolean {
  if (fs.existsSync(absPath)) return true;
  const key = keyOf(absPath);
  if (!key || !backupStore()) return false;
  const script = path.join(process.cwd(), "scripts", "fetch-file.cjs");
  if (!fs.existsSync(script)) return false;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const r = spawnSync(process.execPath, [script, key, absPath], { timeout: 120_000, env: process.env, encoding: "utf8" });
  if (r.status === 0 && fs.existsSync(absPath)) {
    console.log(`[files] ${key} restored from the backup store`);
    return true;
  }
  if (r.status !== 2) console.error(`[files] ${key} could not be restored:`, (r.stderr || r.stdout || "").toString().trim().slice(0, 300));
  return false;
}

/** Every file the database refers to and the disk lacks, fetched in the background after the server starts. */
export async function restoreMissingAtStart(): Promise<void> {
  const store = backupStore();
  if (!store) return;
  const db = getDb();
  const paths: string[] = [];
  const table = (name: string) => (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) ? true : false);
  const base = dataDir();
  if (table("pack_docs")) for (const r of db.prepare("SELECT disk_path FROM pack_docs").all() as { disk_path: string }[]) if (r.disk_path) paths.push(path.join(base, "packs", r.disk_path));
  if (table("pack_templates")) for (const r of db.prepare("SELECT disk_path FROM pack_templates").all() as { disk_path: string }[]) if (r.disk_path) paths.push(path.join(base, "packs", r.disk_path));
  if (table("kpi_docs")) for (const r of db.prepare("SELECT disk_path FROM kpi_docs").all() as { disk_path: string }[]) if (r.disk_path) paths.push(path.join(base, "kpi", r.disk_path));
  if (table("report_templates")) for (const r of db.prepare("SELECT path FROM report_templates").all() as { path: string }[]) if (r.path) paths.push(path.isAbsolute(r.path) ? r.path : path.join(base, r.path));
  const missing = paths.filter((p) => !fs.existsSync(p));
  if (!missing.length) return;
  console.log(`[files] ${missing.length} uploaded file(s) are not on this disk – fetching them from the backup store`);
  let ok = 0;
  for (const abs of missing) {
    const key = keyOf(abs);
    if (!key) continue;
    try {
      const bytes = await store.get(key);
      if (!bytes) {
        console.warn(`[files] ${key} is not in the backup store either (uploaded before files were backed up) – upload it again`);
        continue;
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bytes);
      ok++;
    } catch (e) {
      console.error(`[files] ${key} could not be fetched:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`[files] ${ok} of ${missing.length} file(s) restored`);
}

/** Every file on this disk that the store lacks, sent up once (files uploaded before the store existed). */
export async function uploadUnsentAtStart(): Promise<void> {
  const store = backupStore();
  if (!store) return;
  const db = getDb();
  if (db.prepare("SELECT value FROM app_settings WHERE key = 'files_synced'").get()) return;
  const base = dataDir();
  const walk = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
  const files = [...walk(path.join(base, "packs")), ...walk(path.join(base, "kpi")), ...walk(path.join(base, "report-templates"))];
  let sent = 0;
  for (const abs of files) {
    const key = keyOf(abs);
    if (!key) continue;
    try {
      if (await store.exists(key)) continue;
      const bytes = fs.readFileSync(abs);
      if (bytes.length > (backupFileLimit() ?? Infinity)) continue;
      await store.put(key, bytes);
      sent++;
    } catch (e) {
      console.error(`[files] ${key} could not be sent:`, e instanceof Error ? e.message : e);
      return; // try again at the next start
    }
  }
  db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES('files_synced', ?)").run(new Date().toISOString());
  if (sent) console.log(`[files] ${sent} file(s) sent to the backup store`);
}
