"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowRight, Lock } from "lucide-react";
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

export function WorkbookImporter({ registers, periods, isAdmin, defaultReportNo }: { registers: RegisterMeta[]; periods: PeriodOption[]; isAdmin: boolean; defaultReportNo: number }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<WorkbookAnalysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, { register: string | null; columns: Record<string, string | null> }>>({});
  const [periodMode, setPeriodMode] = useState<"existing" | "new">(periods.some((p) => p.status === "Open") ? "existing" : "new");
  const [periodId, setPeriodId] = useState<number | null>(periods.find((p) => p.status === "Open")?.id ?? null);
  const [reportNo, setReportNo] = useState<string>(String(defaultReportNo));
  const [periodEnd, setPeriodEnd] = useState("");
  const [lock, setLock] = useState(isAdmin);
  const [createLookups, setCreateLookups] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);

  const [progress, setProgress] = useState("");

  async function analyze() {
    if (!file) return;
    setBusy(true);
    // The file goes up in small text pieces (base64 JSON). Big binary uploads get cut short by some
    // company web filters; small text requests pass, and the server checks the total size at the end.
    const CHUNK = 256 * 1024;
    const count = Math.max(1, Math.ceil(file.size / CHUNK));
    let uploadId = "";
    let j: { error?: string; uploadId?: string } = {};
    for (let i = 0; i < count; i++) {
      setProgress(count > 1 ? `Uploading part ${i + 1} of ${count}…` : "Uploading…");
      const piece = file.slice(i * CHUNK, (i + 1) * CHUNK);
      const data = await toBase64(piece);
      let res: Response;
      let text = "";
      try {
        res = await fetch("/api/workbook/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId, name: file.name, size: file.size, index: i, count, data }),
        });
        text = await res.text();
      } catch (e) {
        setBusy(false);
        setProgress("");
        return toast(`Upload failed on part ${i + 1} of ${count}: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
      try {
        j = JSON.parse(text);
      } catch {
        setBusy(false);
        setProgress("");
        return toast(`The server replied with an unexpected answer (${res.status}). ${text.slice(0, 120)}`, "error");
      }
      if (!res.ok) {
        setBusy(false);
        setProgress("");
        return toast(j.error ?? "Could not read the file.", "error");
      }
      uploadId = j.uploadId ?? uploadId;
    }
    setBusy(false);
    setProgress("");
    const a = j as unknown as WorkbookAnalysis;
    setAnalysis(a);
    const m: typeof mapping = {};
    for (const s of a.sheets) m[s.name] = { register: s.register, columns: Object.fromEntries(s.columns.map((c) => [String(c.index), c.field])) };
    setMapping(m);
    setResult(null);
  }

  async function run() {
    if (!analysis) return;
    setBusy(true);
    const body = {
      fileId: analysis.fileId,
      period: periodMode === "existing" ? { id: periodId } : { report_no: Number(reportNo.replace(/\D/g, "")) || undefined, period_end: periodEnd },
      sheets: analysis.sheets.map((s) => ({ sheet: s.name, headerRow: s.headerRow, register: mapping[s.name]?.register ?? null, columns: mapping[s.name]?.columns ?? {} })),
      lock,
      createMissingLookups: createLookups,
    };
    const res = await fetch("/api/workbook/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(j.error ?? "Import failed.", "error");
    setResult(j as ImportResult);
    toast("Workbook imported.");
  }

  const mappedSheets = analysis ? analysis.sheets.filter((s) => mapping[s.name]?.register) : [];

  return (
    <div className="space-y-5">
      {/* Step 1 */}
      <div className="card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-navy text-xs text-white">1</span> Choose the workbook and the month it belongs to
        </h2>
        <p className="mb-3 text-xs text-muted">Your monthly report workbook (.xlsx). The app reads every sheet it recognises: cost report lines, change tracker, claims, early warnings, risks, provisional sums, bonds, contracts, IPC log, budget transfers, project team.</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Excel file
            <input type="file" accept=".xlsx" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
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
        </div>
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
            {isAdmin && (
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-navy" checked={lock} onChange={(e) => setLock(e.target.checked)} /> <Lock size={14} /> Lock the period after importing (if there are no errors)
              </label>
            )}
            <button className="btn btn-primary ml-auto" onClick={run} disabled={busy || mappedSheets.length === 0}>
              <Upload size={16} /> {busy ? "Importing…" : `Import ${mappedSheets.length} sheet(s)`}
            </button>
          </div>
        </div>
      )}

      {/* Step 3 */}
      {result && (
        <div className="card p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-600 text-xs text-white">3</span> Result for {result.period.label}
          </h2>
          <div className="mb-3 flex flex-wrap gap-2">
            <Chip tone={result.period.locked ? "green" : "amber"}>{result.period.locked ? "Period locked – snapshot stored" : "Period left open"}</Chip>
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
            <Link href="/modules/cost-report" className="btn btn-secondary btn-sm">
              Check the cost report <ArrowRight size={14} />
            </Link>
            <Link href="/" className="btn btn-secondary btn-sm">
              Executive summary <ArrowRight size={14} />
            </Link>
            <Link href="/modules/monthly-report" className="btn btn-primary btn-sm">
              <CheckCircle2 size={14} /> Generate the monthly report
            </Link>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setResult(null);
                setAnalysis(null);
                setFile(null);
              }}
            >
              Import another month
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

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("Could not read the file."));
    r.readAsDataURL(blob);
  });
}
