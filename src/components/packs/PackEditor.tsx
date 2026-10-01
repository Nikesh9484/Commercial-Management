"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileDown, FileText, FolderUp, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Chip } from "@/components/ui/Chip";
import { formatDate, formatMoney } from "@/lib/format";
import { PACK_STATUSES, REFERENCE_SLOT, slotsFor, type PackDoc, type PackSlot, type PackValues } from "@/lib/packs/shared";

interface Field {
  key: string;
  label: string;
  kind: "text" | "money" | "date" | "number" | "long";
  group: string;
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
  sources: Record<string, string>;
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

const SOURCE_TONE: Record<string, "green" | "blue" | "amber" | "grey"> = { "previous PVO": "green", "previous DVO": "green", "previous RFA": "green", "previous EAR": "green", "approved PVO": "green", RFC: "blue", "cost assessment": "blue", register: "grey", project: "grey", calculated: "grey" };

function shown(f: Field, v: string | undefined): string {
  const t = String(v ?? "").trim();
  if (!t) return "";
  if (f.kind === "money") {
    const n = Number(t.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) && /\d/.test(t) ? formatMoney(n) : t;
  }
  if (f.kind === "date") return /^\d{4}-\d{2}-\d{2}/.test(t) ? formatDate(t) : t;
  return t;
}

/**
 * One pack, built from its files: the numbered upload slots come first, then what the dashboard read
 * from them (with the file each value came from), then the outputs. Nothing is typed – a wrong or
 * missing value is fixed by uploading the right file and reading again.
 */
export function PackEditor({ type, initial, docs: initialDocs, canManage, templateName }: { type: TypeInfo; initial: Initial; docs: PackDoc[]; canManage: boolean; templateName: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [head, setHead] = useState({ revision: initial.revision, status: initial.status, fileName: initial.fileName });
  const [docs, setDocs] = useState<PackDoc[]>(initialDocs);
  const [busy, setBusy] = useState(false);
  // every file in flight, by its path: uploads may run for several entries at the same time
  const [inflight, setInflight] = useState<Record<string, string>>({});
  const progress = Object.keys(inflight).length ? `${Object.keys(inflight).length} file${Object.keys(inflight).length === 1 ? "" : "s"} – ${Object.values(inflight).slice(0, 2).join(" · ")}${Object.keys(inflight).length > 2 ? " …" : ""}` : null;
  const [extra, setExtra] = useState(initial.extraSlots);
  const slots = slotsFor({ ...type, source: "changes", sourceLabel: "", description: "", fields: [], groups: type.groups, packOrder: type.packOrder, key: type.key as never }, extra);
  const packName = head.fileName.trim() || initial.defaultFileName;
  const values = initial.values;
  const sources = initial.sources;
  const hasRef = docs.some((d) => d.slot === REFERENCE_SLOT);
  const read = type.fields.filter((f) => (values[f.key] ?? "").trim()).length;

  async function patch(body: Record<string, unknown>, okMessage?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/packs/cases/${initial.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "could not save");
      if (okMessage) toast(okMessage);
      return j;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function reread() {
    const j = await patch({ refresh: true });
    if (j) {
      toast(`${j.refreshed} values read from the register and the files.`);
      router.refresh();
    }
  }

  async function remove() {
    if (!confirm(`Delete ${type.short} ${initial.ref || `#${initial.id}`} with its ${docs.length} uploaded files?`)) return;
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
    const mark = (rel: string, text: string | null) => setInflight((cur) => {
      const next = { ...cur };
      if (text === null) delete next[rel];
      else next[rel] = text;
      return next;
    });
    const one = async (f: File) => {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const count = Math.max(1, Math.ceil(f.size / CHUNK));
      let uploadId = "";
      for (let i = 0; i < count; i++) {
        mark(rel, `${rel}${count > 1 ? ` (part ${i + 1} of ${count})` : ""}`);
        const data = await toBase64(f.slice(i * CHUNK, (i + 1) * CHUNK));
        let j: { error?: string; uploadId?: string; doc?: PackDoc & { filled?: string[] } } = {};
        try {
          const body = JSON.stringify({ uploadId, caseId: initial.id, name: f.name, relPath: rel, mime: f.type, size: f.size, index: i, count, data, slot });
          const send = () => fetch("/api/packs/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body });
          // a connection the server closed while it was busy with another file is retried once
          const res = await send().catch(() => new Promise<Response>((r) => setTimeout(r, 1500)).then(send));
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
      mark(rel, null);
    };
    // three files at a time; a click on another entry's Upload starts its own batch alongside
    const queue = [...picked];
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) await one(f);
    }));
    if (added) toast(`${added} file${added === 1 ? "" : "s"} added – ${filled.size} value${filled.size === 1 ? "" : "s"} read from ${added === 1 ? "it" : "them"}.`);
    router.refresh();
  }

  async function addSlot() {
    const j = await patch({ add_slot: true });
    if (j) setExtra(Number(j.case?.extra_slots ?? extra + 1));
  }

  async function patchDoc(doc: PackDoc, body: { slot?: string; pages?: string }) {
    const res = await fetch(`/api/packs/docs/${doc.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error ?? "Could not change the document.", "error");
    setDocs((cur) => cur.map((d) => (d.id === doc.id ? j.doc : d)));
    if (body.slot) reread();
  }

  async function removeDoc(doc: PackDoc) {
    if (!confirm(`Remove ${doc.name} from this pack?`)) return;
    const res = await fetch(`/api/packs/docs/${doc.id}`, { method: "DELETE" });
    if (!res.ok) return toast("Could not remove the document.", "error");
    setDocs((cur) => cur.filter((d) => d.id !== doc.id));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* status and outputs */}
      <div className="card p-4 text-xs">
        <div className="grid gap-2 sm:grid-cols-[1fr_6rem_10rem]">
          <div className="text-muted">
            Outputs are named <span className="font-mono text-ink">{packName}</span>
            {canManage && (
              <input className="input mt-0.5 w-full font-mono" value={head.fileName} onChange={(e) => setHead((h) => ({ ...h, fileName: e.target.value }))} onBlur={() => head.fileName !== initial.fileName && patch({ file_name: head.fileName }, "File name saved.")} placeholder={initial.defaultFileName} />
            )}
          </div>
          <label className="text-muted">
            Rev.
            <input className="input mt-0.5 w-full" value={head.revision} disabled={!canManage} onChange={(e) => setHead((h) => ({ ...h, revision: e.target.value }))} onBlur={() => head.revision !== initial.revision && patch({ revision: head.revision }, "Revision saved.")} placeholder="00" />
          </label>
          <label className="text-muted">
            Status
            <select className="input mt-0.5 w-full" value={head.status} disabled={!canManage} onChange={(e) => { setHead((h) => ({ ...h, status: e.target.value })); patch({ status: e.target.value }, "Status saved."); }}>
              {PACK_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {templateName && /\.(xlsx|xlsm|xltx|xltm)$/i.test(templateName) ? (
            <a className="btn btn-sm btn-secondary" href={`/api/packs/output?case=${initial.id}&format=xlsx`} title={`Written into the RSG workbook ${templateName}, every tab kept`}>
              <FileText size={13} /> Excel form
            </a>
          ) : (
            <a className="btn btn-sm btn-secondary" href={`/api/packs/output?case=${initial.id}&format=docx`} title={templateName ? `Written into the Word template ${templateName}` : "Word document"}>
              <FileText size={13} /> Word
            </a>
          )}
          <a className="btn btn-sm btn-pdf" href={`/api/packs/output?case=${initial.id}&format=pdf`} title="The document in the RSG layout">
            <FileDown size={13} /> PDF
          </a>
          <a className="btn btn-sm btn-primary" href={`/api/packs/output?case=${initial.id}&format=pack`} title={`The complete pack with its annexures: ${packName} - Pack.pdf`}>
            <FileDown size={13} /> Compiled PDF pack
          </a>
          {canManage && (
            <>
              <button className="btn btn-sm btn-secondary" onClick={reread} disabled={busy} title="Read every value again from the register item and the uploaded files">
                <RefreshCw size={13} /> Read the files again
              </button>
              <button className="btn btn-sm btn-ghost ml-auto text-red-700" onClick={remove} title="Delete this pack and its files">
                <Trash2 size={13} /> Delete
              </button>
            </>
          )}
        </div>
        <div className="mt-2 text-muted">
          {read} of {type.fields.length} values in hand · {docs.length} file{docs.length === 1 ? "" : "s"} uploaded ·{" "}
          {hasRef ? "the previous document in slot 2 supplies the project particulars, the figures, the wording and the signatories" : `upload the last approved ${type.short} into slot 2 – it supplies the project particulars, the figures, the wording and the signatories`}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.15fr]">
        {/* the uploads – the only input */}
        <div className="card p-4 text-xs">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Upload entries · {docs.length} files</div>
            {canManage && (
              <>
                <input type="file" multiple className="hidden" id={`files-${initial.id}`} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
                <button className="btn btn-xs btn-secondary" onClick={() => (document.getElementById(`files-${initial.id}`) as HTMLInputElement | null)?.click()} title="Several files at once: each is filed under the entry its name says (PVO, RFC, RFA, cost, drawing …); move any that lands wrongly">
                  <Upload size={12} /> Upload files
                </button>
                <input type="file" multiple className="hidden" id={`dir-${initial.id}`} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
                <button className="btn btn-xs btn-secondary" onClick={() => (document.getElementById(`dir-${initial.id}`) as HTMLInputElement | null)?.click()} title="A folder holding every entry: each file is filed under the entry its folder or name says (1. …, 2. …)">
                  <FolderUp size={12} /> Upload a folder
                </button>
              </>
            )}
          </div>
          {progress && <div className="mb-2 text-navy">Uploading {progress} – you can keep adding files to other entries meanwhile.</div>}
          <div className="mb-2 text-muted">Everything in the {type.short} is read from these files. The compiled pack is made of: {type.packOrder.join(" · ")}.</div>
          <ol className="space-y-2">
            {slots.map((slot) => (
              <SlotRow key={slot.key} typeKey={type.key} slot={slot} docs={docs.filter((d) => d.slot === slot.key)} slots={slots} canManage={canManage} busy={false} onUpload={(files) => upload(files, slot.key)} onMove={(d, s) => patchDoc(d, { slot: s })} onPages={(d, p) => patchDoc(d, { pages: p })} onRemove={removeDoc} />
            ))}
          </ol>
          {canManage && (
            <button className="btn btn-xs btn-secondary mt-2" onClick={addSlot} title="One more numbered attachment entry">
              <Plus size={12} /> Add attachment entry
            </button>
          )}
        </div>

        {/* what was read */}
        <div className="space-y-3">
          {type.groups.map((group) => {
            const fields = type.fields.filter((f) => f.group === group);
            if (!fields.length) return null;
            const have = fields.filter((f) => (values[f.key] ?? "").trim());
            return (
              <div key={group} className="card p-4 text-xs">
                <div className="mb-2 flex items-center gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{group}</div>
                  <Chip tone={have.length === fields.length ? "green" : have.length ? "amber" : "grey"}>
                    {have.length} / {fields.length}
                  </Chip>
                </div>
                <table className="w-full">
                  <tbody>
                    {fields.map((f) => {
                      const v = shown(f, values[f.key]);
                      const src = sources[f.key];
                      return (
                        <tr key={f.key} className="border-t border-line align-top">
                          <td className="w-[38%] py-1 pr-2 text-muted">{f.label}</td>
                          <td className={`py-1 pr-2 ${f.kind === "long" ? "whitespace-pre-wrap" : ""} ${v ? "text-ink" : "text-amber-700"}`}>{v || "not in the files yet"}</td>
                          <td className="w-[8rem] py-1 text-right">
                            {v && src && (
                              <Chip tone={SOURCE_TONE[src] ?? "grey"}>
                                {/previous|approved/.test(src) && <CheckCircle2 size={10} className="mr-1" />}
                                {src}
                              </Chip>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** whether a reference pack carries the form pages of its kind (a pack that starts at the index of annexures does not) */
function hasFormPages(d: PackDoc, typeKey: string): boolean {
  try {
    const kinds = JSON.parse(d.page_kinds || "[]") as string[];
    return !["pvo", "dvo"].includes(typeKey) || kinds.includes(`${typeKey}_form`);
  } catch {
    return true;
  }
}

function SlotRow({ typeKey, slot, docs, slots, canManage, busy, onUpload, onMove, onPages, onRemove }: { typeKey: string; slot: PackSlot; docs: PackDoc[]; slots: PackSlot[]; canManage: boolean; busy: boolean; onUpload: (files: FileList | null) => void; onMove: (d: PackDoc, slot: string) => void; onPages: (d: PackDoc, pages: string) => void; onRemove: (d: PackDoc) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const reads = slot.key === REFERENCE_SLOT ? "read for the particulars, figures, wording and signatories" : slot.key === "rfc" || slot.key === "details" ? "read for the subject, scope and justification" : slot.key === "cost" ? "read for the value" : slot.key === "pvo" ? "read for the PVO number, value and title" : null;
  return (
    <li className="rounded border border-line">
      <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-2 py-1.5">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-700 text-[11px] font-semibold text-white">{slot.no}</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">{slot.label}</div>
          <div className="text-[11px] text-muted">
            {slot.hint}
            {reads ? ` · ${reads}` : ""}
          </div>
        </div>
        {docs.length === 0 && <span className="text-[11px] text-amber-700">nothing uploaded</span>}
        {canManage && (
          <>
            <input ref={input} type="file" multiple className="hidden" onChange={(e) => { onUpload(e.target.files); e.target.value = ""; }} />
            <button className="btn btn-xs btn-secondary" onClick={() => input.current?.click()} disabled={busy} title="One or several files of any type into this entry">
              <Upload size={12} /> Files
            </button>
            <input ref={dirInput} type="file" multiple className="hidden" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => { onUpload(e.target.files); e.target.value = ""; }} />
            <button className="btn btn-xs btn-secondary" onClick={() => dirInput.current?.click()} disabled={busy} title="A whole folder into this entry">
              <FolderUp size={12} /> Folder
            </button>
          </>
        )}
      </div>
      {docs.length > 0 && (
        <ul className="divide-y divide-line">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-2 py-1">
              <a className="min-w-0 flex-1 truncate text-ink hover:underline" href={`/api/packs/docs/${d.id}/download`} target="_blank" rel="noopener" title={d.rel_path}>
                {d.name}
              </a>
              <span className="text-muted">{(d.size / 1024 / 1024).toFixed(1)} MB{d.page_count ? ` · ${d.page_count} p.` : ""}</span>
              {slot.key === "reference" && d.page_count > 0 && !hasFormPages(d, typeKey) && <span className="text-[11px] text-amber-700">no form pages in this file – its index and dividers are used; the form pages come from the category&apos;s PDF template</span>}
              {d.page_count > 0 && slot.key === "pvo" && <PagesPicker doc={d} canManage={canManage} onSave={(p) => onPages(d, p)} />}
              {canManage && (
                <>
                  <select className="input h-6 w-40 py-0 text-[11px]" value={d.slot} onChange={(e) => onMove(d, e.target.value)} title="Move to another entry">
                    {slots.map((s2) => (
                      <option key={s2.key} value={s2.key}>{s2.no}. {s2.label}</option>
                    ))}
                  </select>
                  <button className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-700" onClick={() => onRemove(d)} aria-label="Remove">
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
}

function PagesPicker({ doc, canManage, onSave }: { doc: PackDoc; canManage: boolean; onSave: (pages: string) => void }) {
  const [value, setValue] = useState(doc.pages ?? "");
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-muted" title="Pages taken into the pack (blank = all)">
      pages
      <input className="input h-6 w-24 py-0 text-[11px]" value={value} placeholder="all" disabled={!canManage} onChange={(e) => setValue(e.target.value)} onBlur={() => value !== (doc.pages ?? "") && onSave(value)} />
      of {doc.page_count}
    </span>
  );
}
