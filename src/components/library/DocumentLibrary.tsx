"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, FolderOpen, Trash2, Pencil, RefreshCw, ExternalLink, Search, X, Save, ChevronDown, ChevronUp, Filter } from "lucide-react";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { LibraryDoc, LibraryKey } from "@/lib/library/store";
import type { ChipTone } from "@/lib/registers/types";

interface ContractOption {
  id: number;
  title: string;
  po: string;
  acc: string;
  contractor_id: number | null;
  contractor: string;
}
interface ContractorOption {
  id: number;
  name: string;
}
/** The documents of one contract, shown under a single heading. */
interface Group {
  key: string;
  contractor: string;
  code: string;
  title: string;
  docs: LibraryDoc[];
  unfiled: boolean;
}

const fmtBytes = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const CONF_TONE: Record<string, ChipTone> = { High: "green", Confirmed: "green", Medium: "amber", Low: "amber", None: "red" };

export function DocumentLibrary({ library, info, docs: initial, contracts, contractors, canManage, engine }: { library: LibraryKey; info: { short: string; types: string[]; hint: string }; docs: LibraryDoc[]; contracts: ContractOption[]; contractors: ContractorOption[]; canManage: boolean; engine: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [docs, setDocs] = useState<LibraryDoc[]>(initial);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [removingGroup, setRemovingGroup] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<LibraryDoc | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  // an upload can be stopped part-way: reading each document costs an AI call, so a folder picked
  // by mistake should not have to run to the end
  const cancelRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [stopping, setStopping] = useState(false);
  const filesInput = useRef<HTMLInputElement | null>(null);
  const dirInput = useRef<HTMLInputElement | null>(null);

  // filters
  const [fContractor, setFContractor] = useState("");
  const [fContract, setFContract] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [q, setQ] = useState("");

  const isEot = library === "eot";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return docs.filter((d) => {
      if (fContractor && String(d.contractor_id ?? "") !== fContractor) return false;
      if (fContract && String(d.contract_id ?? "") !== fContract) return false;
      if (fType && d.doc_type !== fType) return false;
      if (fStatus === "unfiled" && d.contractor_id) return false;
      if (fStatus === "filed" && !d.contractor_id) return false;
      if (needle) {
        const hay = [d.name, d.rel_path, d.title, d.reference, d.claim_ref, d.summary, d.key_points, d.contractor ?? "", d.contract_code ?? "", d.contract_title ?? "", d.po_no ?? "", d.doc_type].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [docs, fContractor, fContract, fType, fStatus, q]);

  /**
   * The library reads as a set of contracts rather than one long list: every document sits under the
   * contract it belongs to, and the contracts start closed so the page opens as a short index.
   */
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const d of filtered) {
      const key = d.contract_id ? `c${d.contract_id}` : d.contractor_id ? `x${d.contractor_id}` : "unfiled";
      let g = m.get(key);
      if (!g) {
        g = {
          key,
          contractor: d.contractor ?? (key === "unfiled" ? "Not yet filed" : "–"),
          code: d.contract_code ?? "",
          title: d.contract_title ?? "",
          docs: [],
          unfiled: key === "unfiled",
        };
        m.set(key, g);
      }
      g.docs.push(d);
    }
    const list = [...m.values()];
    for (const g of list) g.docs.sort((a, b) => String(b.doc_date ?? "").localeCompare(String(a.doc_date ?? "")) || a.name.localeCompare(b.name));
    // contractors in order, the unfiled pile last
    list.sort((a, b) => Number(a.unfiled) - Number(b.unfiled) || a.contractor.localeCompare(b.contractor) || a.code.localeCompare(b.code));
    return list;
  }, [filtered]);

  /**
   * A contract is closed until it is opened, except while a filter or a search is running – then
   * what matched is already open, otherwise the page would look empty. Either way a heading can
   * still be clicked; the choices are remembered against the filter that was in force, so changing
   * the filter starts again rather than leaving contracts opened for a search that has gone.
   */
  const filterKey = `${q.trim()}|${fType}|${fStatus}|${fContract}|${fContractor}`;
  const [opened, setOpened] = useState<{ key: string; map: Record<string, boolean> }>({ key: "", map: {} });
  const searching = !!(q.trim() || fType || fStatus || fContract || fContractor);
  const openByDefault = searching || groups.length === 1;
  const isGroupOpen = (key: string) => (opened.key === filterKey ? opened.map[key] : undefined) ?? openByDefault;
  const toggleGroup = (key: string) =>
    setOpened((s) => {
      const map = s.key === filterKey ? { ...s.map } : {};
      map[key] = !(map[key] ?? openByDefault);
      return { key: filterKey, map };
    });

  const contractsForFilter = fContractor ? contracts.filter((c) => String(c.contractor_id ?? "") === fContractor) : contracts;
  const usedTypes = Array.from(new Set([...info.types, ...docs.map((d) => d.doc_type).filter(Boolean)]));

  async function upload(list: FileList | null) {
    if (!list || !list.length) return;
    const picked = Array.from(list).filter((f) => !/^(\.|~\$|thumbs\.db$|desktop\.ini$)/i.test(f.name) && /\.(pdf|docx?|dotx|txt|rtf|xlsx|msg|eml|png|jpe?g)$/i.test(f.name));
    if (!picked.length) return toast("No PDF or Word files were selected.", "error");
    const CHUNK = 256 * 1024;
    let added = 0;
    let stopped = false;
    cancelRef.current = false;
    setStopping(false);
    for (let n = 0; n < picked.length; n++) {
      if (cancelRef.current) {
        stopped = true;
        break;
      }
      const f = picked[n];
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const count = Math.max(1, Math.ceil(f.size / CHUNK));
      let uploadId = "";
      let ok = true;
      for (let i = 0; i < count; i++) {
        if (cancelRef.current) {
          stopped = true;
          ok = false;
          break;
        }
        setProgress(`${n + 1} of ${picked.length}: ${rel}${count > 1 ? ` (part ${i + 1} of ${count})` : ""}${i === count - 1 ? " – reading the document…" : ""}`);
        const data = await toBase64(f.slice(i * CHUNK, (i + 1) * CHUNK));
        let j: { error?: string; uploadId?: string; doc?: LibraryDoc } = {};
        try {
          abortRef.current = new AbortController();
          const r = await fetch(`/api/library/${library}`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: abortRef.current.signal, body: JSON.stringify({ uploadId, name: f.name, relPath: rel, mime: f.type, size: f.size, index: i, count, data }) });
          j = await r.json().catch(() => ({}));
          if (!r.ok) {
            toast(`${rel}: ${j.error ?? "upload failed"}`, "error");
            ok = false;
            break;
          }
        } catch (e) {
          if (cancelRef.current || (e instanceof DOMException && e.name === "AbortError")) {
            stopped = true;
            ok = false;
            break;
          }
          toast(`${rel}: ${e instanceof Error ? e.message : String(e)}`, "error");
          ok = false;
          break;
        } finally {
          abortRef.current = null;
        }
        uploadId = j.uploadId ?? uploadId;
        if (j.doc) {
          const doc = j.doc;
          setDocs((cur) => [doc, ...cur.filter((x) => x.rel_path !== doc.rel_path)]);
          added++;
        }
      }
      if (!ok) continue;
    }
    setProgress(null);
    setStopping(false);
    cancelRef.current = false;
    if (stopped) toast(`Stopped. ${added} document${added === 1 ? "" : "s"} added before you stopped; nothing further was uploaded or read.`);
    else if (added) toast(`${added} document${added === 1 ? "" : "s"} added to the ${info.short}.`);
    router.refresh();
  }

  /** Stops the upload: the file in flight is dropped and nothing after it is sent or read. */
  function stopUpload() {
    cancelRef.current = true;
    setStopping(true);
    abortRef.current?.abort();
  }

  async function reread(d: LibraryDoc) {
    setBusy(d.id);
    const r = await fetch(`/api/library/${library}/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reread: true }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return toast(j.error ?? "Could not re-read the document.", "error");
    setDocs((cur) => cur.map((x) => (x.id === d.id ? j.doc : x)));
    toast("Document read again.");
  }

  async function remove(d: LibraryDoc) {
    if (!confirm(`Remove "${d.rel_path}" from the ${info.short}?`)) return;
    setBusy(d.id);
    const r = await fetch(`/api/library/${library}/${d.id}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) return toast((await r.json().catch(() => ({}))).error ?? "Could not remove.", "error");
    setDocs((cur) => cur.filter((x) => x.id !== d.id));
    toast("Document removed.");
  }

  /**
   * Clears out a whole contract in one go. A folder picked by mistake fills a contract with dozens of
   * documents, and removing them one at a time is the slow way out of it. Only the documents showing
   * under the heading are removed, so a filter narrows what goes.
   */
  async function removeGroup(g: Group) {
    const what = g.unfiled ? "not yet filed under a contract" : `filed under ${g.contractor}${g.code ? ` (${g.code})` : ""}`;
    const warn = searching ? " Only the documents the filter is showing will be removed." : "";
    if (!confirm(`Remove all ${g.docs.length} document${g.docs.length === 1 ? "" : "s"} ${what} from the ${info.short}?${warn}\n\nThis cannot be undone.`)) return;
    setRemovingGroup(g.key);
    const r = await fetch(`/api/library/${library}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: g.docs.map((d) => d.id) }) });
    const j = (await r.json().catch(() => ({}))) as { removed?: number[]; skipped?: number; error?: string };
    setRemovingGroup(null);
    if (!r.ok) return toast(j.error ?? "Could not remove the documents.", "error");
    const gone = new Set(j.removed ?? []);
    setDocs((cur) => cur.filter((x) => !gone.has(x.id)));
    toast(`${gone.size} document${gone.size === 1 ? "" : "s"} removed${j.skipped ? `; ${j.skipped} could not be removed` : ""}.`, j.skipped ? "error" : undefined);
    router.refresh();
  }

  function startEdit(d: LibraryDoc) {
    setEditing(d);
    setForm({
      contractor_id: String(d.contractor_id ?? ""),
      contract_id: String(d.contract_id ?? ""),
      doc_type: d.doc_type,
      title: d.title,
      reference: d.reference,
      doc_date: d.doc_date ?? "",
      claim_ref: d.claim_ref,
      eot_days_claimed: d.eot_days_claimed == null ? "" : String(d.eot_days_claimed),
      eot_days_assessed: d.eot_days_assessed == null ? "" : String(d.eot_days_assessed),
      cost_claimed: d.cost_claimed == null ? "" : String(d.cost_claimed),
      cost_assessed: d.cost_assessed == null ? "" : String(d.cost_assessed),
      summary: d.summary,
    });
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(editing.id);
    const body: Record<string, unknown> = { ...form };
    for (const k of ["contractor_id", "contract_id", "eot_days_claimed", "eot_days_assessed", "cost_claimed", "cost_assessed"]) body[k] = form[k] === "" ? null : Number(form[k]);
    const r = await fetch(`/api/library/${library}/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return toast(j.error ?? "Could not save.", "error");
    setDocs((cur) => cur.map((x) => (x.id === editing.id ? j.doc : x)));
    setEditing(null);
    toast("Saved.");
  }

  const toggle = (id: number) =>
    setOpen((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const unfiled = docs.filter((d) => !d.contractor_id).length;

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">Add documents</h2>
              <p className="mt-1 text-xs text-muted">{info.hint} Each document is read as it arrives and filed under its contractor and contract code; you can correct the filing afterwards with <b>Change</b>.</p>
              {!engine && (
                <p className="mt-1 text-xs text-amber-800">
                  Reading engine not configured: documents are filed from the references found in them (ACC code, PO number, contractor name) but not summarised. Add <code>ANTHROPIC_API_KEY</code> in the hosting settings for full reading.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={() => filesInput.current?.click()} disabled={!!progress}>
                <FilePlus2 size={16} /> Add files
              </button>
              <button className="btn btn-secondary" onClick={() => dirInput.current?.click()} disabled={!!progress}>
                <FolderOpen size={16} /> Add a folder
              </button>
              <input ref={filesInput} type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.dotx,.txt,.rtf,.msg,.eml,.xlsx,.png,.jpg,.jpeg" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
              <input ref={dirInput} type="file" multiple className="hidden" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            </div>
          </div>
          {progress && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-900">
              <RefreshCw size={14} className="animate-spin shrink-0" />
              <span className="min-w-0 flex-1 truncate">Uploading {progress}</span>
              <button className="btn btn-sm btn-danger shrink-0" onClick={stopUpload} disabled={stopping} title="Stop uploading – nothing after the current file is sent or read">
                <X size={14} /> {stopping ? "Stopping…" : "Stop"}
              </button>
            </div>
          )}
          {progress && (
            <p className="mt-1 text-xs text-muted">Each document is read as it arrives, which uses the AI allowance. Stop leaves everything already added in place.</p>
          )}
        </div>
      )}

      <div className="card p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          <Filter size={13} /> Filter the library
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          <select className="input" value={fContractor} onChange={(e) => { setFContractor(e.target.value); setFContract(""); }}>
            <option value="">All contractors</option>
            {contractors.filter((c) => docs.some((d) => d.contractor_id === c.id) || contracts.some((k) => k.contractor_id === c.id)).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select className="input" value={fContract} onChange={(e) => setFContract(e.target.value)}>
            <option value="">All contract codes</option>
            {contractsForFilter.map((c) => (
              <option key={c.id} value={c.id}>{c.acc || c.po} · {c.title}</option>
            ))}
          </select>
          <select className="input" value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="">All document types</option>
            {usedTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select className="input" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">Filed and unfiled</option>
            <option value="filed">Filed under a contractor</option>
            <option value="unfiled">Not yet filed ({unfiled})</option>
          </select>
          <label className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input pl-8" placeholder="Search title, reference, summary, text…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        <div className="mt-2 text-xs text-muted">
          {filtered.length} of {docs.length} document{docs.length === 1 ? "" : "s"}{unfiled ? ` · ${unfiled} not yet filed under a contractor` : ""}
          {(fContractor || fContract || fType || fStatus || q) && (
            <button className="ml-2 text-accent hover:underline" onClick={() => { setFContractor(""); setFContract(""); setFType(""); setFStatus(""); setQ(""); }}>
              clear filters
            </button>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="data w-full text-sm">
          <thead>
            <tr>
              <th>Document</th>
              <th>Type</th>
              <th>Date</th>
              {isEot ? <th className="text-right">EOT (days)</th> : <th>Reference</th>}
              <th>Read</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted">
                  {docs.length ? "No document matches the filters." : `No documents yet. ${canManage ? "Use Add files or Add a folder above." : ""}`}
                </td>
              </tr>
            )}
            {groups.map((g) => {
              const isOpen = isGroupOpen(g.key);
              const dates = g.docs.map((x) => x.doc_date).filter(Boolean) as string[];
              const latest = dates.sort().at(-1);
              return (
                <Fragment key={g.key}>
                  <tr className="border-t-2 border-line bg-slate-50/80">
                    <td colSpan={6} className="py-2">
                      <div className="flex items-center gap-2">
                        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggleGroup(g.key)} aria-expanded={isOpen}>
                          {isOpen ? <ChevronUp size={15} className="shrink-0 text-navy" /> : <ChevronDown size={15} className="shrink-0 text-navy" />}
                          <span className="truncate font-semibold text-ink">{g.unfiled ? "Not yet filed under a contract" : g.contractor}</span>
                          {g.code && <span className="shrink-0 rounded bg-white px-1.5 py-0.5 font-mono text-xs text-navy ring-1 ring-line">{g.code}</span>}
                          {g.title && <span className="hidden max-w-[20rem] truncate text-xs text-muted lg:inline" title={g.title}>{g.title}</span>}
                          <span className="ml-auto shrink-0 pl-2 text-xs text-muted">
                            {g.docs.length} document{g.docs.length === 1 ? "" : "s"}
                            {latest ? ` · latest ${formatDate(latest)}` : ""}
                          </span>
                        </button>
                        {canManage && (
                          <button
                            className="btn btn-ghost btn-sm shrink-0 text-red-600"
                            onClick={() => removeGroup(g)}
                            disabled={removingGroup !== null}
                            title={`Remove all ${g.docs.length} document${g.docs.length === 1 ? "" : "s"} shown under this heading`}
                          >
                            <Trash2 size={14} /> {removingGroup === g.key ? "Removing…" : "Remove all"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isOpen &&
                    g.docs.map((d) => (
                      <tr key={d.id} className="align-top">
                        <td className="w-[30%] max-w-[24rem] pr-4 align-top">
                          <button className="break-words text-left font-medium text-ink hover:underline" onClick={() => toggle(d.id)} title="Show the summary">
                            {open.has(d.id) ? <ChevronUp size={13} className="mr-1 inline" /> : <ChevronDown size={13} className="mr-1 inline" />}
                            {d.title || d.name}
                          </button>
                          <div className="truncate text-xs text-muted" title={d.rel_path}>
                            {d.rel_path} · {fmtBytes(d.size)}
                          </div>
                          {open.has(d.id) && (
                            <div className="mt-2 rounded-lg border border-line bg-slate-50 p-3 text-xs text-ink">
                              {d.reference && <div><b>Reference:</b> {d.reference}</div>}
                              {d.claim_ref && <div><b>Claim:</b> {d.claim_ref}</div>}
                              {d.po_no && <div><b>PO:</b> {d.po_no}</div>}
                              {(d.cost_claimed != null || d.cost_assessed != null) && (
                                <div>
                                  <b>Cost:</b> claimed {d.cost_claimed != null ? formatMoney(d.cost_claimed) : "–"} · assessed {d.cost_assessed != null ? formatMoney(d.cost_assessed) : "–"}
                                </div>
                              )}
                              <p className="mt-1 whitespace-pre-line">{d.summary}</p>
                              {parseList(d.key_points).length > 0 && (
                                <ul className="mt-1 list-disc pl-5">
                                  {parseList(d.key_points).map((k, i) => (
                                    <li key={i}>{k}</li>
                                  ))}
                                </ul>
                              )}
                              <div className="mt-2 text-muted">
                                Filed by: {d.matched_by} · {d.note ? `${d.note} · ` : ""}added {formatDateTime(d.created_at)} by {d.created_by}
                              </div>
                            </div>
                          )}
                        </td>
                        <td>{d.doc_type || "–"}</td>
                        <td className="whitespace-nowrap">{d.doc_date ? formatDate(d.doc_date) : "–"}</td>
                        {isEot ? (
                          <td className="whitespace-nowrap text-right tnum">
                            {d.eot_days_claimed != null || d.eot_days_assessed != null ? (
                              <>
                                <div>{d.eot_days_assessed ?? "–"} <span className="text-xs text-muted">assessed</span></div>
                                <div className="text-xs text-muted">{d.eot_days_claimed ?? "–"} claimed</div>
                              </>
                            ) : (
                              "–"
                            )}
                          </td>
                        ) : (
                          <td className="max-w-[10rem] truncate" title={d.reference}>{d.reference || "–"}</td>
                        )}
                        <td>
                          <Chip tone={CONF_TONE[d.confidence] ?? "grey"}>{d.read_status === "Manual" ? "Filed by hand" : d.confidence === "None" ? "Not filed" : `${d.confidence} match`}</Chip>
                          <div className="mt-1 text-xs text-muted">{d.read_status}</div>
                        </td>
                        <td className="whitespace-nowrap">
                          <div className="flex flex-wrap gap-1">
                            <a className="btn btn-secondary btn-sm" href={`/api/library/${library}/${d.id}/download`} target="_blank" rel="noopener" title="Open the file">
                              <ExternalLink size={14} /> Open
                            </a>
                            {canManage && (
                              <>
                                <button className="btn btn-secondary btn-sm" onClick={() => startEdit(d)} disabled={busy === d.id} title="Correct the contractor, contract code or type">
                                  <Pencil size={14} /> Change
                                </button>
                                <button className="btn btn-ghost btn-sm" onClick={() => reread(d)} disabled={busy === d.id} title="Read the document again">
                                  <RefreshCw size={14} className={busy === d.id ? "animate-spin" : ""} />
                                </button>
                                <button className="btn btn-ghost btn-sm text-red-600" onClick={() => remove(d)} disabled={busy === d.id} title="Remove">
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="card border-l-4 border-l-navy p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Change: {editing.rel_path}</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
              <X size={14} /> Cancel
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Contractor / Consultant">
              <select className="input" value={form.contractor_id} onChange={(e) => setForm({ ...form, contractor_id: e.target.value, contract_id: contracts.find((c) => String(c.id) === form.contract_id)?.contractor_id === Number(e.target.value) ? form.contract_id : "" })}>
                <option value="">– none –</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Contract (code · title)">
              <select className="input" value={form.contract_id} onChange={(e) => { const c = contracts.find((k) => String(k.id) === e.target.value); setForm({ ...form, contract_id: e.target.value, contractor_id: c?.contractor_id ? String(c.contractor_id) : form.contractor_id }); }}>
                <option value="">– none –</option>
                {(form.contractor_id ? contracts.filter((c) => String(c.contractor_id ?? "") === form.contractor_id) : contracts).map((c) => (
                  <option key={c.id} value={c.id}>{c.acc || c.po} · {c.title}</option>
                ))}
              </select>
            </Field>
            <Field label="Document type">
              <select className="input" value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })}>
                {usedTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Reference"><input className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
            <Field label="Document date"><input type="date" className="input" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></Field>
            {isEot && (
              <>
                <Field label="Claim reference"><input className="input" value={form.claim_ref} onChange={(e) => setForm({ ...form, claim_ref: e.target.value })} /></Field>
                <Field label="EOT claimed (days)"><input className="input" inputMode="numeric" value={form.eot_days_claimed} onChange={(e) => setForm({ ...form, eot_days_claimed: e.target.value })} /></Field>
                <Field label="EOT assessed (days)"><input className="input" inputMode="numeric" value={form.eot_days_assessed} onChange={(e) => setForm({ ...form, eot_days_assessed: e.target.value })} /></Field>
                <Field label="Cost claimed (SAR)"><input className="input" inputMode="decimal" value={form.cost_claimed} onChange={(e) => setForm({ ...form, cost_claimed: e.target.value })} /></Field>
                <Field label="Cost assessed (SAR)"><input className="input" inputMode="decimal" value={form.cost_assessed} onChange={(e) => setForm({ ...form, cost_assessed: e.target.value })} /></Field>
              </>
            )}
            <div className="md:col-span-3">
              <Field label="Summary"><textarea className="input min-h-24" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></Field>
            </div>
          </div>
          <div className="mt-3">
            <button className="btn btn-primary" onClick={saveEdit} disabled={busy === editing.id}>
              <Save size={16} /> Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {children}
    </label>
  );
}

function parseList(s: string): string[] {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("Could not read the file."));
    r.readAsDataURL(blob);
  });
}
