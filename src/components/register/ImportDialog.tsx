"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Download, Upload } from "lucide-react";

interface Result {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export function ImportDialog({ registerKey, title, open, onClose, onDone }: { registerKey: string; title: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/registers/${registerKey}/import`, { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error ?? "Import failed.");
    setResult(j);
    onDone();
  }

  function close() {
    setFile(null);
    setResult(null);
    setError(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      title={`Import ${title} from Excel`}
      onClose={close}
      footer={
        <>
          <button className="btn btn-secondary" onClick={close}>
            Close
          </button>
          <button className="btn btn-primary" onClick={run} disabled={!file || busy}>
            <Upload size={16} /> {busy ? "Importing…" : "Import"}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          <li>
            Download the{" "}
            <a className="inline-flex items-center gap-1 font-medium text-accent hover:underline" href={`/api/registers/${registerKey}/template`}>
              <Download size={14} /> blank template
            </a>{" "}
            or an export of this register.
          </li>
          <li>Fill in one record per row. Leave ID blank for new records; keep the ID to update an existing one.</li>
          <li>Save as .xlsx and choose the file below.</li>
        </ol>
        <input type="file" accept=".xlsx" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        {result && (
          <div className="rounded-md border border-line bg-page p-3">
            <div className="font-medium text-ink">
              Done: {result.created} added, {result.updated} updated, {result.unchanged} unchanged, {result.skipped} empty row(s) skipped, {result.errors.length} error(s).
            </div>
            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-red-700">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
