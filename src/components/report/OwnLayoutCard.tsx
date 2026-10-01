"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/**
 * The month's report in the project's own workbook: the same tabs, formulas and formatting as the file
 * that was uploaded, with this month's registers written into it. The template is the last report
 * workbook imported, or one uploaded here.
 */
export function OwnLayoutCard({ periodId, periodLabel, template, canUpload }: { periodId: number; periodLabel: string; template: { name: string; uploaded_at: string; uploaded_by: string } | null; canUpload: boolean }) {
  const [busy, setBusy] = useState("");
  const [tpl, setTpl] = useState(template);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function upload(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    const CHUNK = 256 * 1024;
    const count = Math.max(1, Math.ceil(f.size / CHUNK));
    let uploadId = "";
    setBusy(`Uploading ${f.name}…`);
    try {
      for (let i = 0; i < count; i++) {
        const data = await toBase64(f.slice(i * CHUNK, (i + 1) * CHUNK));
        const res = await fetch("/api/report/own-layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, name: f.name, index: i, count, data }) });
        const j = (await res.json()) as { error?: string; uploadId?: string; template?: { name: string; uploaded_at: string; uploaded_by: string } };
        if (!res.ok) throw new Error(j.error || "Upload failed.");
        uploadId = j.uploadId ?? uploadId;
        if (j.template) setTpl(j.template);
      }
      toast(`${f.name} is now the report template.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong.", "error");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <FileSpreadsheet size={16} className="text-green-700" /> Your report workbook – same layout as uploaded
          </div>
          <div className="mt-1 text-xs text-muted">
            {periodLabel} written into {tpl ? <b>{tpl.name}</b> : "your last report workbook"}: the same tabs, formulas and formatting, with this month&apos;s changes, bonds &amp; insurance, payments, transfers and provisional sums in their own cells. New entries get their own rows; every total recalculates when the file opens.
          </div>
          <div className="mt-1 text-xs text-muted">{tpl ? `Template: ${tpl.name} (kept ${tpl.uploaded_at.slice(0, 10)} by ${tpl.uploaded_by}). Each monthly workbook imported replaces it.` : "No template yet – upload your last report workbook below, or import a month (the imported workbook is kept)."}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a className={`btn btn-sm btn-excel ${tpl ? "" : "pointer-events-none opacity-50"}`} href={`/api/report/own-layout?period=${periodId}`} title="Download the month's report in your own workbook layout">
            <FileSpreadsheet size={14} /> Download report workbook
          </a>
          {canUpload && (
            <>
              <input ref={fileRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => upload(e.target.files)} />
              <button className="btn btn-sm btn-secondary" disabled={!!busy} onClick={() => fileRef.current?.click()} title="Upload the last report workbook as the template">
                <Upload size={14} /> {tpl ? "Replace template" : "Upload template"}
              </button>
            </>
          )}
          {busy && <span className="text-xs text-muted">{busy}</span>}
        </div>
      </div>
    </div>
  );
}
