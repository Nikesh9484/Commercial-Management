"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, FileDown, FileSpreadsheet, FileText, Filter, Loader2, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { emptySpec, opsFor, type Condition, type ReportSpec, type SourceField, type SourceInfo } from "@/lib/report-builder/types";
import { useToast } from "@/components/ui/Toast";

/**
 * "Customise my reports": pick the set of records, filter it on any field, choose and order the
 * columns, group and sort it, decide which parts of the write-up to include, see exactly what will
 * come out, and take it away as a PDF, an Excel workbook or a written Word summary.
 */

interface SourceRow {
  id: string;
  title: string;
  description: string;
  group: string;
}

interface Preview {
  title: string;
  subtitle: string[];
  headline: string;
  filterSummary: string[];
  basis: string[];
  columns: { key: string; label: string; type: string; numeric: boolean }[];
  rows: Record<string, unknown>[];
  groups: { label: string; rows: Record<string, unknown>[]; totals: Record<string, number> }[] | null;
  groupLabel: string | null;
  totals: Record<string, number>;
  totalKeys: string[];
  kpis: { label: string; value: string; note?: string }[];
  breakdown: { label: string; bands: Band[] } | null;
  ageing: { label: string; bands: Band[] } | null;
  narrative: { heading: string; text: string }[];
  attention: string[];
  count: number;
  countAll: number;
  previewTrimmed: boolean;
}
interface Band {
  label: string;
  n: number;
  value: number;
  share: number;
}
interface Saved {
  id: string;
  name: string;
  source: string;
  spec: ReportSpec;
  savedBy: string;
}

const fmt = (v: unknown, type: string): string => {
  if (v === null || v === undefined || v === "") return "–";
  if (type === "money" || type === "number") {
    const n = Number(v);
    if (!Number.isFinite(n)) return "–";
    if (Math.abs(n) < 0.005) return "–";
    const s = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
    return n < 0 ? `(${s})` : s;
  }
  if (type === "percent") {
    const n = Number(v);
    return Number.isFinite(n) ? `${n.toFixed(1)}%` : "–";
  }
  if (type === "boolean") return v === true ? "Yes" : "No";
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
};

const TONE: Record<string, string> = { red: "text-[#8a3d00] font-semibold", amber: "text-[#7a5400] font-semibold", green: "text-[#00573f] font-semibold" };

export function ReportBuilder({ canSave }: { canSave: boolean }) {
  const toast = useToast();
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [info, setInfo] = useState<(SourceInfo & { count: number }) | null>(null);
  const [spec, setSpec] = useState<ReportSpec | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [saveName, setSaveName] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    fetch("/api/custom-report")
      .then((r) => r.json())
      .then((j) => setSources(j.sources ?? []))
      .catch(() => setError("Could not load the list of reports."));
    fetch("/api/custom-report/presets")
      .then((r) => r.json())
      .then((j) => setSaved(j.saved ?? []))
      .catch(() => undefined);
  }, []);

  const fields = useMemo(() => info?.fields ?? [], [info]);
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);

  /** Loads a source and starts a fresh (or supplied) spec. */
  const choose = useCallback(async (id: string, start?: ReportSpec) => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch(`/api/custom-report?source=${encodeURIComponent(id)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not open that report.");
      setInfo(j.info);
      setSpec(start ?? { ...emptySpec(id), groupBy: j.info.suggestGroupBy ?? null });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  // the preview follows the spec, a moment behind so typing stays smooth
  useEffect(() => {
    if (!spec) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch("/api/custom-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec, format: "preview" }) });
        const j = await res.json();
        if (mine !== seq.current) return;
        if (!res.ok) throw new Error(j.error ?? "Could not build the report.");
        setPreview(j);
        setError(null);
      } catch (e) {
        if (mine === seq.current) setError((e as Error).message);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [spec]);

  const patch = (p: Partial<ReportSpec>) => setSpec((s) => (s ? { ...s, ...p } : s));

  async function download(format: "pdf" | "xlsx" | "docx") {
    if (!spec) return;
    setDownloading(format);
    try {
      const res = await fetch("/api/custom-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec, format }) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "The download failed.");
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `report.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDownloading(null);
    }
  }

  async function saveConfig() {
    if (!spec || !saveName.trim()) return;
    const res = await fetch("/api/custom-report/presets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: saveName.trim(), spec }) });
    const j = await res.json();
    if (!res.ok) return toast(j.error ?? "Could not save.", "error");
    setSaved(j.saved);
    setSaveName("");
    toast("Report configuration saved.");
  }

  async function deleteConfig(id: string) {
    const res = await fetch(`/api/custom-report/presets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const j = await res.json();
    if (!res.ok) return toast(j.error ?? "Could not delete.", "error");
    setSaved(j.saved);
  }

  /* ---------------------------------------------------------------- choosing */
  if (!spec || !info) {
    const groups = [...new Set(sources.map((s) => s.group))];
    return (
      <div className="space-y-5">
        {error && <div className="card p-4 text-sm text-red-700">{error}</div>}
        {saved.length > 0 && (
          <div className="card p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
              <Save size={15} className="text-navy" /> Your saved reports
            </h2>
            <div className="flex flex-wrap gap-2">
              {saved.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-white pl-3 pr-1 py-1 text-xs">
                  <button className="font-medium text-ink hover:text-accent" onClick={() => choose(s.source, s.spec)}>
                    {s.name}
                  </button>
                  {canSave && (
                    <button className="rounded-full p-1 text-muted hover:text-red-600" title="Delete" onClick={() => deleteConfig(s.id)}>
                      <X size={12} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
        {groups.map((g) => (
          <div key={g}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{g}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sources
                .filter((s) => s.group === g)
                .map((s) => (
                  <button key={s.id} className="card p-4 text-left transition hover:border-navy hover:shadow-md" onClick={() => choose(s.id)} disabled={busy}>
                    <div className="flex items-center gap-2">
                      {g.startsWith("Smart") && <Sparkles size={14} className="shrink-0 text-navy" />}
                      <span className="font-semibold text-ink">{s.title}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{s.description}</p>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* ---------------------------------------------------------------- building */
  const chosenColumns = spec.columns.length ? spec.columns : (preview?.columns.map((c) => c.key) ?? []);
  const available = fields.filter((f) => !chosenColumns.includes(f.key));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button className="btn btn-secondary btn-sm" onClick={() => { setSpec(null); setInfo(null); setPreview(null); }}>
          <ChevronLeft size={15} /> All reports
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {busy && <Loader2 size={15} className="animate-spin text-muted" />}
          <span className="text-xs text-muted">{preview ? `${preview.count.toLocaleString("en")} of ${preview.countAll.toLocaleString("en")} record(s)` : "building…"}</span>
          <button className="btn btn-sm btn-pdf" onClick={() => download("pdf")} disabled={!!downloading}>
            {downloading === "pdf" ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} PDF
          </button>
          <button className="btn btn-sm btn-excel" onClick={() => download("xlsx")} disabled={!!downloading}>
            {downloading === "xlsx" ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Excel
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => download("docx")} disabled={!!downloading} title="A written summary in Word">
            {downloading === "docx" ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Word summary
          </button>
        </div>
      </div>

      {error && <div className="card p-4 text-sm text-red-700">{error}</div>}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        {/* ------------------------------------------------ controls */}
        <div className="min-w-0 space-y-3">
          <Panel title={info.title} hint={info.description}>
            {info.presets.length > 0 && (
              <div className="mb-3">
                <Label>Start from</Label>
                <div className="flex flex-wrap gap-1.5">
                  {info.presets.map((p) => (
                    <button
                      key={p.id}
                      title={p.description}
                      className="rounded-full border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink transition hover:border-navy hover:text-navy"
                      onClick={async () => {
                        const res = await fetch("/api/custom-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec, preset: p.id, format: "preview" }) });
                        const j = await res.json();
                        if (res.ok && j.spec) setSpec(j.spec);
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Label>Report title (optional)</Label>
            <input className="input mb-2" placeholder={info.title} value={spec.title ?? ""} onChange={(e) => patch({ title: e.target.value })} />
            <Label>Your note, printed under the title</Label>
            <textarea className="input" rows={2} placeholder="e.g. For the commercial review on 3 October." value={spec.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} />
          </Panel>

          <Panel title="Filter" icon={<Filter size={14} />} hint="Every column can be filtered. Add as many conditions as you need.">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted">
              Records must match
              <select className="input h-8 w-28 py-0 text-xs" value={spec.match} onChange={(e) => patch({ match: e.target.value as "all" | "any" })}>
                <option value="all">all of these</option>
                <option value="any">any of these</option>
              </select>
            </div>
            <div className="space-y-2">
              {spec.conditions.map((c, i) => (
                <ConditionEditor
                  key={i}
                  condition={c}
                  fields={fields}
                  onChange={(next) => patch({ conditions: spec.conditions.map((x, j) => (j === i ? next : x)) })}
                  onRemove={() => patch({ conditions: spec.conditions.filter((_, j) => j !== i) })}
                />
              ))}
            </div>
            <button
              className="btn btn-secondary btn-sm mt-2"
              onClick={() => patch({ conditions: [...spec.conditions, { field: fields[0]?.key ?? "", op: opsFor(fields[0] ?? { key: "", label: "", type: "text" })[0].op }] })}
            >
              <Plus size={14} /> Add a condition
            </button>
          </Panel>

          <Panel title="Columns" hint="Choose what is printed, and the order it is printed in.">
            <div className="space-y-1">
              {chosenColumns.map((key, i) => {
                const f = byKey.get(key);
                if (!f) return null;
                return (
                  <div key={key} className="flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-xs">
                    <span className="flex-1 truncate text-ink" title={f.help ?? f.label}>
                      {f.label}
                    </span>
                    <button className="p-0.5 text-muted hover:text-navy disabled:opacity-30" disabled={i === 0} onClick={() => patch({ columns: move(chosenColumns, i, -1) })}>
                      <ArrowUp size={13} />
                    </button>
                    <button className="p-0.5 text-muted hover:text-navy disabled:opacity-30" disabled={i === chosenColumns.length - 1} onClick={() => patch({ columns: move(chosenColumns, i, 1) })}>
                      <ArrowDown size={13} />
                    </button>
                    <button className="p-0.5 text-muted hover:text-red-600" onClick={() => patch({ columns: chosenColumns.filter((k) => k !== key) })}>
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
            {available.length > 0 && (
              <select
                className="input mt-2 text-xs"
                value=""
                onChange={(e) => {
                  if (e.target.value) patch({ columns: [...chosenColumns, e.target.value] });
                }}
              >
                <option value="">Add a column…</option>
                {available.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            )}
          </Panel>

          <Panel title="Group, sort and trim">
            <Label>Group by (with a subtotal per group)</Label>
            <select className="input mb-2" value={spec.groupBy ?? ""} onChange={(e) => patch({ groupBy: e.target.value || null })}>
              <option value="">No grouping</option>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <Label>Sort by</Label>
            {[0, 1].map((i) => (
              <div key={i} className="mb-2 flex gap-1">
                <select
                  className="input flex-1 text-xs"
                  value={spec.sort[i]?.field ?? ""}
                  onChange={(e) => {
                    const next = [...spec.sort];
                    if (!e.target.value) next.splice(i, 1);
                    else next[i] = { field: e.target.value, dir: next[i]?.dir ?? "asc" };
                    patch({ sort: next.filter(Boolean) });
                  }}
                >
                  <option value="">{i === 0 ? "Default order" : "then…"}</option>
                  {fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select
                  className="input w-28 text-xs"
                  value={spec.sort[i]?.dir ?? "asc"}
                  disabled={!spec.sort[i]}
                  onChange={(e) => {
                    const next = [...spec.sort];
                    if (next[i]) next[i] = { ...next[i], dir: e.target.value as "asc" | "desc" };
                    patch({ sort: next });
                  }}
                >
                  <option value="asc">A → Z / low</option>
                  <option value="desc">Z → A / high</option>
                </select>
              </div>
            ))}
            <Label>Keep only the first</Label>
            <input className="input" type="number" min={1} placeholder="all records" value={spec.limit ?? ""} onChange={(e) => patch({ limit: e.target.value ? Number(e.target.value) : null })} />
          </Panel>

          <Panel title="What to include">
            {(
              [
                ["kpis", "Headline figures"],
                ["narrative", "Written commentary"],
                ["attention", "Needs attention"],
                ["breakdown", "Breakdown by group"],
                ["ageing", "Ageing analysis"],
                ["table", "The records themselves"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 py-0.5 text-sm text-ink">
                <input type="checkbox" checked={spec.blocks[k]} onChange={(e) => patch({ blocks: { ...spec.blocks, [k]: e.target.checked } })} />
                {label}
              </label>
            ))}
          </Panel>

          {canSave && (
            <Panel title="Save this report" hint="Save the whole set-up under a name and run it again next month.">
              <div className="flex gap-1">
                <input className="input flex-1" placeholder="e.g. Overdue payments for the CFO" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
                <button className="btn btn-secondary" onClick={saveConfig} disabled={!saveName.trim()}>
                  <Save size={15} />
                </button>
              </div>
              {saved.length > 0 && (
                <div className="mt-2 space-y-1">
                  {saved.map((s) => (
                    <div key={s.id} className="flex items-center gap-1 text-xs">
                      <button className="flex-1 truncate text-left text-accent hover:underline" onClick={() => choose(s.source, s.spec)}>
                        {s.name}
                      </button>
                      <button className="p-0.5 text-muted hover:text-red-600" onClick={() => deleteConfig(s.id)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}
        </div>

        {/* ------------------------------------------------ preview */}
        <div className="min-w-0 space-y-3">
          {!preview ? (
            <div className="card p-10 text-center text-sm text-muted">
              <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> Building the report…
            </div>
          ) : (
            <>
              <div className="card p-5">
                <h2 className="text-lg font-semibold text-ink">{preview.title}</h2>
                {preview.subtitle.map((l, i) => (
                  <p key={i} className="text-xs text-muted">
                    {l}
                  </p>
                ))}
                <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-navy">{preview.headline}</div>
                {preview.filterSummary.length > 0 && (
                  <p className="mt-2 text-xs text-muted">
                    Filtered to: {preview.filterSummary.join(" · ")}
                  </p>
                )}
              </div>

              {preview.kpis.length > 0 && spec.blocks.kpis && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {preview.kpis.map((k) => (
                    <div key={k.label} className="card min-w-0 p-4">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted">{k.label}</div>
                      <div className="mt-1 truncate text-lg font-semibold tnum text-ink" title={k.value}>
                        {k.value}
                      </div>
                      {k.note && <div className="truncate text-xs text-muted">{k.note}</div>}
                    </div>
                  ))}
                </div>
              )}

              {preview.narrative.length > 0 && (
                <div className="card space-y-2 p-5">
                  {preview.narrative.map((p) => (
                    <div key={p.heading}>
                      <h3 className="text-sm font-semibold text-navy">{p.heading}</h3>
                      <p className="text-sm leading-relaxed text-ink">{p.text}</p>
                    </div>
                  ))}
                </div>
              )}

              {preview.attention.length > 0 && (
                <div className="card border border-amber-200 p-5">
                  <h3 className="mb-1 text-sm font-semibold text-ink">Needs attention</h3>
                  <ul className="space-y-1 text-sm text-[#7c2d12]">
                    {preview.attention.map((a, i) => (
                      <li key={i}>• {a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.breakdown && <BandCard title={`By ${preview.breakdown.label.toLowerCase()}`} bands={preview.breakdown.bands} first={preview.breakdown.label} />}
              {preview.ageing && <BandCard title={`Ageing – ${preview.ageing.label.toLowerCase()}`} bands={preview.ageing.bands} first="Age band" />}

              {spec.blocks.table && preview.columns.length > 0 && (
                <div className="card overflow-hidden">
                  <div className="max-h-[65vh] overflow-auto">
                    <table className="data w-full">
                      <thead>
                        <tr>
                          {preview.columns.map((c) => (
                            <th key={c.key} className={c.numeric ? "text-right" : ""}>
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.groups
                          ? preview.groups.flatMap((g) => [
                              <tr key={`g-${g.label}`} className="bg-page">
                                <td colSpan={preview.columns.length} className="font-semibold text-navy">
                                  {g.label} ({g.rows.length})
                                </td>
                              </tr>,
                              ...g.rows.map((r, i) => <Row key={`${g.label}-${i}`} row={r} columns={preview.columns} />),
                              <tr key={`t-${g.label}`} className="border-t border-navy/40 font-semibold">
                                {preview.columns.map((c, i) => (
                                  <td key={c.key} className={c.numeric ? "tnum text-right" : ""}>
                                    {i === 0 ? `${g.label} total` : c.numeric && g.totals[c.key] !== undefined ? fmt(g.totals[c.key], c.type) : ""}
                                  </td>
                                ))}
                              </tr>,
                            ])
                          : preview.rows.map((r, i) => <Row key={i} row={r} columns={preview.columns} />)}
                      </tbody>
                      {preview.totalKeys.length > 0 && (
                        <tfoot>
                          <tr className="bg-page font-semibold">
                            {preview.columns.map((c, i) => (
                              <td key={c.key} className={c.numeric ? "tnum text-right" : ""}>
                                {i === 0 ? `Total (${preview.count})` : c.numeric && preview.totals[c.key] !== undefined ? fmt(preview.totals[c.key], c.type) : ""}
                              </td>
                            ))}
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  {preview.previewTrimmed && <div className="border-t border-line px-3 py-2 text-xs text-muted">Showing the first 200 records on screen – the download carries all {preview.count.toLocaleString("en")}.</div>}
                </div>
              )}

              <div className="card p-4 text-xs leading-relaxed text-muted">
                <span className="font-semibold text-ink">Basis of preparation. </span>
                {preview.basis.join(" ")}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function move(list: string[], i: number, by: number): string[] {
  const next = [...list];
  const j = i + by;
  if (j < 0 || j >= next.length) return next;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function Panel({ title, hint, icon, children }: { title: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
        {icon}
        {title}
      </h3>
      {hint && <p className="mb-2 text-xs leading-relaxed text-muted">{hint}</p>}
      {children}
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{children}</div>;

function Row({ row, columns }: { row: Record<string, unknown>; columns: { key: string; label: string; type: string; numeric: boolean }[] }) {
  const tone = String(row.__row_tone ?? "");
  return (
    <tr className={tone === "red" ? "bg-red-50/60" : tone === "amber" ? "bg-amber-50/60" : ""}>
      {columns.map((c) => {
        const cell = String(row[`${c.key}__tone`] ?? "");
        return (
          <td key={c.key} className={`${c.numeric ? "tnum text-right" : ""} ${TONE[cell] ?? ""}`} title={String(row[c.key] ?? "")}>
            {fmt(row[c.key], c.type)}
          </td>
        );
      })}
    </tr>
  );
}

function BandCard({ title, bands, first }: { title: string; bands: Band[]; first: string }) {
  if (!bands.length) return null;
  const hasValue = bands.some((b) => b.value !== 0);
  const max = Math.max(1, ...bands.map((b) => (hasValue ? b.value : b.n)));
  return (
    <div className="card p-5">
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      <div className="overflow-x-auto">
        <table className="data w-full max-w-2xl">
        <thead>
          <tr>
            <th>{first}</th>
            <th className="text-right">Items</th>
            {hasValue && <th className="text-right">Value (SAR)</th>}
            {hasValue && <th className="text-right">% of value</th>}
            <th className="w-40" />
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr key={b.label}>
              <td>{b.label}</td>
              <td className="tnum text-right">{b.n.toLocaleString("en")}</td>
              {hasValue && <td className="tnum text-right">{fmt(b.value, "money")}</td>}
              {hasValue && <td className="tnum text-right">{b.share.toFixed(1)}%</td>}
              <td>
                <div className="h-2 w-full rounded bg-page">
                  <div className="h-2 rounded bg-[#2a78d6]" style={{ width: `${Math.max(2, ((hasValue ? b.value : b.n) / max) * 100)}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-page font-semibold">
            <td>Total</td>
            <td className="tnum text-right">{bands.reduce((t, b) => t + b.n, 0).toLocaleString("en")}</td>
            {hasValue && <td className="tnum text-right">{fmt(bands.reduce((t, b) => t + b.value, 0), "money")}</td>}
            {hasValue && <td className="tnum text-right">100.0%</td>}
            <td />
          </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ConditionEditor({ condition, fields, onChange, onRemove }: { condition: Condition; fields: SourceField[]; onChange: (c: Condition) => void; onRemove: () => void }) {
  const field = fields.find((f) => f.key === condition.field) ?? fields[0];
  const ops = field ? opsFor(field) : [];
  const op = ops.find((o) => o.op === condition.op) ?? ops[0];
  if (!field || !op) return null;

  return (
    <div className="rounded-lg border border-line bg-page/40 p-2">
      <div className="flex gap-1">
        <select
          className="input flex-1 text-xs"
          value={condition.field}
          onChange={(e) => {
            const next = fields.find((f) => f.key === e.target.value)!;
            onChange({ field: next.key, op: opsFor(next)[0].op });
          }}
        >
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <button className="rounded p-1 text-muted hover:text-red-600" onClick={onRemove} title="Remove">
          <X size={14} />
        </button>
      </div>
      <div className="mt-1 flex gap-1">
        <select className="input flex-1 text-xs" value={op.op} onChange={(e) => onChange({ ...condition, op: e.target.value as Condition["op"], value: null, value2: null, values: [] })}>
          {ops.map((o) => (
            <option key={o.op} value={o.op}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {op.set ? (
        <select
          multiple
          size={Math.min(6, Math.max(3, field.options?.length ?? 3))}
          className="input mt-1 text-xs"
          value={(condition.values ?? []).map(String)}
          onChange={(e) => onChange({ ...condition, values: [...e.target.selectedOptions].map((o) => o.value) })}
        >
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : op.inputs > 0 ? (
        <div className="mt-1 flex gap-1">
          <ValueInput field={field} days={op.days} value={condition.value ?? ""} onChange={(v) => onChange({ ...condition, value: v })} />
          {op.inputs === 2 && <ValueInput field={field} days={op.days} value={condition.value2 ?? ""} onChange={(v) => onChange({ ...condition, value2: v })} />}
        </div>
      ) : null}
      {field.help && <p className="mt-1 text-[11px] leading-snug text-muted">{field.help}</p>}
    </div>
  );
}

function ValueInput({ field, days, value, onChange }: { field: SourceField; days?: boolean; value: string | number; onChange: (v: string | number) => void }) {
  const type = days ? "number" : field.type === "date" ? "date" : field.numeric ? "number" : "text";
  return <input className="input flex-1 text-xs" type={type} value={value} placeholder={days ? "days" : field.numeric ? "0" : ""} onChange={(e) => onChange(type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} />;
}
