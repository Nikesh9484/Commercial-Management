"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowRight, Lock, Info, Files } from "lucide-react";
import type { WorkbookAnalysis, SheetAnalysis } from "@/lib/workbook/analyze";
import type { ImportResult } from "@/lib/workbook/import";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";

interface RegisterMeta {
  key: string;
  label: string;
  fields: { key: string; label: string; required?: boolean }[];
}
interface PeriodOption {
  id: number;
  label: string;
  status: string;
  report_no: number;
}

interface BatchItem {
  name: string;
  size: number;
  status: "queued" | "reading" | "ready" | "importing" | "done" | "warning" | "skipped" | "error";
  reportNo?: number;
  periodEnd?: string;
  message: string;
  result?: ImportResult;
}

export interface StandaloneMode {
  /** Registers this page may write; sheets read as anything else are ignored. */
  only: string[];
  /** The report (period) being updated – always the one selected in the top bar. */
  period: { id: number; label: string };
  intro: string;
  fileHint: string;
  doneHref: string;
  doneLabel: string;
}

export function WorkbookImporter({ registers, periods, isAdmin, defaultReportNo, standalone, excludeRegisters = [], initialPeriodId }: { registers: RegisterMeta[]; periods: PeriodOption[]; isAdmin: boolean; defaultReportNo: number; standalone?: StandaloneMode; excludeRegisters?: string[]; initialPeriodId?: number | null }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [analysis, setAnalysis] = useState<WorkbookAnalysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, { register: string | null; columns: Record<string, string | null> }>>({});
  const preset = initialPeriodId ? periods.find((p) => p.id === initialPeriodId) ?? null : null;
  const [periodMode, setPeriodMode] = useState<"existing" | "new">(preset || periods.some((p) => p.status === "Open") ? "existing" : "new");
  const [periodId, setPeriodId] = useState<number | null>(preset?.id ?? periods.find((p) => p.status === "Open")?.id ?? null);
  const [reportNo, setReportNo] = useState<string>(String(defaultReportNo));
  const [periodEnd, setPeriodEnd] = useState("");
  const [lock, setLock] = useState(isAdmin);
  const [createLookups, setCreateLookups] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);

  const [progress, setProgress] = useState("");
  const router = useRouter();

  // Several reports in one go (monthly import only)
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);

  /**
   * Uploads a file and returns the app's reading of it. The file goes up in small text pieces
   * (base64 JSON): big binary uploads get cut short by some company web filters; small text
   * requests pass, and the server checks the total size at the end.
   */
  async function uploadAndAnalyze(f: File, onProgress: (msg: string) => void): Promise<WorkbookAnalysis> {
    const CHUNK = 256 * 1024;
    const count = Math.max(1, Math.ceil(f.size / CHUNK));
    let uploadId = "";
    let j: { error?: string; uploadId?: string } = {};
    for (let i = 0; i < count; i++) {
      onProgress(count > 1 ? `Uploading part ${i + 1} of ${count}…` : "Uploading…");
      const piece = f.slice(i * CHUNK, (i + 1) * CHUNK);
      const data = await toBase64(piece);
      let res: Response;
      let text = "";
      try {
        res = await fetch("/api/workbook/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId, name: f.name, size: f.size, index: i, count, data }),
        });
        text = await res.text();
      } catch (e) {
        throw new Error(`Upload failed on part ${i + 1} of ${count}: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        j = JSON.parse(text);
      } catch {
        throw new Error(`The server replied with an unexpected answer (${res.status}). ${text.slice(0, 120)}`);
      }
      if (!res.ok) throw new Error(j.error ?? "Could not read the file.");
      uploadId = j.uploadId ?? uploadId;
    }
    return j as unknown as WorkbookAnalysis;
  }

  async function analyze() {
    if (!file) return;
    setBusy(true);
    let a: WorkbookAnalysis;
    try {
      a = await uploadAndAnalyze(file, setProgress);
    } catch (e) {
      setBusy(false);
      setProgress("");
      return toast(e instanceof Error ? e.message : String(e), "error");
    }
    setBusy(false);
    setProgress("");
    setAnalysis(a);
    if (a.conversion) {
      // A known report layout was converted: suggest the period the report is for.
      const existing = a.conversion.reportNo ? periods.find((p) => p.report_no === a.conversion!.reportNo) : undefined;
      if (preset) {
        // re-upload into the report chosen in the library: keep it
      } else if (existing && existing.status === "Open") {
        setPeriodMode("existing");
        setPeriodId(existing.id);
      } else if (!existing) {
        setPeriodMode("new");
        if (a.conversion.reportNo) setReportNo(String(a.conversion.reportNo));
        if (a.conversion.periodEnd) setPeriodEnd(a.conversion.periodEnd);
      }
    }
    const m: typeof mapping = {};
    for (const s of a.sheets) {
      // a stand-alone page only writes its own registers: sheets read as anything else are skipped;
      // excluded registers (claims on the monthly import) are skipped too
      const reg = (standalone && s.register && !standalone.only.includes(s.register)) || (s.register && excludeRegisters.includes(s.register)) ? null : s.register;
      m[s.name] = { register: reg, columns: Object.fromEntries(s.columns.map((c) => [String(c.index), c.field])) };
    }
    setMapping(m);
    setResult(null);
  }

  async function run() {
    if (!analysis) return;
    setBusy(true);
    setPhase("Starting…");
    const body = {
      fileId: analysis.fileId,
      period: standalone ? { id: standalone.period.id } : periodMode === "existing" ? { id: periodId } : { report_no: Number(reportNo.replace(/\D/g, "")) || undefined, period_end: periodEnd },
      sheets: analysis.sheets.map((s) => ({ sheet: s.name, headerRow: s.headerRow, register: mapping[s.name]?.register ?? null, columns: mapping[s.name]?.columns ?? {} })),
      lock: standalone ? false : lock,
      createMissingLookups: createLookups,
      allowedRegisters: standalone?.only ?? (excludeRegisters.length ? registers.map((r) => r.key) : undefined),
      fileName: analysis.fileName,
      excelCheck: analysis.conversion?.level1 ?? null,
    };
    try {
      const j = await importViaJob(body, setPhase);
      setResult(j);
      toast("Workbook imported.");
    } catch (e) {
      toast(friendly(e), "error");
    } finally {
      setBusy(false);
      setPhase("");
    }
  }

  /**
   * Several monthly reports in one go: every file is read first (each recognised report says which
   * report number and cut-off it is for), then they are imported from the lowest report number up, so
   * every month is stored as its own report and the highest becomes the live one. Files whose layout
   * is not recognised are left for the one-at-a-time import above.
   */
  async function runBatch() {
    if (!batchFiles.length) return;
    setBatchBusy(true);
    const items: BatchItem[] = batchFiles.map((f) => ({ name: f.name, size: f.size, status: "queued", message: "" }));
    const update = (i: number, patch: Partial<BatchItem>) => {
      items[i] = { ...items[i], ...patch };
      setBatch([...items]);
    };
    setBatch([...items]);
    const analyses: (WorkbookAnalysis | null)[] = [];
    for (let i = 0; i < batchFiles.length; i++) {
      update(i, { status: "reading", message: "Reading…" });
      try {
        if (i > 0) await pause(2000); // let the server settle between big files (memory on the small hosting plan)
        const a = await uploadAndAnalyze(batchFiles[i], (m) => update(i, { message: m }));
        analyses.push(a);
        if (!a.conversion) update(i, { status: "skipped", message: "Layout not recognised – import this file on its own above and map its sheets by hand." });
        else if (!a.conversion.reportNo || !a.conversion.periodEnd) update(i, { status: "skipped", message: "The report number or reporting period could not be read from the file – import it on its own above and type them in." });
        else update(i, { status: "ready", reportNo: a.conversion.reportNo, periodEnd: a.conversion.periodEnd, message: `Report No ${a.conversion.reportNo} · cut-off ${a.conversion.periodEnd}` });
      } catch (e) {
        analyses.push(null);
        update(i, { status: "error", message: friendly(e) });
      }
    }
    // import from the lowest report number up
    const order = items.map((it, i) => i).filter((i) => items[i].status === "ready").sort((x, y) => items[x].reportNo! - items[y].reportNo!);
    const known = periods.map((p) => ({ id: p.id, report_no: p.report_no, status: p.status, label: p.label }));
    for (const i of order) {
      const a = analyses[i]!;
      const no = items[i].reportNo!;
      const existing = known.find((p) => p.report_no === no);
      if (existing && existing.status === "Locked") {
        update(i, { status: "skipped", message: `${existing.label} is locked (issued). Unlock it in the report library first if it should be replaced.` });
        continue;
      }
      update(i, { status: "importing", message: `Importing Report No ${no}…` });
      await pause(1500);
      const body = {
        fileId: a.fileId,
        period: existing ? { id: existing.id } : { report_no: no, period_end: items[i].periodEnd },
        sheets: a.sheets.map((s) => ({ sheet: s.name, headerRow: s.headerRow, register: s.register && excludeRegisters.includes(s.register) ? null : s.register, columns: Object.fromEntries(s.columns.map((c) => [String(c.index), c.field])) })),
        lock,
        createMissingLookups: createLookups,
        allowedRegisters: excludeRegisters.length ? registers.map((r) => r.key) : undefined,
        fileName: a.fileName,
        excelCheck: a.conversion?.level1 ?? null,
      };
      try {
        const j = await importViaJob(body, (m) => update(i, { message: `Importing Report No ${no}… ${m}` }));
        if (!existing) known.push({ id: j.period.id, report_no: no, status: j.period.locked ? "Locked" : "Open", label: j.period.label });
        const added = j.sheets.reduce((t, r) => t + r.created, 0);
        const updated = j.sheets.reduce((t, r) => t + r.updated, 0);
        const errors = j.sheets.reduce((t, r) => t + r.errors.length, 0);
        update(i, { status: errors ? "warning" : "done", result: j, message: `${j.period.label}${existing ? " (replaced)" : ""}: ${added} added, ${updated} updated${errors ? `, ${errors} row(s) could not be read` : ""}${j.period.locked ? " · locked" : ""}` });
      } catch (e) {
        update(i, { status: "error", message: friendly(e) });
      }
    }
    setBatchBusy(false);
    toast(`${items.filter((x) => x.status === "done" || x.status === "warning").length} report(s) imported into the library.`);
    router.refresh();
  }

  const mappedSheets = analysis ? analysis.sheets.filter((s) => mapping[s.name]?.register) : [];
  // the month being imported vs the latest report that exists
  const targetNo = periodMode === "existing" ? (periods.find((p) => p.id === periodId)?.report_no ?? null) : Number(reportNo.replace(/\D/g, "")) || null;
  const newest = periods.reduce<(typeof periods)[number] | null>((a, p) => (!a || p.report_no > a.report_no ? p : a), null);
  const olderThan = targetNo !== null && newest && newest.report_no > targetNo ? newest.label : null;

  return (
    <div className="space-y-5">
      {!standalone && (
        <div className="card p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
            <Files size={16} className="text-navy" /> Several reports in one go
          </h2>
          <p className="mb-3 text-xs text-muted">
            Choose all the monthly report workbooks you want in the library (hold Ctrl / ⌘ while picking). Each file is read, its report number and cut-off are taken from the workbook itself, and the reports are imported from the lowest number up – every month is stored as its own report and the highest becomes the live one. A report that already exists and is open is replaced; a locked one is skipped. Files in a layout the app does not recognise are listed so you can import them one at a time below.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-muted">
              Excel files (.xlsx) – as many as you like
              <input type="file" accept=".xlsx" multiple className="input" onChange={(e) => { setBatchFiles(Array.from(e.target.files ?? [])); setBatch([]); }} disabled={batchBusy} />
            </label>
            {isAdmin && (
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-navy" checked={lock} onChange={(e) => setLock(e.target.checked)} /> <Lock size={14} /> Lock each report after importing
              </label>
            )}
            <button className="btn btn-primary" onClick={runBatch} disabled={!batchFiles.length || batchBusy}>
              <Upload size={16} /> {batchBusy ? "Importing…" : `Import ${batchFiles.length || ""} report${batchFiles.length === 1 ? "" : "s"}`}
            </button>
          </div>
          {batch.length > 0 && (
            <table className="data mt-4 w-full text-sm">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Report</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {batch.map((b, i) => (
                  <tr key={i}>
                    <td className="font-medium">{b.name}</td>
                    <td className="whitespace-nowrap">{b.reportNo ? `No ${b.reportNo} · ${b.periodEnd}` : "–"}</td>
                    <td>
                      <Chip tone={b.status === "done" ? "green" : b.status === "error" ? "red" : b.status === "skipped" || b.status === "warning" ? "amber" : "blue"}>
                        {b.status === "done" ? "Imported" : b.status === "warning" ? "Imported with errors" : b.status === "error" ? "Failed" : b.status === "skipped" ? "Skipped" : b.status === "importing" ? "Importing…" : b.status === "reading" ? "Reading…" : b.status === "ready" ? "Ready" : "Queued"}
                      </Chip>
                      <div className="mt-1 text-xs text-muted">{b.message}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {batch.length > 0 && !batchBusy && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/modules/monthly-report/library" className="btn btn-secondary btn-sm">
                Open the report library <ArrowRight size={14} />
              </Link>
              <Link href="/" className="btn btn-secondary btn-sm">
                Executive summary <ArrowRight size={14} />
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Step 1 */}
      <div className="card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-navy text-xs text-white">1</span> {standalone ? "Choose the Excel file" : "Choose the workbook and the month it belongs to"}
        </h2>
        <p className="mb-3 text-xs text-muted">{standalone ? standalone.intro : "Your monthly report workbook (.xlsx). The app reads every sheet it recognises: cost report lines, change tracker, claims, early warnings, risks, provisional sums, bonds, contracts, IPC log, budget transfers, project team."}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Excel file{standalone ? ` – ${standalone.fileHint}` : ""}
            <input type="file" accept=".xlsx" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {standalone ? (
            <div className="rounded-lg border border-line bg-slate-50 p-3 text-xs text-ink">
              <div className="font-semibold text-muted">Updates this report only</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
                <Lock size={14} className="text-navy" /> {standalone.period.label}
              </div>
              <div className="mt-1 text-muted">The report selected in the top bar. Rows are matched by their reference number: existing rows are updated, new ones added. Nothing else in the dashboard changes.</div>
            </div>
          ) : (
          <div className="space-y-2">
            <div className="flex gap-3 text-xs">
              <label className="inline-flex items-center gap-1">
                <input type="radio" checked={periodMode === "existing"} onChange={() => setPeriodMode("existing")} /> Existing period
              </label>
              <label className="inline-flex items-center gap-1">
                <input type="radio" checked={periodMode === "new"} onChange={() => setPeriodMode("new")} /> New period
              </label>
            </div>
            {periodMode === "existing" ? (
              <select className="input" value={periodId ?? ""} onChange={(e) => setPeriodId(Number(e.target.value))}>
                {periods.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.status === "Locked"}>
                    {p.label} · {p.status}
                  </option>
                ))}
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Report No
                  <input type="text" inputMode="numeric" className="input" value={reportNo} onChange={(e) => setReportNo(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 1" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Cut-off date (month end)
                  <input type="date" className="input" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                </label>
              </div>
            )}
          </div>
          )}
        </div>
        {!standalone && olderThan && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900">
            <Info size={14} className="mt-0.5 shrink-0" />
            <div>
              <b>Older month.</b> {olderThan} already exists and stays the live report. This month is imported and stored as its own report, and {olderThan}&apos;s live figures are put back automatically when the import finishes.
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" onClick={analyze} disabled={!file || busy}>
            <FileSpreadsheet size={16} /> {busy && !analysis ? progress || "Reading…" : "Read the workbook"}
          </button>
          <span className="text-xs text-muted">Nothing is saved at this step; you review the app&apos;s reading first.</span>
        </div>
      </div>

      {/* Step 2 */}
      {analysis && !result && (
        <div className="card p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-navy text-xs text-white">2</span> Check how each sheet was read
          </h2>
          {analysis.conversion && (
            <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <div className="font-semibold">The file layout was recognised and converted automatically.</div>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {analysis.conversion.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mb-3 text-xs text-muted">
            For each sheet, confirm which register it is and which column goes to which field. Columns left as &quot;— not used —&quot; are ignored (calculated columns like Latest Budget or Anticipated Final Account should stay unused; the app calculates them). Your choices are remembered for next month.
          </p>
          <div className="space-y-4">
            {analysis.sheets.map((s) => (
              <SheetMapper key={s.name} sheet={s} registers={registers} value={mapping[s.name]} onChange={(v) => setMapping((m) => ({ ...m, [s.name]: v }))} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line pt-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-navy" checked={createLookups} onChange={(e) => setCreateLookups(e.target.checked)} /> Create missing packages, contractors and dropdown values automatically
            </label>
            {isAdmin && !standalone && (
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-navy" checked={lock} onChange={(e) => setLock(e.target.checked)} /> <Lock size={14} /> Lock the period after importing (if there are no errors)
              </label>
            )}
            <button className="btn btn-primary ml-auto" onClick={run} disabled={busy || mappedSheets.length === 0}>
              <Upload size={16} /> {busy ? "Importing…" : `Import ${mappedSheets.length} sheet(s)`}
            </button>
          </div>
          {busy && phase && (
            <p className="mt-2 text-xs text-muted" aria-live="polite">
              {phase} – the import runs on the server; keep this page open. On the small hosting plan a full monthly report can take a few minutes.
            </p>
          )}
        </div>
      )}

      {/* Step 3 */}
      {result && (
        <div className="card p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-600 text-xs text-white">3</span> Result for {result.period.label}
          </h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {!standalone && <Chip tone={result.period.locked ? "green" : "amber"}>{result.period.locked ? "Period locked – snapshot stored" : "Period left open"}</Chip>}
            {result.period.olderThan && <Chip tone="blue">Stored as its own report · {result.period.olderThan} stays live</Chip>}
            {result.lookupsCreated.length > 0 && <Chip tone="blue">{result.lookupsCreated.length} dropdown value(s) created</Chip>}
          </div>
          <table className="data w-full">
            <thead>
              <tr>
                <th>Sheet</th>
                <th>Register</th>
                <th className="text-right">Added</th>
                <th className="text-right">Updated</th>
                <th className="text-right">Unchanged</th>
                <th className="text-right">Skipped</th>
                <th className="text-right">Errors</th>
              </tr>
            </thead>
            <tbody>
              {result.sheets.map((r) => (
                <tr key={r.sheet}>
                  <td className="font-medium">{r.sheet}</td>
                  <td>{registers.find((x) => x.key === r.register)?.label ?? r.register}</td>
                  <td className="tnum text-right">{r.created}</td>
                  <td className="tnum text-right">{r.updated}</td>
                  <td className="tnum text-right">{r.unchanged}</td>
                  <td className="tnum text-right text-muted">{r.skipped}</td>
                  <td className={`tnum text-right ${r.errors.length ? "font-semibold text-red-700" : ""}`}>{r.errors.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.sheets.some((r) => r.errors.length) && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <div className="mb-1 flex items-center gap-1 font-semibold">
                <AlertTriangle size={14} /> Rows that could not be read
              </div>
              <ul className="max-h-60 space-y-0.5 overflow-y-auto">
                {result.sheets.flatMap((r) => r.errors.map((e) => (
                  <li key={`${r.sheet}-${e.row}`}>
                    {r.sheet} row {e.row}: {e.message}
                  </li>
                )))}
              </ul>
              <p className="mt-2">Fix these rows in Excel (or adjust the column mapping) and import the same file again: rows already imported are simply updated.</p>
            </div>
          )}
          {result.lookupsCreated.length > 0 && <p className="mt-2 text-xs text-muted">Created: {result.lookupsCreated.join(", ")}.</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {standalone ? (
              <Link href={standalone.doneHref} className="btn btn-primary btn-sm">
                <CheckCircle2 size={14} /> {standalone.doneLabel} <ArrowRight size={14} />
              </Link>
            ) : (
              <>
                <Link href="/modules/cost-report" className="btn btn-secondary btn-sm">
                  Check the cost report <ArrowRight size={14} />
                </Link>
                <Link href="/" className="btn btn-secondary btn-sm">
                  Executive summary <ArrowRight size={14} />
                </Link>
                <Link href="/modules/monthly-report" className="btn btn-primary btn-sm">
                  <CheckCircle2 size={14} /> Generate the monthly report
                </Link>
              </>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setResult(null);
                setAnalysis(null);
                setFile(null);
              }}
            >
              {standalone ? "Import another file" : "Import another month"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SheetMapper({ sheet, registers, value, onChange }: { sheet: SheetAnalysis; registers: RegisterMeta[]; value?: { register: string | null; columns: Record<string, string | null> }; onChange: (v: { register: string | null; columns: Record<string, string | null> }) => void }) {
  const [open, setOpen] = useState(!!sheet.register);
  const reg = registers.find((r) => r.key === value?.register);
  const mapped = Object.values(value?.columns ?? {}).filter(Boolean).length;
  return (
    <div className="rounded-lg border border-line">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <button className="text-sm font-semibold text-ink" onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"} {sheet.name}
        </button>
        <span className="text-xs text-muted">{sheet.rowCount} row(s)</span>
        <select
          className="input w-auto max-w-full text-sm"
          value={value?.register ?? ""}
          onChange={(e) => onChange({ register: e.target.value || null, columns: value?.columns ?? {} })}
        >
          <option value="">— skip this sheet —</option>
          {registers.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        {value?.register && <Chip tone={mapped >= 3 ? "green" : "amber"}>{mapped} column(s) mapped</Chip>}
      </div>
      {open && value?.register && reg && (
        <div className="overflow-x-auto border-t border-line px-3 py-2">
          <table className="data w-full">
            <thead>
              <tr>
                <th>Column in your sheet</th>
                <th>Example values</th>
                <th>Goes to</th>
              </tr>
            </thead>
            <tbody>
              {sheet.columns.map((c, i) => (
                <tr key={c.index}>
                  <td className="font-medium">{c.header}</td>
                  <td className="text-xs text-muted">{sheet.sample.map((row) => row[i]).filter(Boolean).slice(0, 2).join(" · ")}</td>
                  <td>
                    <select
                      className={`input py-1 text-xs ${value.columns[String(c.index)] ? "" : "text-muted"}`}
                      value={value.columns[String(c.index)] ?? ""}
                      onChange={(e) => onChange({ ...value, columns: { ...value.columns, [String(c.index)]: e.target.value || null } })}
                    >
                      <option value="">— not used —</option>
                      {reg.fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                          {f.required ? " *" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Network failures mid-batch usually mean the server restarted (out of memory on a big file). */
class ImportFailed extends Error {}

/**
 * Starts the import and follows it until it is done. The server answers the POST at once with a job id
 * and the import runs in the background; polling every two seconds shows the progress and survives the
 * odd unanswered request while the server is busy (the host's proxy gives up on long requests).
 */
async function importViaJob(body: unknown, onPhase: (m: string) => void): Promise<ImportResult> {
  const res = await fetch("/api/workbook/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string } & Partial<ImportResult>;
  if (!res.ok) throw new ImportFailed(j.error ?? `Import failed (${res.status}).`);
  if (!j.jobId) return j as ImportResult; // an older server that waited for the result
  const deadline = Date.now() + 45 * 60_000;
  let unanswered = 0;
  while (Date.now() < deadline) {
    await pause(2000);
    try {
      const r = await fetch(`/api/workbook/import?job=${encodeURIComponent(j.jobId)}`, { cache: "no-store" });
      if (r.status === 404) {
        const k = (await r.json().catch(() => ({}))) as { error?: string };
        throw new ImportFailed(k.error ?? "The server restarted while importing. Open the report library to see whether the report was stored, then try again.");
      }
      if (!r.ok) throw new Error(`unexpected answer (${r.status})`);
      const st = (await r.json()) as { status: string; phase?: string; done?: number; total?: number; result?: ImportResult; error?: string };
      unanswered = 0;
      if (st.status === "done" && st.result) return st.result;
      if (st.status === "failed") throw new ImportFailed(st.error ?? "Import failed.");
      onPhase(st.phase ? `${st.phase}${st.total ? ` (${st.done ?? 0} / ${st.total} rows)` : ""}` : "Importing…");
    } catch (e) {
      if (e instanceof ImportFailed) throw e;
      // no answer: the server is busy with the import itself – keep waiting, up to five minutes of silence
      if (++unanswered > 150) throw new ImportFailed("No answer from the server for five minutes – it may have restarted. Open the report library to see whether the report was stored, then try again.");
      onPhase("Importing… (server busy)");
    }
  }
  throw new ImportFailed("The import is taking longer than 45 minutes. Open the report library to see whether the report was stored.");
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|networkerror|load failed|unexpected answer \(50[234]\)/i.test(msg)) {
    return `${msg} – the server stopped answering while working on this file. It usually means the hosting plan ran out of memory on a large workbook: wait a minute, then import this file on its own (or save a copy with only the schedule sheets and try again).`;
  }
  return msg;
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("Could not read the file."));
    r.readAsDataURL(blob);
  });
}
