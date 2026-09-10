"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderUp, FileUp, Trash2, Download, Sparkles, Loader2, AlertTriangle, CheckCircle2, FileText, Save, KeyRound, Eraser } from "lucide-react";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";
import type { ChipTone } from "@/lib/registers/types";
import { fmtBytes } from "./EarCaseList";

/* Mirrors src/lib/ear/store.ts (kept here so the browser bundle stays free of server code). */
type Bucket = "submission" | "template" | "contract" | "prev_ear" | "prev_submission";
const BUCKETS: { key: Bucket; title: string; hint: string; revisedOnly?: boolean; single?: boolean; step: number }[] = [
  { key: "submission", step: 1, title: "Contractor's claim & supporting documents", hint: "The whole claim folder: narrative, notices, programmes (XER), delay analysis, cost build-ups, correspondence, photos – any file type." },
  { key: "template", step: 2, title: "EAR template (Word or PDF)", hint: "Your Employer's Assessment Report template. Its headings, order and wording drive the structure of the report.", single: true },
  { key: "contract", step: 3, title: "Contract documents", hint: "The whole contract folder: conditions of contract, particular conditions, specifications, programme requirements – any file type." },
  { key: "prev_ear", step: 4, title: "Previous EAR issued by the Employer", hint: "The report issued for the previous submission. The revised EAR is written on top of it, with every difference as a tracked change by “Commercial Manager”.", revisedOnly: true, single: true },
  { key: "prev_submission", step: 5, title: "Contractor's previous submission", hint: "The earlier submission, so the report sets out exactly what the Contractor changed in the revision.", revisedOnly: true },
];

export interface CaseInfo {
  id: number;
  title: string;
  contractor: string;
  contract_no: string;
  claim_ref: string;
  submission_ref: string;
  submission_date: string;
  revised: number;
  revision_no: number;
  status: string;
  output_name: string | null;
  generated_at: string | null;
  generation_note: string | null;
}
export interface FileInfo {
  id: number;
  bucket: Bucket;
  rel_path: string;
  size: number;
  kind: string;
  text_chars: number;
  note: string | null;
}

const KIND_TONE: Record<string, ChipTone> = { pdf: "red", word: "blue", excel: "green", text: "grey", image: "amber", other: "grey" };
const KIND_LABEL: Record<string, string> = { pdf: "PDF", word: "Word", excel: "Excel", text: "Text", image: "Image", other: "File" };

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("Could not read the file."));
    r.readAsDataURL(blob);
  });
}

export function EarWorkspace({ initial, files: initialFiles, engine, canEdit }: { initial: CaseInfo; files: FileInfo[]; engine: boolean; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [c, setC] = useState(initial);
  const [form, setForm] = useState({ title: initial.title, contractor: initial.contractor, contract_no: initial.contract_no, claim_ref: initial.claim_ref, submission_ref: initial.submission_ref, submission_date: initial.submission_date, revised: !!initial.revised, revision_no: initial.revision_no || 1 });
  const [files, setFiles] = useState(initialFiles);
  const [progress, setProgress] = useState<{ bucket: Bucket; text: string } | null>(null);
  const [generating, setGenerating] = useState(c.status === "Generating");
  const [saving, setSaving] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const dirty = form.title !== c.title || form.contractor !== c.contractor || form.contract_no !== c.contract_no || form.claim_ref !== c.claim_ref || form.submission_ref !== c.submission_ref || form.submission_date !== c.submission_date || form.revised !== !!c.revised || (form.revised && form.revision_no !== c.revision_no);

  async function save() {
    setSaving(true);
    const r = await fetch(`/api/ear/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return toast(j.error ?? "Could not save.", "error");
    setC(j.case);
    toast("Case details saved.");
    router.refresh();
  }

  async function upload(bucket: Bucket, list: FileList | null) {
    if (!list || !list.length) return;
    const picked = Array.from(list).filter((f) => !/^(\.|~\$|thumbs\.db$|desktop\.ini$)/i.test(f.name));
    if (!picked.length) return toast("No usable files were selected.", "error");
    const CHUNK = 256 * 1024;
    let added = 0;
    for (let n = 0; n < picked.length; n++) {
      const f = picked[n];
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const count = Math.max(1, Math.ceil(f.size / CHUNK));
      let uploadId = "";
      let ok = true;
      for (let i = 0; i < count; i++) {
        setProgress({ bucket, text: `Uploading ${n + 1} of ${picked.length}: ${rel}${count > 1 ? ` (part ${i + 1} of ${count})` : ""}` });
        const data = await toBase64(f.slice(i * CHUNK, (i + 1) * CHUNK));
        let j: { error?: string; uploadId?: string; file?: FileInfo } = {};
        try {
          const r = await fetch(`/api/ear/${c.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, bucket, name: f.name, relPath: rel, mime: f.type, size: f.size, index: i, count, data }) });
          j = await r.json().catch(() => ({}));
          if (!r.ok) {
            toast(`${rel}: ${j.error ?? "upload failed"}`, "error");
            ok = false;
            break;
          }
        } catch (e) {
          toast(`${rel}: ${e instanceof Error ? e.message : String(e)}`, "error");
          ok = false;
          break;
        }
        uploadId = j.uploadId ?? uploadId;
        if (j.file) {
          const file = j.file;
          setFiles((cur) => [...cur.filter((x) => !(BUCKETS.find((b) => b.key === bucket)?.single && x.bucket === bucket)), file]);
          added++;
        }
      }
      if (!ok) continue;
    }
    setProgress(null);
    if (added) toast(`${added} document${added === 1 ? "" : "s"} added.`);
    router.refresh();
  }

  async function removeAll(bucket: Bucket, title: string, count: number) {
    if (!confirm(`Remove all ${count} document${count === 1 ? "" : "s"} from "${title}"? They are deleted from the server; you can upload the folder again afterwards.`)) return;
    const r = await fetch(`/api/ear/${c.id}/files?bucket=${bucket}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast(j.error ?? "Could not remove the documents.", "error");
    setFiles((cur) => cur.filter((x) => x.bucket !== bucket));
    toast(`${j.removed} document${j.removed === 1 ? "" : "s"} removed.`);
    router.refresh();
  }

  async function remove(f: FileInfo) {
    if (!confirm(`Remove ${f.rel_path} from the case?`)) return;
    const r = await fetch(`/api/ear/${c.id}/files/${f.id}`, { method: "DELETE" });
    if (!r.ok) return toast("Could not remove the document.", "error");
    setFiles((cur) => cur.filter((x) => x.id !== f.id));
  }

  async function generate() {
    if (dirty) await save();
    setGenerating(true);
    setC((cur) => ({ ...cur, status: "Generating" }));
    try {
      const r = await fetch(`/api/ear/${c.id}/generate`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setC((cur) => ({ ...cur, status: "Failed", generation_note: j.error ?? "Failed" }));
        return toast(j.error ?? "Could not create the report.", "error");
      }
      setC(j.case);
      toast(c.revised ? "Revised EAR created with tracked changes." : "EAR created.");
      router.refresh();
    } catch (e) {
      setC((cur) => ({ ...cur, status: "Failed", generation_note: e instanceof Error ? e.message : String(e) }));
      toast("The connection dropped while the report was being written. Reload the page in a minute – the report may still have been saved.", "error");
    } finally {
      setGenerating(false);
    }
  }

  const has = (b: Bucket) => files.some((f) => f.bucket === b);
  const ready = has("submission") && (!form.revised || has("prev_ear"));
  const visible = BUCKETS.filter((b) => !b.revisedOnly || form.revised);
  const totalBytes = files.reduce((a, f) => a + f.size, 0);

  return (
    <div className="space-y-5">
      {!engine && (
        <div className="card flex items-start gap-3 border-l-4 border-l-amber-500 p-4 text-sm">
          <KeyRound size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <b>Drafting engine not configured.</b> Documents can be uploaded and a skeleton EAR laid out from your template, but the full assessment is written only when the server has an <code>ANTHROPIC_API_KEY</code> (Render → Environment). Ask the administrator to add it, then press Create EAR again.
          </div>
        </div>
      )}

      {/* Case details */}
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <FileText size={16} /> Case details
          </h2>
          <div className="flex items-center gap-2">
            {c.revised ? <Chip tone="blue">Revised submission · Rev {c.revision_no}</Chip> : <Chip tone="grey">Original submission</Chip>}
            {canEdit && (
              <button className="btn btn-secondary btn-sm" onClick={save} disabled={!dirty || saving}>
                <Save size={14} /> {saving ? "Saving…" : "Save details"}
              </button>
            )}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["title", "Case title"],
              ["contractor", "Contractor"],
              ["contract_no", "Contract No"],
              ["claim_ref", "Claim reference"],
              ["submission_ref", "Contractor's submission ref"],
              ["submission_date", "Submission date"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1 text-xs text-muted">
              {label}
              <input type={k === "submission_date" ? "date" : "text"} className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} disabled={!canEdit} />
            </label>
          ))}
          <label className="flex items-center gap-2 pt-5 text-sm text-ink">
            <input type="checkbox" checked={form.revised} onChange={(e) => setForm({ ...form, revised: e.target.checked, revision_no: Math.max(1, form.revision_no) })} disabled={!canEdit} /> This is a revised submission
          </label>
          {form.revised && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Revision number
              <input className="input" inputMode="numeric" value={form.revision_no} onChange={(e) => setForm({ ...form, revision_no: Number(e.target.value.replace(/\D/g, "")) || 1 })} disabled={!canEdit} />
            </label>
          )}
        </div>
      </div>

      {/* Document groups */}
      <div className="grid gap-4 lg:grid-cols-2">
        {visible.map((b) => {
          const list = files.filter((f) => f.bucket === b.key);
          const busy = progress?.bucket === b.key;
          return (
            <div key={b.key} className={`card p-5 ${b.key === "submission" || b.key === "contract" ? "lg:col-span-2" : ""}`}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-navy text-xs text-white">{b.step}</span> {b.title}
                  {list.length > 0 && <Chip tone="green">{list.length}</Chip>}
                </h2>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    {!b.single && (
                      <button className="btn btn-primary btn-sm" onClick={() => inputs.current[`${b.key}-dir`]?.click()} disabled={!!progress}>
                        <FolderUp size={14} /> Upload folder
                      </button>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={() => inputs.current[`${b.key}-files`]?.click()} disabled={!!progress}>
                      <FileUp size={14} /> {b.single ? "Choose file" : "Add files"}
                    </button>
                    {list.length > 0 && (
                      <button className="btn btn-ghost btn-sm text-red-600" onClick={() => removeAll(b.key, b.title, list.length)} disabled={!!progress} title={`Remove all ${list.length} documents in this group`}>
                        <Eraser size={14} /> Remove all
                      </button>
                    )}
                    <input
                      ref={(el) => {
                        inputs.current[`${b.key}-dir`] = el;
                      }}
                      type="file"
                      multiple
                      className="hidden"
                      {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                      onChange={(e) => {
                        upload(b.key, e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <input
                      ref={(el) => {
                        inputs.current[`${b.key}-files`] = el;
                      }}
                      type="file"
                      multiple={!b.single}
                      className="hidden"
                      onChange={(e) => {
                        upload(b.key, e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </div>
                )}
              </div>
              <p className="mb-3 text-xs text-muted">{b.hint}</p>
              {busy && (
                <div className="mb-2 flex items-center gap-2 text-xs text-navy">
                  <Loader2 size={14} className="animate-spin" /> {progress!.text}
                </div>
              )}
              {list.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-muted">{b.single ? "No file yet." : "No documents yet – upload the whole folder; sub-folders are kept."}</div>
              ) : (
                <ul className="max-h-72 divide-y divide-line overflow-y-auto text-sm">
                  {list.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 py-1.5">
                      <Chip tone={KIND_TONE[f.kind] ?? "grey"}>{KIND_LABEL[f.kind] ?? f.kind}</Chip>
                      <a href={`/api/ear/${c.id}/files/${f.id}`} className="min-w-0 flex-1 truncate hover:underline" title={f.rel_path}>
                        {f.rel_path}
                      </a>
                      <span className="shrink-0 text-xs text-muted">{fmtBytes(f.size)}</span>
                      {f.note && !f.text_chars ? (
                        <span title={f.note} className="shrink-0 text-amber-600">
                          <AlertTriangle size={14} />
                        </span>
                      ) : f.text_chars > 0 ? (
                        <span title={f.note ?? `${f.text_chars.toLocaleString()} characters readable`} className="shrink-0 text-emerald-600">
                          <CheckCircle2 size={14} />
                        </span>
                      ) : null}
                      {canEdit && (
                        <button className="btn btn-ghost btn-sm shrink-0 text-red-600" onClick={() => remove(f)} title="Remove">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {list.some((f) => f.note && !f.text_chars) && <p className="mt-2 text-[11px] text-amber-700">Files marked with a warning could not be read fully (scanned PDF, image or a format the engine cannot open). Hover to see why.</p>}
            </div>
          );
        })}
      </div>

      {/* Create */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Sparkles size={16} /> {form.revised ? "Create revised EAR (Word, tracked changes)" : "Create EAR (Word)"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {files.length} document{files.length === 1 ? "" : "s"} · {fmtBytes(totalBytes)}. The engine reads the whole submission and the contract, follows your template, and writes a print-ready report.
              {form.revised && " For a revised submission every change against the previous EAR is a tracked change by “Commercial Manager” and Track Changes is left on in the file."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {c.output_name && !generating && (
              <a href={`/api/ear/${c.id}/download`} className="btn btn-secondary">
                <Download size={16} /> Download EAR (Word)
              </a>
            )}
            {canEdit && (
              <button className="btn btn-primary" onClick={generate} disabled={generating || !ready || !!progress}>
                {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {generating ? "Writing the report…" : c.output_name ? "Create again" : "Create EAR"}
              </button>
            )}
          </div>
        </div>
        {!ready && <p className="mt-3 text-xs text-amber-700">{!has("submission") ? "Upload the contractor's submission (step 1) first." : "Upload the previous EAR (step 4) – a revised report is written on top of it."}</p>}
        {generating && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm text-navy">
            <Loader2 size={16} className="animate-spin" /> Reading {files.length} documents and writing the report. This takes a few minutes for a large claim – keep this page open.
          </div>
        )}
        {!generating && c.status === "Generated" && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <div>
              <b>{c.output_name}</b> created {c.generated_at?.slice(0, 16).replace("T", " ")}. {c.generation_note}
            </div>
          </div>
        )}
        {!generating && c.status === "Failed" && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>The last attempt failed: {c.generation_note}</div>
          </div>
        )}
      </div>
    </div>
  );
}
