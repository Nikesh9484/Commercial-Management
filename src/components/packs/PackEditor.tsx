"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDown, FileText, FolderUp, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Chip } from "@/components/ui/Chip";
import { PAGE_KIND_LABEL, type PageKind } from "@/lib/kpi/pages";
import { PACK_STATUSES, REFERENCE_SLOT, slotsFor, type PackDoc, type PackSlot, type PackValues } from "@/lib/packs/shared";

interface Field {
  key: string;
  label: string;
  kind: "text" | "money" | "date" | "number" | "long";
  group: string;
  auto: boolean;
  hint: string;
}
interface TypeInfo {
  key: string;
  label: string;
  short: string;
  formRef: string;
  groups: string[];
  fields: Field[];
  slots: PackSlot[];
  otherSlots: number;
  packOrder: string[];
}
interface Initial {
  id: number;
  ref: string;
  title: string;
  revision: string;
  status: string;
  fileName: string;
  values: PackValues;
  sourceId: number | null;
  defaultFileName: string;
  extraSlots: number;
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** One pack: the form's fields by section, the numbered upload slots and the outputs. */
export function PackEditor({ type, initial, docs: initialDocs, canManage, templateName }: { type: TypeInfo; initial: Initial; docs: PackDoc[]; canManage: boolean; templateName: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<PackValues>(initial.values);
  const [head, setHead] = useState({ ref: initial.ref, title: initial.title, revision: initial.revision, status: initial.status, fileName: initial.fileName });
  const [docs, setDocs] = useState<PackDoc[]>(initialDocs);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [extra, setExtra] = useState(initial.extraSlots);
  const slots = slotsFor({ ...type, source: "changes", sourceLabel: "", description: "", fields: [], groups: type.groups, packOrder: type.packOrder, key: type.key as never }, extra);
  const dirInput = useRef<HTMLInputElement>(null);
  const slotInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const packName = head.fileName.trim() || initial.defaultFileName;

  async function save(patch?: Record<string, unknown>) {
    setSaving(true);
    try {
      const body = patch ?? { ref: head.ref, title: head.title, revision: head.revision, status: head.status, file_name: head.fileName, values };
      const res = await fetch(`/api/packs/cases/${initial.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "could not save");
      setDirty(false);
      if (patch?.refresh) {
        toast(`${j.refreshed} values pulled again from the registers.`);
        window.location.reload();
      } else toast("Saved.");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${type.short} ${head.ref || `#${initial.id}`} with its ${docs.length} uploaded files?`)) return;
    const res = await fetch(`/api/packs/cases/${initial.id}`, { method: "DELETE" });
    if (!res.ok) return toast("Could not delete the pack.", "error");
    router.push(`/packs/${type.key}`);
  }

  async function upload(list: FileList | null, slot?: string) {
    if (!list || !list.length) return;
    const picked = Array.from(list).filter((f) => !/^(\.|~\$|thumbs\.db$|desktop\.ini$)/i.test(f.name));
    if (!picked.length) return;
    const CHUNK = 256 * 1024;
    let added = 0;
    const filled = new Set<string>();
    for (let n = 0; n < picked.length; n++) {
      const f = picked[n];
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const count = Math.max(1, Math.ceil(f.size / CHUNK));
      let uploadId = "";
      for (let i = 0; i < count; i++) {
        setProgress(`${n + 1} of ${picked.length}: ${rel}${count > 1 ? ` (part ${i + 1} of ${count})` : ""}`);
        const data = await toBase64(f.slice(i * CHUNK, (i + 1) * CHUNK));
        let j: { error?: string; uploadId?: string; doc?: PackDoc & { filled?: string[] } } = {};
        try {
          const res = await fetch("/api/packs/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, caseId: initial.id, name: f.name, relPath: rel, mime: f.type, size: f.size, index: i, count, data, slot }) });
          j = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast(`${rel}: ${j.error ?? "upload failed"}`, "error");
            break;
          }
        } catch (e) {
          toast(`${rel}: ${e instanceof Error ? e.message : String(e)}`, "error");
          break;
        }
        uploadId = j.uploadId ?? uploadId;
        if (j.doc) {
          const doc = j.doc;
          for (const k of doc.filled ?? []) filled.add(k);
          setDocs((cur) => [...cur.filter((x) => x.rel_path !== doc.rel_path), doc]);
          added++;
        }
      }
    }
    setProgress(null);
    if (added) toast(`${added} file${added === 1 ? "" : "s"} added to the pack.${filled.size ? ` ${filled.size} field${filled.size === 1 ? "" : "s"} read from the file – the page reloads to show them.` : ""}`);
    if (filled.size) setTimeout(() => window.location.reload(), 1200);
  }

  async function addSlot() {
    const res = await fetch(`/api/packs/cases/${initial.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ add_slot: true }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error ?? "Could not add the attachment slot.", "error");
    setExtra(Number(j.case?.extra_slots ?? extra + 1));
  }

  async function patchDoc(doc: PackDoc, body: { slot?: string; pages?: string }) {
    const res = await fetch(`/api/packs/docs/${doc.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error ?? "Could not change the document.", "error");
    setDocs((cur) => cur.map((d) => (d.id === doc.id ? j.doc : d)));
  }

  async function removeDoc(doc: PackDoc) {
    if (!confirm(`Remove ${doc.name} from this pack?`)) return;
    const res = await fetch(`/api/packs/docs/${doc.id}`, { method: "DELETE" });
    if (!res.ok) return toast("Could not remove the document.", "error");
    setDocs((cur) => cur.filter((d) => d.id !== doc.id));
  }

  const setValue = (k: string, v: string) => {
    setValues((cur) => ({ ...cur, [k]: v }));
    setDirty(true);
  };
  const setHeadField = (k: keyof typeof head, v: string) => {
    setHead((cur) => ({ ...cur, [k]: v }));
    setDirty(true);
  };
  const filled = type.fields.filter((f) => (values[f.key] ?? "").trim()).length;

  return (
    <div className="space-y-4">
      {/* outputs and status */}
      <div className="card p-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid flex-1 gap-2 sm:grid-cols-[7rem_1fr_5rem_9rem]">
            <label className="text-muted">
              {type.short} reference
              <input className="input mt-0.5 w-full" value={head.ref} disabled={!canManage} onChange={(e) => setHeadField("ref", e.target.value)} placeholder="e.g. PVO-05" />
            </label>
            <label className="text-muted">
              Title
              <input className="input mt-0.5 w-full" value={head.title} disabled={!canManage} onChange={(e) => setHeadField("title", e.target.value)} />
            </label>
            <label className="text-muted">
              Rev.
              <input className="input mt-0.5 w-full" value={head.revision} disabled={!canManage} onChange={(e) => setHeadField("revision", e.target.value)} placeholder="00" />
            </label>
            <label className="text-muted">
              Status
              <select className="input mt-0.5 w-full" value={head.status} disabled={!canManage} onChange={(e) => setHeadField("status", e.target.value)}>
                {PACK_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <label className="mt-2 block text-muted">
          File name of the outputs
          <input className="input mt-0.5 w-full font-mono" value={head.fileName} disabled={!canManage} onChange={(e) => setHeadField("fileName", e.target.value)} placeholder={initial.defaultFileName} />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {canManage && (
            <>
              <button className={`btn btn-sm ${dirty ? "btn-primary" : "btn-secondary"}`} onClick={() => save()} disabled={saving}>
                {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
              </button>
              {initial.sourceId && (
                <button className="btn btn-sm btn-secondary" onClick={() => save({ refresh: true })} disabled={saving} title="Pull the register values again – what you typed on the other fields stays">
                  <RefreshCw size={13} /> Refresh from register
                </button>
              )}
            </>
          )}
          <span className="mx-1 text-muted">|</span>
          <a className="btn btn-sm btn-secondary" href={`/api/packs/output?case=${initial.id}&format=docx`} title={templateName ? `Written into the RSG template ${templateName}` : "Built-in layout – upload the RSG template on the category page to use it"} onClick={() => dirty && toast("Save first – the download uses the saved values.", "error")}>
            <FileText size={13} /> Word {templateName ? "(RSG template)" : "(built-in layout)"}
          </a>
          <a className="btn btn-sm btn-pdf" href={`/api/packs/output?case=${initial.id}&format=pdf`} title="The form as a PDF, drawn by the dashboard" onClick={() => dirty && toast("Save first – the download uses the saved values.", "error")}>
            <FileDown size={13} /> PDF form
          </a>
          <a className="btn btn-sm btn-primary" href={`/api/packs/output?case=${initial.id}&format=pack`} title={`Cover, the form, a divider per part and every supporting document: ${packName} – Pack.pdf`} onClick={() => dirty && toast("Save first – the download uses the saved values.", "error")}>
            <FileDown size={13} /> Compiled PDF pack
          </a>
          {canManage && (
            <button className="btn btn-sm btn-ghost ml-auto text-red-700" onClick={remove} title="Delete this pack and its files">
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
        <div className="mt-2 text-muted">
          Outputs are named <span className="font-mono text-ink">{packName}</span> · {filled} of {type.fields.length} fields filled · {docs.length} supporting file{docs.length === 1 ? "" : "s"}
          {templateName ? ` · Word written into ${templateName}` : " · no RSG template uploaded for this category yet, the Word file uses the built-in layout"}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        {/* the form's fields */}
        <div className="space-y-3">
          {type.groups.map((group) => {
            const fields = type.fields.filter((f) => f.group === group);
            if (!fields.length) return null;
            return (
              <div key={group} className="card p-4 text-xs">
                <div className="mb-2 flex items-center gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{group}</div>
                  <Chip tone="grey">{fields.filter((f) => (values[f.key] ?? "").trim()).length} / {fields.length}</Chip>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {fields.map((f) =>
                    f.kind === "long" ? (
                      <label key={f.key} className="text-muted sm:col-span-2">
                        {f.label}
                        {f.hint && <span className="ml-1 text-[10px] text-muted/80">({f.hint})</span>}
                        <textarea className="input mt-0.5 w-full" rows={Math.min(10, Math.max(3, Math.ceil((values[f.key] ?? "").length / 110) + 1))} value={values[f.key] ?? ""} disabled={!canManage} onChange={(e) => setValue(f.key, e.target.value)} />
                      </label>
                    ) : (
                      <label key={f.key} className="text-muted">
                        {f.label}
                        {f.auto && <span className="ml-1 text-[10px] text-emerald-700" title="Filled from the registers when the pack was started">●</span>}
                        {f.hint && <span className="ml-1 text-[10px] text-muted/80">({f.hint})</span>}
                        <input className={`input mt-0.5 w-full ${f.kind === "money" || f.kind === "number" ? "tnum text-right" : ""}`} type={f.kind === "date" ? "date" : "text"} value={values[f.key] ?? ""} disabled={!canManage} onChange={(e) => setValue(f.key, e.target.value)} placeholder={f.kind === "money" ? "SAR" : f.kind === "date" ? "" : ""} />
                      </label>
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* the supporting documents */}
        <div className="card p-4 text-xs">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Supporting documents · {docs.length}</div>
            {canManage && (
              <>
                <input ref={dirInput} type="file" multiple className="hidden" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
                <button className="btn btn-xs btn-secondary" onClick={() => dirInput.current?.click()} disabled={!!progress} title="A folder holding every part: each file is filed under the part its folder or name says (1. …, 2. …)">
                  <FolderUp size={12} /> Upload a folder
                </button>
              </>
            )}
          </div>
          {progress && <div className="mb-2 text-navy">Uploading {progress}…</div>}
          <div className="mb-2 text-muted">
            The compiled pack is made of: {type.packOrder.join(" · ")}. PDF, JPG and PNG files go in; Word and Excel files are kept for reference. The last approved document in slot {slots.find((s) => s.key === REFERENCE_SLOT)?.no ?? "–"} is read for its wording and signatories, not compiled.
          </div>
          <ol className="space-y-2">
            {slots.map((slot) => {
              const mine = docs.filter((d) => d.slot === slot.key);
              return (
                <li key={slot.key} className="rounded border border-line">
                  <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-2 py-1.5">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-700 text-[11px] font-semibold text-white">{slot.no}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-ink">{slot.label}</div>
                      <div className="text-[11px] text-muted">{slot.hint}</div>
                    </div>
                    {mine.length === 0 && <span className="text-[11px] text-amber-700">nothing uploaded</span>}
                    {canManage && (
                      <>
                        <input ref={(el) => { slotInputs.current[slot.key] = el; }} type="file" multiple className="hidden" onChange={(e) => { upload(e.target.files, slot.key); e.target.value = ""; }} />
                        <button className="btn btn-xs btn-secondary" onClick={() => slotInputs.current[slot.key]?.click()} disabled={!!progress}>
                          <Upload size={12} /> Upload
                        </button>
                      </>
                    )}
                  </div>
                  {mine.length > 0 && (
                    <ul className="divide-y divide-line">
                      {mine.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-2 px-2 py-1">
                          <a className="min-w-0 flex-1 truncate text-ink hover:underline" href={`/api/packs/docs/${d.id}/download`} target="_blank" rel="noopener" title={d.rel_path}>
                            {d.name}
                          </a>
                          <span className="text-muted">{(d.size / 1024 / 1024).toFixed(1)} MB</span>
                          {d.page_count > 0 && <PagesPicker doc={d} canManage={canManage} onSave={(pages) => patchDoc(d, { pages })} />}
                          {canManage && (
                            <>
                              <select className="input h-6 w-44 py-0 text-[11px]" value={d.slot} onChange={(e) => patchDoc(d, { slot: e.target.value })} title="Move to another part of the pack">
                                {slots.map((s2) => (
                                  <option key={s2.key} value={s2.key}>{s2.no}. {s2.label}</option>
                                ))}
                              </select>
                              <button className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-700" onClick={() => removeDoc(d)} aria-label="Remove">
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
          {canManage && (
            <button className="btn btn-xs btn-secondary mt-2" onClick={addSlot} title="One more numbered attachment slot">
              <Plus size={12} /> Add attachment slot
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PagesPicker({ doc, canManage, onSave }: { doc: PackDoc; canManage: boolean; onSave: (pages: string) => void }) {
  const [value, setValue] = useState(doc.pages ?? "");
  let kinds: PageKind[] = [];
  try {
    kinds = JSON.parse(doc.page_kinds || "[]") as PageKind[];
  } catch {
    kinds = [];
  }
  const legend = kinds.map((k, i) => `p.${i + 1}: ${PAGE_KIND_LABEL[k] ?? k}`).join("\n");
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-muted" title={`Pages taken into the pack (blank = all). Each page was read as:\n${legend}`}>
      pages
      <input className="input h-6 w-24 py-0 text-[11px]" value={value} placeholder="all" disabled={!canManage} onChange={(e) => setValue(e.target.value)} onBlur={() => value !== (doc.pages ?? "") && onSave(value)} />
      of {doc.page_count}
    </span>
  );
}
