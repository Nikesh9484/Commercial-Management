"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, Download, DatabaseBackup } from "lucide-react";
import type { BackupStatus } from "@/lib/cloud-backup";
import { formatDateTime } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";

export function BackupCard({ status }: { status: BackupStatus }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const res = await fetch("/api/backup", { method: "POST" });
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
            <button className="btn btn-primary btn-sm" onClick={run} disabled={busy}>
              <CloudUpload size={14} /> {busy ? "Uploading…" : "Back up to cloud now"}
            </button>
          )}
        </div>
      </div>
      {status.enabled ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Chip tone={status.lastError ? "red" : status.lastUploadAt ? "green" : "amber"}>{status.lastError ? "Error" : status.lastUploadAt ? "Cloud backup on" : "Cloud backup on – nothing uploaded yet"}</Chip>
          <span>Bucket: {status.bucket}</span>
          {status.lastUploadAt && <span>· last upload {formatDateTime(status.lastUploadAt)} ({status.uploads} this session)</span>}
          {status.restoredFrom && <span>· started from {status.restoredFrom === "cloud" ? "the cloud backup" : status.restoredFrom === "local" ? "the local file" : "a fresh database"}</span>}
          {status.lastError && <span className="text-red-700">· {status.lastError}</span>}
        </div>
      ) : (
        <p className="text-xs text-muted">
          Cloud backup is off (no BACKUP_S3_* settings). The database is the file <code>data/commercial.db</code>; use <em>Download database</em> to keep a copy. On a hosting service, set the BACKUP_S3_* settings so the database survives restarts.
        </p>
      )}
      <p className="mt-2 text-xs text-muted">Changes are uploaded within about 20 seconds, plus one dated copy per day. To restore, place the downloaded file at data/commercial.db (or upload it to the bucket as commercial.db) and restart the app.</p>
    </div>
  );
}
