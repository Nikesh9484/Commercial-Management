"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileDown, FileSpreadsheet, FileText, Filter, Loader2, Play, Plus, Save, Trash2, X } from "lucide-react";
import { emptySpec, isConditionReady, layoutOf, LAYOUTS, opsFor, type Condition, type ReportSpec, type SourceField, type SourceInfo } from "@/lib/report-builder/types";
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

// the same muted palette the PDF, Excel and Word use, so the screen is a true preview
const TONE: Record<string, string> = { red: "text-[#87362d] font-semibold", amber: "text-[#8a5f1c] font-semibold", green: "text-[#3c7e66] font-semibold" };
const GLYPH: Record<string, string> = { red: "▲", amber: "■", green: "●" };

export function ReportBuilder({ canSave }: { canSave: boolean }) {
  const toast = useToast();
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [info, setInfo] = useState<(SourceInfo & { count: number }) | null>(null);
  const [spec, setSpec] = useState<ReportSpec | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  /** True once the set-up has been changed since the report on screen was built. */
  const [stale, setStale] = useState(false);
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

  /**
   * Loads a source and starts a fresh (or a saved) set-up. The columns are filled in straight away so
   * they can be changed before anything is built, and nothing is generated until Generate is clicked.
   */
  const choose = useCallback(async (id: string, start?: ReportSpec) => {
    if (!id) {
      setInfo(null);
      setSpec(null);
      setPreview(null);
      return;
    }
    setBusy(true);
    setError(null);
    setPreview(null);
    setStale(false);
    try {
      const res = await fetch(`/api/custom-report?source=${encodeURIComponent(id)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not open that report.");
      setInfo(j.info);
      // the column list is always filled in, so it survives a report whose record table is switched off
      const cols: string[] = j.defaultColumns ?? [];
      setSpec(start ? { ...start, columns: start.columns.length ? start.columns : cols } : { ...emptySpec(id), columns: cols, groupBy: j.info.suggestGroupBy ?? null });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Builds the report. Nothing is built until this is asked for: the filters are set first and the
   * report is produced once, when it is wanted, rather than rebuilding itself on every change.
   */
  async function generate() {
    if (!spec) return;
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/custom-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec, format: "preview" }) });
      const j = await res.json();
      if (mine !== seq.current) return;
      if (!res.ok) throw new Error(j.error ?? "Could not build the report.");
      setPreview(j);
      setStale(false);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }

  // any change to the set-up makes what is on screen out of date until it is built again
  const patch = (p: Partial<ReportSpec>) => {
    setSpec((s) => (s ? { ...s, ...p } : s));
    setStale(true);
  };

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

  /* ---------------------------------------------------------------- the page */
  const sourceGroups = [...new Set(sources.map((s) => s.group))];

  /** The bar that carries Generate and the three downloads – shown once a report has been set up. */
  const picker = (
    <div className="card p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0">
          <Label>What do you want to report on?</Label>
          <select className="input" value={spec?.source ?? ""} onChange={(e) => choose(e.target.value)} disabled={busy}>
            <option value="">Choose the records…</option>
            {sourceGroups.map((g) => (
              <optgroup key={g} label={g}>
                {sources
                  .filter((s) => s.group === g)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          {info && (
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              {info.description} <span className="whitespace-nowrap">· {info.count.toLocaleString("en")} record(s) before filtering</span>
            </p>
          )}
        </div>
        {saved.length > 0 && (
          <div className="min-w-0 md:w-64">
            <Label>Or re-run one you saved</Label>
            <select
              className="input"
              value=""
              onChange={(e) => {
                const s = saved.find((x) => x.id === e.target.value);
                if (s) choose(s.source, s.spec);
              }}
            >
              <option value="">Saved reports…</option>
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );

  if (!spec || !info) {
    return (
      <div className="space-y-4">
        {error && <div className="card p-4 text-sm text-red-700">{error}</div>}
        {picker}
        <div className="card p-10 text-center text-sm text-muted">
          Choose the records above. You can then filter on any field, pick the columns, group and total them, and click <b className="text-ink">Generate report</b> to build it.
        </div>
      </div>
    );
  }

  const chosenColumns = spec.columns.length ? spec.columns : (preview?.columns.map((c) => c.key) ?? []);
  const available = fields.filter((f) => !chosenColumns.includes(f.key));
  const applied = spec.conditions.filter(isConditionReady).length;
  const unfilled = spec.conditions.length - applied;
  const layout = layoutOf(spec.blocks);

  return (
    <div className="space-y-4">
      {picker}

      <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white/95 p-3 shadow-sm backdrop-blur">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
          {busy && <Loader2 size={15} className="animate-spin" />}
          {preview && !stale && (
            <span>
              {LAYOUTS.find((l) => l.id === layout)?.label ?? "Your own mix"} · {preview.count.toLocaleString("en")} of {preview.countAll.toLocaleString("en")} record(s)
            </span>
          )}
          {stale && preview && <span className="font-medium text-amber-700">The set-up has changed – generate it again to see it.</span>}
          {!preview && !busy && <span>{applied === 0 ? "No filters set – every record will be included." : `${applied} filter(s) set.`} Nothing is built until you click Generate.</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-primary" onClick={generate} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Generate report
          </button>
          <button className="btn btn-sm btn-pdf" onClick={() => download("pdf")} disabled={!!downloading || !preview || stale} title={!preview || stale ? "Generate the report first" : "Download as a PDF"}>
            {downloading === "pdf" ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} PDF
          </button>
          <button className="btn btn-sm btn-excel" onClick={() => download("xlsx")} disabled={!!downloading || !preview || stale} title={!preview || stale ? "Generate the report first" : "Download as an Excel workbook"}>
            {downloading === "xlsx" ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Excel
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => download("docx")} disabled={!!downloading || !preview || stale} title={!preview || stale ? "Generate the report first" : "A written summary in Word"}>
            {downloading === "docx" ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Word summary
          </button>
        </div>
      </div>

      {error && <div className="card p-4 text-sm text-red-700">{error}</div>}

      <div className="min-w-0 space-y-4">
        {/* ---------------------------------- the set-up, across the full width */}
        <div className="grid min-w-0 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Panel title="Title and note" hint="What the report is called and anything you want printed under the title.">
            <Label>Report title (optional)</Label>
            <input className="input mb-2" placeholder={info.title} value={spec.title ?? ""} onChange={(e) => patch({ title: e.target.value })} />
            <Label>Your note, printed under the title</Label>
            <textarea className="input" rows={2} placeholder="e.g. For the commercial review on 3 October." value={spec.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} />
          </Panel>

          <Panel
            className="md:col-span-2"
            title="Filters"
            icon={<Filter size={14} />}
            hint="Every field can be filtered, and you can add as many conditions as you like."
          >
            {info.presets.length > 0 && (
              <div className="mb-3 rounded-lg border border-line bg-page/40 p-2">
                <Label>Fill the filters in for me</Label>
                <div className="flex flex-wrap gap-1.5">
                  {info.presets.map((p) => (
                    <button
                      key={p.id}
                      title={`${p.description} – this only fills in the filters below; change them as you like, then Generate.`}
                      className="rounded-full border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink transition hover:border-navy hover:text-navy"
                      onClick={async () => {
                        const res = await fetch("/api/custom-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec, preset: p.id, format: "preview" }) });
                        const j = await res.json();
                        if (res.ok && j.spec) {
                          setSpec(j.spec);
                          setStale(true);
                        }
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted">A starting point only – it fills in the filters below, which you can then change. Nothing is built until you click Generate.</p>
              </div>
            )}
            <div className="mb-2 flex items-center gap-2 text-xs text-muted">
              Records must match
              <select className="input h-8 w-28 py-0 text-xs" value={spec.match} onChange={(e) => patch({ match: e.target.value as "all" | "any" })}>
                <option value="all">all of these</option>
                <option value="any">any of these</option>
              </select>
            </div>
            {spec.conditions.length === 0 && <p className="mb-2 text-xs text-muted">No filters yet – the report will cover every record.</p>}
            <div className="space-y-2">
              {spec.conditions.map((c, i) => (
                <ConditionEditor
                  key={i}
                  condition={c}
                  fields={fields}
                  ready={isConditionReady(c)}
                  onChange={(next) => patch({ conditions: spec.conditions.map((x, j) => (j === i ? next : x)) })}
                  onRemove={() => patch({ conditions: spec.conditions.filter((_, j) => j !== i) })}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => patch({ conditions: [...spec.conditions, { field: fields[0]?.key ?? "", op: opsFor(fields[0] ?? { key: "", label: "", type: "text" })[0].op }] })}
              >
                <Plus size={14} /> Add a filter
              </button>
              {unfilled > 0 && (
                <span className="text-xs text-amber-700">
                  {unfilled} filter{unfilled === 1 ? " has" : "s have"} no value yet, so {unfilled === 1 ? "it is" : "they are"} not being applied.
                </span>
              )}
            </div>
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

          <Panel title="How much do you want in it?" hint="Pick the shape of the report. Each one is a starting point – the ticks underneath can still be changed.">
            <div className="space-y-1.5">
              {LAYOUTS.map((l) => {
                const on = layout === l.id;
                return (
                  <button
                    key={l.id}
                    className={`w-full rounded-lg border p-2 text-left transition ${on ? "border-navy bg-navy/5 ring-1 ring-navy" : "border-line bg-white hover:border-navy"}`}
                    onClick={() => patch({ blocks: { ...l.blocks } })}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${on ? "text-navy" : "text-ink"}`}>{l.label}</span>
                      <span className="ml-auto shrink-0 rounded-full bg-page px-2 py-0.5 text-[11px] text-muted">{l.suits}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{l.description}</p>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted">
              {layout === "custom" ? "Your own mix of the parts below." : "Whichever you pick, you can still download it as a PDF, an Excel workbook or a Word summary."}
            </p>
          </Panel>

          <Panel title="What to include" hint="Fine-tuning: tick or untick any part of the report.">
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

        {/* ------------------------------------------------ the report itself */}
        <div className="min-w-0 space-y-3">
          {preview && stale && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              <span>The set-up has changed since this was built, so what is below is the older report.</span>
              <button className="btn btn-sm btn-primary" onClick={generate} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Generate it again
              </button>
            </div>
          )}
          {!preview ? (
            <div className="card p-10 text-center text-sm text-muted">
              {busy ? (
                <>
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> Building the report…
                </>
              ) : (
                <>
                  <Play size={20} className="mx-auto mb-2 text-navy" />
                  <p className="font-medium text-ink">Nothing built yet.</p>
                  <p className="mt-1">Set your filters and columns above, then click <b className="text-ink">Generate report</b>.</p>
                </>
              )}
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
                <div className="mt-3 rounded-r-lg border-l-4 border-[#0f2b4c] bg-[#f5f1ea] px-3 py-2.5 text-sm font-semibold text-[#0b2137]">{preview.headline}</div>
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
                <div className="card p-5">
                  <h3 className="mb-2 text-sm font-semibold text-ink">Needs attention</h3>
                  <ul className="space-y-1.5 text-sm">
                    {preview.attention.map((a, i) => (
                      <li key={i} className="rounded-r border-l-[3px] border-[#87362d] bg-[#f3e6e3] px-3 py-1.5 text-[#87362d]">
                        <span className="mr-1.5">▲</span>
                        {a}
                      </li>
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

function Panel({ title, hint, icon, className, children }: { title: string; hint?: string; icon?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={`card p-4${className ? ` ${className}` : ""}`}>
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
    <tr className={tone === "red" || tone === "amber" ? "bg-[#f7f8fa]" : ""}>
      {columns.map((c) => {
        const cell = String(row[`${c.key}__tone`] ?? "");
        const text = fmt(row[c.key], c.type);
        return (
          <td key={c.key} className={`${c.numeric ? "tnum text-right" : ""} ${TONE[cell] ?? ""}`} title={String(row[c.key] ?? "")}>
            {cell && !c.numeric && text !== "–" && <span className="mr-1">{GLYPH[cell]}</span>}
            {text}
          </td>
        );
      })}
    </tr>
  );
}

const RAMP = ["#0f2b4c", "#2f4f73", "#4d6d8f", "#7d95ad", "#a9bac9"];

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
          {bands.map((b, i) => (
            <tr key={b.label}>
              <td>{b.label}</td>
              <td className="tnum text-right">{b.n.toLocaleString("en")}</td>
              {hasValue && <td className="tnum text-right">{fmt(b.value, "money")}</td>}
              {hasValue && <td className="tnum text-right">{b.share.toFixed(1)}%</td>}
              <td>
                <div className="h-2 w-full rounded bg-page">
                  <div className="h-2 rounded" style={{ width: `${Math.max(2, ((hasValue ? b.value : b.n) / max) * 100)}%`, background: RAMP[i % RAMP.length] }} />
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

function ConditionEditor({ condition, fields, ready, onChange, onRemove }: { condition: Condition; fields: SourceField[]; ready: boolean; onChange: (c: Condition) => void; onRemove: () => void }) {
  const field = fields.find((f) => f.key === condition.field) ?? fields[0];
  const ops = field ? opsFor(field) : [];
  const op = ops.find((o) => o.op === condition.op) ?? ops[0];
  if (!field || !op) return null;

  return (
    <div className={`rounded-lg border p-2 ${ready ? "border-line bg-page/40" : "border-amber-300 bg-amber-50/60"}`}>
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
