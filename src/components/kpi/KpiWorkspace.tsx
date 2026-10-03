"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, FileDown, FolderUp, Paperclip, Trash2, Upload } from "lucide-react";
import { PAGE_KIND_LABEL, type PageKind } from "@/lib/kpi/pages";
import { useToast } from "@/components/ui/Toast";
import { Chip } from "@/components/ui/Chip";
import { formatDate, formatMoney } from "@/lib/format";
import { KPI_SECTIONS, KPI_SECTION_LABEL, KPI_SECTION_HINT, KPI_SECTION_NO, MOVEMENT_LABEL, kpiSectionsFor, type KpiDoc, type KpiItem, type KpiSection } from "@/lib/kpi/shared";
import { DropZone } from "@/components/ui/DropZone";

export interface KpiRow {
  item: KpiItem;
  sn: string;
  fileName: string;
  rootCause: string;
  remarks: string;
  defaultFileName: string;
  docs: KpiDoc[];
}

const TONE: Record<KpiItem["movement"], "green" | "blue" | "amber" | "grey"> = { closed_now: "green", new: "blue", updated: "amber", unchanged: "grey" };

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** The KPI entries of one category for one report: movement, details, supporting documents and the pack. */
export function KpiWorkspace({ periodId, category, rows, canManage, previousLabel }: { periodId: number; category: "closed" | "open"; rows: KpiRow[]; canManage: boolean; previousLabel: string | null }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const shown = rows;
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted">
        {category === "closed" ? "DVOs recorded as Approved on this report – the head office files them under this month with the DVO, the instruction, the PVO and the RFC / CRF behind each." : "PVOs and VOs recorded or changed on this report with the DVO still pending – the head office wants the instruction, the PVO and the RFC / CRF behind each, and a root cause where the 90-day norm is passed."}
        {previousLabel ? ` Compared with ${previousLabel}.` : ""}
      </div>
      {shown.length === 0 ? (
        <div className="card p-5 text-sm text-muted">{category === "closed" ? "No DVO was approved on this report." : "No PVO or VO was recorded or changed on this report."}</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Vendor · contract</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Instruction</th>
                <th className="px-3 py-2 text-right">PVO value</th>
                <th className="px-3 py-2">DVO</th>
                <th className="px-3 py-2 text-right">{category === "closed" ? "AVV" : "Days left"}</th>
                <th className="px-3 py-2">Movement</th>
                <th className="px-3 py-2 text-right">Docs</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Row key={r.item.changeId} r={r} periodId={periodId} category={category} canManage={canManage} open={open.has(r.item.changeId)} onToggle={() => toggle(r.item.changeId)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ r, periodId, category, canManage, open, onToggle }: { r: KpiRow; periodId: number; category: "closed" | "open"; canManage: boolean; open: boolean; onToggle: () => void }) {
  const it = r.item;
  const router = useRouter();
  const toast = useToast();
  const [docs, setDocs] = useState<KpiDoc[]>(r.docs);
  const [sn, setSn] = useState(r.sn);
  const [fileName, setFileName] = useState(r.fileName);
  const [rootCause, setRootCause] = useState(r.rootCause);
  const [progress, setProgress] = useState<string | null>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const slotInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const slots = kpiSectionsFor(category);
  const over = category === "open" && (it.remainingDays ?? 1) < 0;
  const packName = fileName.trim() || r.defaultFileName;

  async function save(patch: { sn?: string; file_name?: string; root_cause?: string }) {
    const res = await fetch(`/api/kpi/items/${it.changeId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) toast(j.error ?? "Could not save.", "error");
    else router.refresh();
  }

  async function upload(list: FileList | File[] | null, section?: KpiSection) {
    if (!list || !list.length) return;
    const picked = Array.from(list).filter((f) => !/^(\.|~\$|thumbs\.db$|desktop\.ini$)/i.test(f.name));
    if (!picked.length) return;
    const CHUNK = 256 * 1024;
    let added = 0;
    for (let n = 0; n < picked.length; n++) {
      const f = picked[n];
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const count = Math.max(1, Math.ceil(f.size / CHUNK));
      let uploadId = "";
      for (let i = 0; i < count; i++) {
        setProgress(`${n + 1} of ${picked.length}: ${rel}${count > 1 ? ` (part ${i + 1} of ${count})` : ""}`);
        const data = await toBase64(f.slice(i * CHUNK, (i + 1) * CHUNK));
        let j: { error?: string; uploadId?: string; doc?: KpiDoc } = {};
        try {
          const res = await fetch("/api/kpi/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, changeId: it.changeId, name: f.name, relPath: rel, mime: f.type, size: f.size, index: i, count, data, section }) });
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
          setDocs((cur) => [...cur.filter((x) => x.rel_path !== doc.rel_path), doc]);
          added++;
        }
      }
    }
    setProgress(null);
    if (added) toast(`${added} document${added === 1 ? "" : "s"} added to ${it.itemNo}.`);
  }

  async function patch(doc: KpiDoc, body: { section?: string; pages?: string }) {
    const res = await fetch(`/api/kpi/docs/${doc.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error ?? "Could not change the document.", "error");
    setDocs((cur) => cur.map((d) => (d.id === doc.id ? j.doc : d)));
  }

  async function remove(doc: KpiDoc) {
    if (!confirm(`Remove ${doc.name} from this KPI entry?`)) return;
    const res = await fetch(`/api/kpi/docs/${doc.id}`, { method: "DELETE" });
    if (!res.ok) return toast("Could not remove the document.", "error");
    setDocs((cur) => cur.filter((d) => d.id !== doc.id));
  }

  return (
    <>
      <tr className={`border-t border-line ${open ? "bg-slate-50" : ""}`}>
        <td className="px-2 py-1.5 align-top">
          <button className="rounded p-1 text-muted hover:bg-slate-100" onClick={onToggle} aria-label={open ? "Collapse" : "Expand"}>
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 align-top font-medium text-ink">
          {it.itemNo}
          {sn && <div className="text-[11px] text-muted">S/N {sn}</div>}
        </td>
        <td className="max-w-[14rem] px-3 py-1.5 align-top">
          <div className="truncate" title={it.vendor}>{it.vendor}</div>
          <div className="text-[11px] text-muted">{it.accContractRef}{it.reefPo ? ` · PO ${it.reefPo}` : ""}</div>
        </td>
        <td className="max-w-[22rem] px-3 py-1.5 align-top text-xs" title={it.description}>
          <div className="line-clamp-2">{it.description}</div>
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 align-top text-xs">
          {it.instructionRef || "–"}
          <div className="text-muted">{it.instructionDate ? formatDate(it.instructionDate) : ""}</div>
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 text-right align-top tnum">{it.pvoValue !== null ? formatMoney(it.pvoValue) : "–"}</td>
        <td className="whitespace-nowrap px-3 py-1.5 align-top text-xs">
          {it.dvoRef || (category === "closed" ? "–" : "pending")}
          <div className="text-muted">{it.dvoDate ? formatDate(it.dvoDate) : it.category === "open" && it.dvoRef ? "not yet approved" : ""}</div>
        </td>
        <td className={`whitespace-nowrap px-3 py-1.5 text-right align-top tnum ${over ? "font-semibold text-red-700" : ""}`}>
          {category === "closed" ? (it.avvValue !== null ? formatMoney(it.avvValue) : "–") : it.remainingDays === null ? "–" : it.remainingDays}
          {category === "closed" && it.daysToClose !== null && <div className="text-[11px] font-normal text-muted">{it.daysToClose} days</div>}
        </td>
        <td className="px-3 py-1.5 align-top">
          <Chip tone={TONE[it.movement]}>{MOVEMENT_LABEL[it.movement]}</Chip>
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 text-right align-top">
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Paperclip size={12} /> {docs.length}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-line bg-slate-50">
          <td />
          <td colSpan={9} className="px-3 pb-4 pt-1">
            <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
              <div className="space-y-3 text-xs">
                <div className="rounded-lg border border-line bg-white p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Movement since the previous report</div>
                  <div className="text-sm text-ink">{it.movementNote || "–"}</div>
                  {it.previous && (
                    <div className="mt-1 text-muted">
                      Previous report: {it.previous.category === "closed" ? "Closed KPI" : "Open KPI"}
                      {it.previous.instructionRef ? ` · instruction ${it.previous.instructionRef}` : ""}
                      {it.previous.dvoRef ? ` · DVO ${it.previous.dvoRef}` : ""}
                      {it.previous.pvoValue !== null ? ` · PVO ${formatMoney(it.previous.pvoValue)}` : ""}
                      {it.previous.avvValue !== null ? ` · AVV ${formatMoney(it.previous.avvValue)}` : ""}
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-muted">
                    <div>Project: <b className="text-ink">{it.projectName}</b> · {it.assetCode}</div>
                    <div>Status: <b className="text-ink">{it.dvoStatus}</b> {it.overallStatus ? `(${it.overallStatus} overall)` : ""}</div>
                    <div>PVO ref: <b className="text-ink">{it.pvoRef || "–"}</b>{it.pvoDate ? ` · ${formatDate(it.pvoDate)}` : ""}</div>
                    <div>RFC ref: <b className="text-ink">{it.rfcRef || "–"}</b></div>
                    <div>Deadline (90 days): <b className={over ? "text-red-700" : "text-ink"}>{it.deadline ? formatDate(it.deadline) : "–"}</b></div>
                    <div>{category === "closed" ? <>F1: <b className="text-ink">{it.f1 === null ? "–" : it.f1 ? "met" : "not met"}</b>{it.f2 !== null ? ` · F2 ${(it.f2 * 100).toFixed(1)}%` : ""}</> : <>Days remaining: <b className={over ? "text-red-700" : "text-ink"}>{it.remainingDays ?? "–"}</b></>}</div>
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-white p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Head office details</div>
                  <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
                    <label className="text-muted">
                      S/N on the register
                      <input className="input mt-0.5 w-full" value={sn} disabled={!canManage} onChange={(e) => setSn(e.target.value)} onBlur={() => sn !== r.sn && save({ sn })} placeholder="e.g. 43" />
                    </label>
                    <label className="text-muted">
                      Pack file name
                      <input className="input mt-0.5 w-full" value={fileName} disabled={!canManage} onChange={(e) => setFileName(e.target.value)} onBlur={() => fileName !== r.fileName && save({ file_name: fileName })} placeholder={r.defaultFileName} />
                    </label>
                  </div>
                  <label className="mt-2 block text-muted">
                    Root cause of exceeding 90 days {over && <span className="text-red-700">(required by the head office)</span>}
                    <textarea className="input mt-0.5 w-full" rows={2} value={rootCause} disabled={!canManage} onChange={(e) => setRootCause(e.target.value)} onBlur={() => rootCause !== r.rootCause && save({ root_cause: rootCause })} placeholder="A clear and specific justification for the delay" />
                  </label>
                </div>
              </div>
              <DropZone onFiles={(files) => void upload(files)} disabled={!canManage || !!progress} label="Drop the files or the folder – each is filed under the part its folder or name says" className="rounded-lg border border-line bg-white p-3 text-xs">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Supporting documents · {docs.length}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {canManage && (
                      <>
                        <input ref={dirInput} type="file" multiple className="hidden" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
                        <button className="btn btn-xs btn-secondary" onClick={() => dirInput.current?.click()} disabled={!!progress} title="A folder holding every part: each file is filed under the part its folder or name says (1. DVO approval, 2. DVO, 3. PVO VO approval, 4. PVO VO, 5. VO issued Aconex reference, 6. Letter + VO issued)">
                          <FolderUp size={12} /> Upload a folder
                        </button>
                      </>
                    )}
                    <a className="btn btn-xs btn-pdf" href={`/api/kpi/pack?change=${it.changeId}&period=${periodId}`} title={`Cover, one divider per part and the key pages of every document in one PDF: ${packName}.pdf`}>
                      <FileDown size={12} /> Create KPI PDF pack
                    </a>
                  </div>
                </div>
                {progress && <div className="mb-2 text-navy">Uploading {progress}…</div>}
                <div className="mb-2 text-muted">Pack file: <span className="font-mono text-ink">{packName}.pdf</span> · only the key pages of each file go in (the pages box shows which; change it if needed)</div>
                <ol className="space-y-2">
                  {slots.map((sec) => {
                    const mine = docs.filter((d) => d.section === sec);
                    return (
                      <li key={sec} className="rounded border border-line">
                        <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-2 py-1.5">
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-700 text-[11px] font-semibold text-white">{KPI_SECTION_NO[sec]}</span>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-ink">{KPI_SECTION_LABEL[sec]}</div>
                            <div className="text-[11px] text-muted">{KPI_SECTION_HINT[sec]}</div>
                          </div>
                          {mine.length === 0 && <span className="text-[11px] text-amber-700">nothing uploaded</span>}
                          {canManage && (
                            <>
                              <input ref={(el) => { slotInputs.current[sec] = el; }} type="file" multiple className="hidden" onChange={(e) => { upload(e.target.files, sec); e.target.value = ""; }} />
                              <button className="btn btn-xs btn-secondary" onClick={() => slotInputs.current[sec]?.click()} title="One or several files of any type into this part">
                                <Upload size={12} /> Files
                              </button>
                              <input ref={(el) => { slotInputs.current[`${sec}:dir`] = el; }} type="file" multiple className="hidden" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => { upload(e.target.files, sec); e.target.value = ""; }} />
                              <button className="btn btn-xs btn-secondary" onClick={() => slotInputs.current[`${sec}:dir`]?.click()} title="A whole folder into this part">
                                <FolderUp size={12} /> Folder
                              </button>
                            </>
                          )}
                        </div>
                        {mine.length > 0 && (
                          <ul className="divide-y divide-line">
                            {mine.map((d) => (
                              <li key={d.id} className="flex flex-wrap items-center gap-2 px-2 py-1">
                                <a className="min-w-0 flex-1 truncate text-ink hover:underline" href={`/api/kpi/docs/${d.id}/download`} target="_blank" rel="noopener" title={d.rel_path}>
                                  {d.name}
                                </a>
                                <span className="text-muted">{(d.size / 1024 / 1024).toFixed(1)} MB</span>
                                {d.page_count > 0 && <PagesPicker doc={d} canManage={canManage} onSave={(pages) => patch(d, { pages })} />}
                                {canManage && (
                                  <>
                                    <select className="input h-6 w-44 py-0 text-[11px]" value={d.section} onChange={(e) => patch(d, { section: e.target.value })} title="Move to another part of the pack">
                                      {KPI_SECTIONS.map((s2) => (
                                        <option key={s2} value={s2}>{KPI_SECTION_NO[s2]}. {KPI_SECTION_LABEL[s2]}</option>
                                      ))}
                                    </select>
                                    <button className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-700" onClick={() => remove(d)} aria-label="Remove">
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
                  {docs.some((d) => !slots.includes(d.section)) && (
                    <li className="rounded border border-dashed border-line px-2 py-1.5 text-[11px] text-muted">
                      {docs.filter((d) => !slots.includes(d.section)).length} document(s) sit in a part this KPI does not use ({docs.filter((d) => !slots.includes(d.section)).map((d) => d.name).join(", ")}); they still go into the pack.
                    </li>
                  )}
                </ol>
              </DropZone>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** "Pages 1-3, 5 of 24" – which pages of the file go into the pack, with what each page was read as. */
function PagesPicker({ doc, canManage, onSave }: { doc: KpiDoc; canManage: boolean; onSave: (pages: string) => void }) {
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
