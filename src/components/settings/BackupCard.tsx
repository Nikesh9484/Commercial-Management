"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, Download, DatabaseBackup, History, RotateCcw } from "lucide-react";
import type { BackupStatus, StoredCopy } from "@/lib/cloud-backup";
import { formatDateTime } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";

export function BackupCard({ status }: { status: BackupStatus }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copies, setCopies] = useState<StoredCopy[] | null>(null);
  const [showCopies, setShowCopies] = useState(false);
  async function loadCopies() {
    const res = await fetch("/api/backup/copies", { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    setCopies(Array.isArray(j.copies) ? j.copies : []);
  }
  /* eslint-disable react-hooks/set-state-in-effect -- the list is fetched when the section is opened */
  useEffect(() => {
    if (showCopies && copies === null) void loadCopies();
  }, [showCopies, copies]);
  /* eslint-enable react-hooks/set-state-in-effect */
  async function restore(key: string) {
    if (!confirm(`Restore ${key} over the database on this server?\n\nEverything entered since that copy was taken is replaced by the copy. The database as it stands now is uploaded first as a "before-restore" copy, so this can be undone from the same list.`)) return;
    setBusy(true);
    const res = await fetch("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(j.error ?? "Restore failed.", "error");
    toast(`Restored ${key}. The previous database is kept as ${j.keptAs}.`);
    setCopies(null);
    router.refresh();
  }
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  const describe = (key: string) => (key.startsWith("daily/") ? `Daily copy – first upload of ${key.slice(6, 16)}` : key.startsWith("conflict/before-restore-") ? "Kept before a restore" : key.startsWith("conflict/") ? "Kept aside – uploaded by another server while this one ran" : "Current cloud backup");
  async function run(force = false) {
    if (force && !confirm("Replace the cloud backup with the database on this server, even if it is smaller? Only do this when you are sure the data here is the right data.")) return;
    setBusy(true);
    const res = await fetch(`/api/backup${force ? "?force=1" : ""}`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(j.error ?? "Backup failed.", "error");
    toast("Backup uploaded.");
    router.refresh();
  }
  return (
    <div className="card p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <DatabaseBackup size={18} className="text-navy" /> Database backup
        </h2>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-secondary btn-sm" href="/api/backup">
            <Download size={14} /> Download database
          </a>
          {status.enabled && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => run(false)} disabled={busy}>
                <CloudUpload size={14} /> {busy ? "Uploading…" : "Back up to cloud now"}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => run(true)} disabled={busy} title="Replaces the cloud backup even when the database here is much smaller than it">
                Back up now (replace)
              </button>
            </>
          )}
        </div>
      </div>
      {status.enabled ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Chip tone={status.lastError ? "red" : status.lastUploadAt ? "green" : "amber"}>{status.lastError ? "Error" : status.lastUploadAt ? "Cloud backup on" : "Cloud backup on – nothing uploaded yet"}</Chip>
          <span>Storage: {status.bucket}</span>
          {status.lastUploadAt && <span>· last upload {formatDateTime(status.lastUploadAt)} ({status.uploads} this session)</span>}
          {status.restoredFrom && <span>· started from {status.restoredFrom === "cloud" ? "the cloud backup" : status.restoredFrom === "local" ? "the local file" : "a fresh database"}</span>}
          {status.lastError && <span className="text-red-700">· {status.lastError}</span>}
        </div>
      ) : (
        <p className="text-xs text-muted">
          Cloud backup is off (no BACKUP_GITHUB_* or BACKUP_S3_* settings). The database is the file <code>data/commercial.db</code>; use <em>Download database</em> to keep a copy. On a hosting service, set the backup settings so the database survives restarts.
        </p>
      )}
      {status.notice && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{status.notice}</p>}
      <p className="mt-2 text-xs text-muted">Changes are uploaded within about 20 seconds (straight away after an import, a lock or documents filed), plus one dated copy per day. When the host restarts the server on a fresh disk, the last cloud copy is restored; if the previous server uploads a newer copy as it stops, that copy is taken into use – or kept aside under conflict/ if work had already started here.</p>
      {status.enabled && (
        <div className="mt-3">
          <button className="btn btn-secondary btn-sm" onClick={() => setShowCopies((v) => !v)}>
            <History size={14} /> {showCopies ? "Hide the backup copies" : "Backup copies – view, download or restore"}
          </button>
          {showCopies && (
            <div className="mt-2 overflow-x-auto">
              {copies === null ? (
                <p className="text-xs text-muted">Loading…</p>
              ) : copies.length === 0 ? (
                <p className="text-xs text-muted">No copies in the store yet.</p>
              ) : (
                <table className="data compact w-full">
                  <thead>
                    <tr>
                      <th>Copy</th>
                      <th>What it is</th>
                      <th className="text-right">Size</th>
                      <th>Uploaded</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {copies.map((c) => (
                      <tr key={c.key}>
                        <td className="font-mono text-xs">{c.key}</td>
                        <td className="text-xs text-muted">{describe(c.key)}</td>
                        <td className="text-right tnum">{mb(c.size)}</td>
                        <td className="text-xs">{c.modified ? formatDateTime(c.modified) : "–"}</td>
                        <td className="text-right">
                          <a className="btn btn-ghost btn-sm" href={`/api/backup/copy?key=${encodeURIComponent(c.key)}`} title="Download this copy">
                            <Download size={13} />
                          </a>
                          <button className="btn btn-ghost btn-sm" onClick={() => restore(c.key)} disabled={busy} title="Put this copy in place of the database on this server (the current one is kept aside first)">
                            <RotateCcw size={13} /> Restore
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
