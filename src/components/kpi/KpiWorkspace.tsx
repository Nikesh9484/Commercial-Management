"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, FileDown, FolderUp, Paperclip, Trash2, Upload } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Chip } from "@/components/ui/Chip";
import { formatDate, formatMoney } from "@/lib/format";
import { KPI_SECTIONS, KPI_SECTION_LABEL, MOVEMENT_LABEL, type KpiDoc, type KpiItem } from "@/lib/kpi/shared";

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
export function KpiWorkspace({ periodId, category, rows, earlier, canManage, previousLabel }: { periodId: number; category: "closed" | "open"; rows: KpiRow[]; earlier: KpiRow[]; canManage: boolean; previousLabel: string | null }) {
  const [movedOnly, setMovedOnly] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [showEarlier, setShowEarlier] = useState(false);
  const toggle = (id: number) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const shown = movedOnly ? rows.filter((r) => r.item.movement !== "unchanged") : rows;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <div>
          {category === "closed" ? "DVOs recorded as Approved on this report – the head office files them under this month with the DVO, the instruction, the PVO and the RFC / CRF behind each." : "PVOs and VOs recorded with the DVO still pending – the head office wants the instruction, the PVO and the RFC / CRF behind each, and a root cause where the 90-day norm is passed."}
        </div>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={movedOnly} onChange={(e) => setMovedOnly(e.target.checked)} /> Only what moved {previousLabel ? `since ${previousLabel}` : "this report"}
        </label>
      </div>
      {shown.length === 0 ? (
        <div className="card p-5 text-sm text-muted">{movedOnly ? "Nothing moved under this heading since the previous report." : `No ${category === "closed" ? "approved DVOs" : "pending VOs or PVOs"} on this report.`}</div>
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
      {earlier.length > 0 && (
        <div className="card p-4 text-sm">
          <button className="flex items-center gap-2 text-left font-medium text-ink" onClick={() => setShowEarlier((v) => !v)}>
            {showEarlier ? <ChevronDown size={16} /> : <ChevronRight size={16} />} DVOs approved on earlier reports ({earlier.length}) – already reported, kept for reference
          </button>
          {showEarlier && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <tbody>
                  {earlier.map((r) => (
                    <Row key={r.item.changeId} r={r} periodId={periodId} category="closed" canManage={canManage} open={open.has(r.item.changeId)} onToggle={() => toggle(r.item.changeId)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const over = category === "open" && (it.remainingDays ?? 1) < 0;
  const packName = fileName.trim() || r.defaultFileName;

  async function save(patch: { sn?: string; file_name?: string; root_cause?: string }) {
    const res = await fetch(`/api/kpi/items/${it.changeId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) toast(j.error ?? "Could not save.", "error");
    else router.refresh();
  }

  async function upload(list: FileList | null) {
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
          const res = await fetch("/api/kpi/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, changeId: it.changeId, name: f.name, relPath: rel, mime: f.type, size: f.size, index: i, count, data }) });
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

  async function move(doc: KpiDoc, section: string) {
    const res = await fetch(`/api/kpi/docs/${doc.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error ?? "Could not move the document.", "error");
    setDocs((cur) => cur.map((d) => (d.id === doc.id ? j.doc : d)));
  }

  async function remove(doc: KpiDoc) {
    if (!confirm(`Remove ${doc.name} from this KPI entry?`)) return;
    const res = await fetch(`/api/kpi/docs/${doc.id}`, { method: "DELETE" });
    if (!res.ok) return toast("Could not remove the document.", "error");
    setDocs((cur) => cur.filter((d) => d.id !== doc.id));
  }

  const bySection = KPI_SECTIONS.map((s) => ({ section: s, docs: docs.filter((d) => d.section === s) })).filter((g) => g.docs.length);
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
              <div className="rounded-lg border border-line bg-white p-3 text-xs">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Supporting documents · {docs.length}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {canManage && (
                      <>
                        <input ref={fileInput} type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
                        <input ref={dirInput} type="file" multiple className="hidden" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
                        <button className="btn btn-xs btn-secondary" onClick={() => fileInput.current?.click()} disabled={!!progress}>
                          <Upload size={12} /> Upload files
                        </button>
                        <button className="btn btn-xs btn-secondary" onClick={() => dirInput.current?.click()} disabled={!!progress} title="A folder with sub-folders such as A. DVO, B. Instruction, C. PVO, D. RFC – each file is filed under its part">
                          <FolderUp size={12} /> Upload folder
                        </button>
                      </>
                    )}
                    <a className="btn btn-xs btn-pdf" href={`/api/kpi/pack?change=${it.changeId}&period=${periodId}`} title={`Cover, dividers and every document in one PDF: ${packName}.pdf`}>
                      <FileDown size={12} /> Create KPI PDF pack
                    </a>
                  </div>
                </div>
                {progress && <div className="mb-2 text-navy">Uploading {progress}…</div>}
                <div className="mb-2 text-muted">Pack file: <span className="font-mono text-ink">{packName}.pdf</span></div>
                {docs.length === 0 ? (
                  <div className="text-muted">Nothing uploaded yet. Upload the {category === "closed" ? "executed DVO, the instruction (VO form and letter), the PVO and the RFC / CRF" : "instruction (VO form and letter), the PVO and the RFC / CRF"} – as files or as a folder – and each is filed under its part of the pack.</div>
                ) : (
                  <div className="space-y-2">
                    {bySection.map((g) => (
                      <div key={g.section}>
                        <div className="font-semibold text-navy">{KPI_SECTION_LABEL[g.section]}</div>
                        <ul className="mt-1 divide-y divide-line rounded border border-line">
                          {g.docs.map((d) => (
                            <li key={d.id} className="flex flex-wrap items-center gap-2 px-2 py-1">
                              <a className="min-w-0 flex-1 truncate text-ink hover:underline" href={`/api/kpi/docs/${d.id}/download`} target="_blank" rel="noopener" title={d.rel_path}>
                                {d.name}
                              </a>
                              <span className="text-muted">{(d.size / 1024 / 1024).toFixed(1)} MB</span>
                              {canManage && (
                                <>
                                  <select className="input h-6 w-36 py-0 text-[11px]" value={d.section} onChange={(e) => move(d, e.target.value)}>
                                    {KPI_SECTIONS.map((s) => (
                                      <option key={s} value={s}>{KPI_SECTION_LABEL[s].slice(0, 6)}</option>
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
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
