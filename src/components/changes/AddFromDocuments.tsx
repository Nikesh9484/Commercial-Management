"use client";

import { useRef, useState } from "react";
import { AlertTriangle, FolderUp, FilePlus2, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { Decisions, FromDocsResult } from "@/lib/from-docs-shared";

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/**
 * An entry from its own documents – a change from its RFC / PVO / EVO / EI / RFA / DVO, a bond or a
 * policy from its schedule, certificate or guarantee. Every file is read and the register written;
 * what the files did not give is listed for the row to be completed by hand. An entry already in the
 * register stops the upload with the two side by side: replace it with the new details, or keep the old.
 */
export function AddFromDocuments({ endpoint, title, button = "Add from documents", intro, tip }: { endpoint: string; title: string; button?: string; intro: string; tip?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [batch, setBatch] = useState("");
  const [result, setResult] = useState<FromDocsResult | null>(null);
  const [decisions, setDecisions] = useState<Decisions>({});
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function post(body: Record<string, unknown>) {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as FromDocsResult & { error?: string; uploadId?: string };
    if (!res.ok) throw new Error(j.error || "Something went wrong.");
    return j;
  }

  function announce(j: FromDocsResult) {
    setResult(j);
    if (j.needsDecision) {
      toast(`${j.duplicates.length} entr${j.duplicates.length === 1 ? "y is" : "ies are"} already in the register – choose Replace or Keep the old below, then apply.`, "error");
      return;
    }
    const n = j.entries.filter((e) => e.action !== "kept").length;
    toast(n ? `${n} entr${n === 1 ? "y" : "ies"} ${j.entries.every((e) => e.action === "updated") ? "updated" : "written"}.` : "No entry could be made from these files.");
  }

  async function run(list: FileList | null) {
    if (!list || !list.length) return;
    const files = Array.from(list).filter((f) => f.size > 0 && !/^\./.test(f.name));
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const CHUNK = 256 * 1024;
    setResult(null);
    setDecisions({});
    setBatch(id);
    try {
      for (let n = 0; n < files.length; n++) {
        const f = files[n];
        setBusy(`Uploading ${n + 1} of ${files.length}: ${f.name}`);
        const count = Math.max(1, Math.ceil(f.size / CHUNK));
        let uploadId = "";
        for (let i = 0; i < count; i++) {
          const data = await toBase64(f.slice(i * CHUNK, (i + 1) * CHUNK));
          let j: { uploadId?: string } = {};
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              j = await post({ batch: id, uploadId, name: f.name, index: i, count, data });
              break;
            } catch (e) {
              if (attempt === 3) throw e;
              await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            }
          }
          uploadId = j.uploadId ?? uploadId;
        }
      }
      setBusy("Reading the documents…");
      announce(await post({ batch: id, apply: true }));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong.", "error");
    } finally {
      setBusy("");
      if (filesRef.current) filesRef.current.value = "";
      if (folderRef.current) folderRef.current.value = "";
    }
  }

  async function applyDecisions() {
    if (!result) return;
    const missing = result.duplicates.filter((d) => !decisions[d.key]);
    if (missing.length) {
      toast("Choose Replace or Keep the old for every duplicate first.", "error");
      return;
    }
    setBusy("Writing the entries…");
    try {
      announce(await post({ batch, apply: true, decisions }));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong.", "error");
    } finally {
      setBusy("");
    }
  }

  function close() {
    setOpen(false);
    if (result?.entries.some((e) => e.action !== "kept")) window.location.reload();
  }

  return (
    <>
      <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)} title={intro}>
        <FilePlus2 size={14} /> {button}
      </button>
      <Modal open={open} title={title} onClose={close} size="lg">
        <div className="space-y-3 text-sm">
          <p className="text-muted">{intro}</p>
          {tip && <p className="text-xs text-muted">{tip}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={filesRef} type="file" multiple className="hidden" onChange={(e) => run(e.target.files)} />
            <input ref={folderRef} type="file" multiple className="hidden" onChange={(e) => run(e.target.files)} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
            <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => filesRef.current?.click()}>
              <Upload size={14} /> Files
            </button>
            <button className="btn btn-sm btn-secondary" disabled={!!busy} onClick={() => folderRef.current?.click()}>
              <FolderUp size={14} /> Folder
            </button>
            {busy && <span className="text-muted">{busy}</span>}
          </div>
          {result?.needsDecision && (
            <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3">
              <div className="flex items-center gap-2 font-semibold text-red-800">
                <AlertTriangle size={15} /> Already in the register – nothing has been written yet
              </div>
              {result.duplicates.map((d) => (
                <div key={d.key} className="rounded-md border border-line bg-white p-2.5 text-xs">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="font-semibold">
                        {d.register ? `${d.register} – ` : ""}in the register: {d.existing.label}
                      </div>
                      <div className="text-muted">{d.existing.detail}</div>
                    </div>
                    <div>
                      <div className="font-semibold">In the documents: {d.incoming.label}</div>
                      <div className="text-muted">{d.incoming.detail}</div>
                      <div className="text-muted">{d.files.join("; ")}</div>
                    </div>
                  </div>
                  {d.differences.length > 0 && (
                    <table className="mt-2 w-full">
                      <tbody>
                        {d.differences.map((x) => (
                          <tr key={x.label} className="border-t border-line/60">
                            <td className="w-36 py-0.5 pr-2 font-medium">{x.label}</td>
                            <td className="py-0.5 pr-2 text-muted line-through">{x.old}</td>
                            <td className="py-0.5">{x.new}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button className={`btn btn-xs ${decisions[d.key] === "replace" ? "btn-primary" : "btn-secondary"}`} onClick={() => setDecisions((x) => ({ ...x, [d.key]: "replace" }))}>
                      Replace with the new details
                    </button>
                    <button className={`btn btn-xs ${decisions[d.key] === "keep" ? "btn-primary" : "btn-secondary"}`} onClick={() => setDecisions((x) => ({ ...x, [d.key]: "keep" }))}>
                      Keep the old
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex justify-end">
                <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={applyDecisions}>
                  Apply
                </button>
              </div>
            </div>
          )}
          {result && !result.needsDecision && (
            <div className="space-y-3">
              {result.periods.map((p) => (
                <div key={p.programme} className="rounded-md border border-line bg-surface-2/40 px-3 py-2 text-xs">
                  <b>{p.programme}</b>: entries go under <b>{p.label}</b>
                  {p.locked ? ` · ${p.locked} locked` : ""}
                  {p.opened ? ` · ${p.opened} opened` : ""}
                  {p.warning ? <span className="text-amber-700"> · {p.warning}</span> : null}
                </div>
              ))}
              {result.warnings.map((w, i) => (
                <div key={i} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {w}
                </div>
              ))}
              {result.entries.map((e) => (
                <div key={`${e.action}-${e.id}`} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`chip ${e.action === "created" ? "chip-green" : e.action === "updated" ? "chip-blue" : "chip-grey"}`}>{e.action === "created" ? "Added" : e.action === "updated" ? "Updated" : "Kept the old"}</span>
                    {e.register && <span className="chip chip-grey">{e.register}</span>}
                    <b>{e.label}</b>
                    <span className="min-w-0 flex-1 truncate">{e.description}</span>
                    <span className="text-muted">{e.programme}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">From: {e.files.join("; ")}</div>
                  {e.action !== "kept" && (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {e.read.map((r, i) => (
                          <tr key={i} className="border-t border-line/60">
                            <td className="w-40 py-0.5 pr-2 align-top font-medium">{r.label}</td>
                            <td className="py-0.5 pr-2 align-top whitespace-pre-wrap">{r.value.length > 400 ? `${r.value.slice(0, 400)}…` : r.value}</td>
                            <td className="w-44 py-0.5 align-top text-muted">{r.from}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {e.action !== "kept" && e.missing.length > 0 && <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">Not found in the documents – add by hand (pencil on the row): {e.missing.join(", ")}</div>}
                </div>
              ))}
              <div className="text-xs text-muted">Files: {result.files.map((f) => `${f.name} – ${f.note}`).join(" · ")}</div>
              <div className="flex justify-end">
                <button className="btn btn-sm btn-primary" onClick={close}>
                  Done – show the register
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
