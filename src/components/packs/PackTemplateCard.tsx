"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, FileUp, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Chip } from "@/components/ui/Chip";
import { formatDate } from "@/lib/format";
import type { TemplateInspection } from "@/lib/packs/shared";
import { DropZone } from "@/components/ui/DropZone";

interface Field {
  key: string;
  label: string;
  group: string;
  auto: boolean;
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** The RSG Word template of one category: upload it once, see which of its cells the dashboard will fill. */
export function PackTemplateCard({ type, template, inspection, canManage }: { type: { key: string; label: string; short: string; formRef: string; fields: Field[] }; template: { id: number; name: string; size: number; created_at: string; created_by: string } | null; inspection: TemplateInspection | null; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const matched = inspection?.labels.filter((l) => l.field) ?? [];
  const unmatchedLabels = inspection?.labels.filter((l) => !l.field) ?? [];
  const byKey = new Map(type.fields.map((f) => [f.key, f]));

  async function upload(list: FileList | File[] | null) {
    const f = list?.[0];
    if (!f) return;
    setBusy(true);
    const CHUNK = 256 * 1024;
    const count = Math.max(1, Math.ceil(f.size / CHUNK));
    let uploadId = "";
    try {
      for (let i = 0; i < count; i++) {
        const data = await toBase64(f.slice(i * CHUNK, (i + 1) * CHUNK));
        const res = await fetch("/api/packs/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, packType: type.key, name: f.name, mime: f.type, size: f.size, index: i, count, data }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? "upload failed");
        uploadId = j.uploadId ?? uploadId;
        if (j.template) toast(`${f.name} is now the ${type.short} template – ${j.inspection?.placeholders?.length ?? 0} placeholders and ${(j.inspection?.labels ?? []).filter((l: { field: string | null }) => l.field).length} labelled cells will be filled.`);
      }
      router.refresh();
    } catch (e) {
      toast(`${f.name}: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!template || !confirm(`Remove the ${type.short} template ${template.name}? The built-in layout is used until a new one is uploaded.`)) return;
    const res = await fetch(`/api/packs/templates/${template.id}`, { method: "DELETE" });
    if (!res.ok) return toast("Could not remove the template.", "error");
    router.refresh();
  }

  return (
    <DropZone onFiles={(files) => void upload(files)} disabled={!canManage || busy} label="Drop the RSG template here (Excel, Word or PDF)" className="card p-4 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">RSG template · {type.formRef}</div>
          {template ? (
            <div className="mt-1 text-sm font-semibold text-ink">{template.name}</div>
          ) : (
            <div className="mt-1 text-sm font-semibold text-ink">No template uploaded – upload the RSG form as an Excel workbook (every tab is kept), a Word file, or the last approved pack as a PDF</div>
          )}
          {template && (
            <div className="text-muted">
              {(template.size / 1024).toFixed(0)} KB · uploaded {formatDate(template.created_at)} by {template.created_by} · {/\.(xlsx|xlsm|xltx|xltm)$/i.test(template.name) ? "Excel workbook – every pack is written into a copy of it, all tabs kept" : /\.pdf$/i.test(template.name) ? "PDF – read as the last approved pack for every new pack that has none of its own, and its form pages carry the new values" : /\.(docx|dotx|docm)$/i.test(template.name) ? "Word file – every pack is written into a copy of it" : "kept for reference – the built-in layout is used"}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {template && (
            <a className="btn btn-xs btn-secondary" href={`/api/packs/templates/${template.id}`} title="Download the template as uploaded">
              <Download size={12} /> Download
            </a>
          )}
          {canManage && (
            <>
              <input ref={input} type="file" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
              <button className="btn btn-xs btn-primary" onClick={() => input.current?.click()} disabled={busy}>
                <FileUp size={12} /> {busy ? "Uploading…" : template ? "Replace template" : "Upload RSG template (Excel, Word or PDF)"}
              </button>
              {template && (
                <button className="btn btn-xs btn-ghost text-red-700" onClick={remove} title="Remove the template">
                  <Trash2 size={12} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {template && inspection && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="green">
              <CheckCircle2 size={11} className="mr-1" /> {matched.length} labelled cells matched
            </Chip>
            <Chip tone={inspection.placeholders.length ? "green" : "grey"}>{inspection.placeholders.length} {"{{placeholders}}"}</Chip>
            <Chip tone={inspection.unmatched.length ? "amber" : "green"}>{inspection.unmatched.length} fields not in the template</Chip>
          </div>
          {matched.length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted">Cells the dashboard fills (label in the template → field)</summary>
              <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                {matched.map((l) => (
                  <li key={l.label} className="truncate" title={`${l.label} → ${byKey.get(l.field!)?.label ?? l.field}`}>
                    <span className="text-ink">{l.label}</span> <span className="text-muted">→ {byKey.get(l.field!)?.label ?? l.field}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {unmatchedLabels.length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted">Blank cells the dashboard could not name ({unmatchedLabels.length}) – add a {"{{key}}"} placeholder in the template to fill them</summary>
              <div className="mt-1 text-muted">{unmatchedLabels.map((l) => l.label).join(" · ")}</div>
            </details>
          )}
          {inspection.unmatched.length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted">Fields with nowhere to go in the template ({inspection.unmatched.length})</summary>
              <div className="mt-1 text-muted">{inspection.unmatched.map((k) => `${byKey.get(k)?.label ?? k} → {{${k}}}`).join(" · ")}</div>
            </details>
          )}
        </div>
      )}
      <div className="mt-3 border-t border-line pt-2 text-muted">
        <button className="text-accent hover:underline" onClick={() => setShowFields((v) => !v)}>
          {showFields ? "Hide" : "Show"} the field keys for this form
        </button>
        <span className="ml-1">– write {"{{key}}"} in any cell of the RSG template, or leave the form as it is: the cell beside a label (beneath it for a paragraph) is filled by the label&apos;s wording, the item rows, the signatory rows and every tab are recognised, and cells holding formulas are left to work themselves out.</span>
        {showFields && (
          <table className="mt-2 w-full text-[11px]">
            <tbody>
              {type.fields.map((f) => (
                <tr key={f.key} className="border-t border-line">
                  <td className="py-0.5 pr-2 text-ink">{f.label}</td>
                  <td className="py-0.5 pr-2 font-mono">{`{{${f.key}}}`}</td>
                  <td className="py-0.5 text-muted">{f.auto ? "from the registers" : "typed on the pack"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </DropZone>
  );
}
