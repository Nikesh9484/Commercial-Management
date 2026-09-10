"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Download, Pencil, RefreshCw, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { MONEY_COLUMNS, type CostReport, type CostLineRow, type Money, type MoneyKey } from "@/lib/cost-report/columns";
import type { LookupOption, RegisterDef } from "@/lib/registers/types";
import { formatMoney } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { RegisterPage } from "@/components/register/RegisterPage";
import { RecordForm, type FormValues } from "@/components/register/RecordForm";
import { CostChart } from "./CostChart";

type Tab = "level1" | "level2" | "setup";
const SIGNED: MoneyKey[] = ["O", "S"]; // positive = adverse (over budget / increase)

export function CostReportPage({ canEdit, isAdmin, initialTab }: { canEdit: boolean; isAdmin: boolean; initialTab?: string }) {
  const toast = useToast();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab === "level1" || initialTab === "setup" ? initialTab : "level2");
  const [report, setReport] = useState<CostReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assetFilter, setAssetFilter] = useState<number | "all">("all");
  const [editing, setEditing] = useState<{ id: number; values: FormValues } | null>(null);
  const [meta, setMeta] = useState<{ def: RegisterDef; lookups: Record<string, LookupOption[]> } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    () =>
      fetch("/api/cost-report", { cache: "no-store" })
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "Could not load the cost report.");
          return j as CostReport;
        })
        .then(setReport, (e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function openEdit(line: CostLineRow) {
    let m = meta;
    if (!m) {
      const r = await fetch("/api/registers/cost_lines", { cache: "no-store" });
      const j = await r.json();
      m = { def: j.def, lookups: j.lookups };
      setMeta(m);
    }
    const r = await fetch(`/api/registers/cost_lines/${line.id}`);
    const j = await r.json();
    const values: FormValues = {};
    for (const f of m.def.fields) values[f.key] = (j.row?.[f.key] as FormValues[string]) ?? null;
    setFormErrors({});
    setEditing({ id: line.id, values });
  }

  async function save() {
    if (!editing || !meta) return;
    setSaving(true);
    const body: Record<string, unknown> = {};
    for (const f of meta.def.fields) if (!f.hideInForm && !f.readonly) body[f.key] = editing.values[f.key] ?? null;
    const res = await fetch(`/api/registers/cost_lines/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setFormErrors(j.fieldErrors ?? {});
      toast(j.error ?? "Could not save.", "error");
      return;
    }
    toast("Cost line saved.");
    setEditing(null);
    load();
    router.refresh();
  }

  if (error) return <div className="card p-6 text-sm text-red-700">{error}</div>;
  if (!report) return <div className="card p-6 text-sm text-muted">Calculating…</div>;

  const assets = [...new Map(report.level1.map((r) => [r.asset_id, { id: r.asset_id, label: `${r.asset_code} · ${r.asset_name}` }])).values()];
  const pendingFeeds = report.feeds.filter((f) => !f.available);

  return (
    <div className="space-y-4">
      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Chip tone="blue">{report.period?.label ?? "No period"}</Chip>
        {report.previousPeriod ? (
          <Chip tone={report.previousPeriod.snapshotAvailable ? "green" : "amber"}>
            Previous: {report.previousPeriod.label}
            {report.previousPeriod.snapshotAvailable ? "" : ` (${report.previousPeriod.note ?? "not locked – column R shows 0"})`}
          </Chip>
        ) : (
          <Chip tone="grey">No previous period yet</Chip>
        )}
        <Chip tone={report.checkOk ? "green" : "red"}>
          {report.checkOk ? <CheckCircle2 size={11} className="mr-1" /> : <AlertTriangle size={11} className="mr-1" />}
          Level 1 − Level 2 check {report.checkOk ? "OK" : "FAILED"}
        </Chip>
        <span className="ml-auto flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={load} title="Recalculate">
            <RefreshCw size={14} /> Recalculate
          </button>
          <a className="btn btn-secondary btn-sm" href="/api/cost-report/export">
            <Download size={14} /> Export Level 1 &amp; 2 (Excel)
          </a>
        </span>
      </div>

      {pendingFeeds.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            Columns {pendingFeeds.map((f) => f.column).join(", ")} are filled automatically from other modules and show 0 until those modules are built (
            {[...new Set(pendingFeeds.map((f) => f.module))].join("; ")}).
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line">
        {(
          [
            ["level1", "Level 1 – Executive"],
            ["level2", "Level 2 – Detailed"],
            ["setup", "Line setup"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${tab === k ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "level1" && (
        <>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data w-full">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-[2] bg-[#f7f8fb]">Asset code</th>
                    <th>Asset</th>
                    <th>Cost category</th>
                    <th className="text-right">Lines</th>
                    {MONEY_COLUMNS.map((c) => (
                      <ColHead key={c.key} col={c} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.level1.length === 0 && (
                    <tr>
                      <td colSpan={4 + MONEY_COLUMNS.length} className="py-10 text-center text-muted">
                        No cost lines yet. Add them on the Line setup tab.
                      </td>
                    </tr>
                  )}
                  {report.level1.map((r) => (
                    <tr key={`${r.asset_id}|${r.category}`}>
                      <td className="sticky left-0 z-[1] bg-white font-medium">{r.asset_code}</td>
                      <td>{r.asset_name}</td>
                      <td>{r.category || <span className="text-muted">(no category)</span>}</td>
                      <td className="tnum text-right">{r.lines}</td>
                      <MoneyCells m={r} />
                    </tr>
                  ))}
                  <TotalRow label="Total excluding budget hold (executive view)" m={report.totalsExclHold} colSpan={4} />
                  <TotalRow label="Total" m={report.level1Total} colSpan={4} strong />
                  <tr className={report.checkOk ? "text-emerald-700" : "bg-red-50 font-semibold text-red-700"}>
                    <td className={`sticky left-0 z-[1] ${report.checkOk ? "bg-white" : "bg-red-50"}`} colSpan={4}>
                      Check: Level 1 total − Level 2 total (must be zero)
                    </td>
                    {MONEY_COLUMNS.map((c) => (
                      <td key={c.key} className="tnum text-right">
                        {formatMoney(report.check[c.key])}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <ChartCard data={report.chart} />
        </>
      )}

      {tab === "level2" && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="text-xs text-muted">Show</label>
            <select className="input w-auto" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">All assets</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">{report.lines.length} line(s) · double-click a row to edit</span>
          </div>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data w-full">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-[2] bg-[#f7f8fb]">
                      <Letter>A</Letter>Code
                    </th>
                    <th>
                      <Letter>B</Letter>Package
                    </th>
                    <th>
                      <Letter>C</Letter>Name
                    </th>
                    <th>
                      <Letter>D</Letter>Contractor / Sub-contractor
                    </th>
                    {assetFilter === "all" && <th>Asset</th>}
                    {MONEY_COLUMNS.map((c) => (
                      <ColHead key={c.key} col={c} />
                    ))}
                    {canEdit && <th />}
                  </tr>
                </thead>
                <tbody>
                  {report.lines.length === 0 && (
                    <tr>
                      <td colSpan={20} className="py-10 text-center text-muted">
                        No cost lines yet.{" "}
                        <button className="text-accent hover:underline" onClick={() => setTab("setup")}>
                          Add them on the Line setup tab
                        </button>{" "}
                        or import from Excel.
                      </td>
                    </tr>
                  )}
                  {report.sections.map((section) => {
                    const rows = section.lines.filter((l) => assetFilter === "all" || l.asset_id === assetFilter);
                    const subtotal = assetFilter === "all" ? section.subtotal : sum(rows);
                    if (!rows.length && report.lines.length) return null;
                    return (
                      <SectionRows key={section.name} name={section.name} rows={rows} subtotal={subtotal} showAsset={assetFilter === "all"} canEdit={canEdit} onEdit={openEdit} />
                    );
                  })}
                  {report.lines.length > 0 && (
                    <TotalRow label="Grand total" m={assetFilter === "all" ? report.grandTotal : sum(report.lines.filter((l) => l.asset_id === assetFilter))} colSpan={assetFilter === "all" ? 5 : 4} strong trailing={canEdit} />
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <ChartCard data={report.chart} />
        </>
      )}

      {tab === "setup" && (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Set up one line per package / contractor with its approved baseline budget (columns A–E). Packages and contractors come from{" "}
            <Link href="/settings" className="text-accent hover:underline">
              Settings
            </Link>
            . Use Import to load them from your Schedule B in one go.
          </p>
          <RegisterPage registerKey="cost_lines" isAdmin={isAdmin} />
        </div>
      )}

      <Modal
        open={!!editing}
        title="Edit cost line"
        onClose={() => setEditing(null)}
        size="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {editing && meta && (
          <RecordForm def={meta.def} values={editing.values} lookups={meta.lookups} errors={formErrors} isNew={false} onChange={(k, v) => setEditing((s) => (s ? { ...s, values: { ...s.values, [k]: v } } : s))} />
        )}
      </Modal>
    </div>
  );
}

function sum(rows: CostLineRow[]): Money {
  const t = Object.fromEntries(MONEY_COLUMNS.map((c) => [c.key, 0])) as Money;
  for (const r of rows) for (const c of MONEY_COLUMNS) t[c.key] += r[c.key];
  return t;
}

function Letter({ children }: { children: string }) {
  return <span className="mr-1 inline-block rounded bg-navy/10 px-1 text-[10px] font-bold text-navy">{children}</span>;
}

function ColHead({ col }: { col: (typeof MONEY_COLUMNS)[number] }) {
  return (
    <th className="min-w-36 whitespace-normal text-right align-bottom" title={col.formula && col.formula !== "auto" && col.formula !== "snapshot" ? `= ${col.formula}` : col.formula === "auto" ? "Filled automatically from another module" : col.formula === "snapshot" ? "From the previous locked period" : "Entered on the Line setup tab"}>
      <div className="flex items-start justify-end gap-1">
        <Letter>{col.key}</Letter>
        <span className="text-xs leading-tight">{col.label}</span>
      </div>
      {col.formula && <div className="text-[10px] font-normal text-muted">{col.formula === "auto" ? "auto" : col.formula === "snapshot" ? "prev. snapshot" : `= ${col.formula}`}</div>}
    </th>
  );
}

function MoneyCells({ m }: { m: Money }) {
  return (
    <>
      {MONEY_COLUMNS.map((c) => {
        const v = m[c.key];
        const signed = SIGNED.includes(c.key);
        const cls = signed ? (v > 0.004 ? "text-red-700" : v < -0.004 ? "text-emerald-700" : "text-muted") : v === 0 ? "text-muted/70" : "";
        return (
          <td key={c.key} className={`tnum text-right ${cls}`}>
            {formatMoney(v)}
          </td>
        );
      })}
    </>
  );
}

function TotalRow({ label, m, colSpan, strong, trailing }: { label: string; m: Money; colSpan: number; strong?: boolean; trailing?: boolean }) {
  return (
    <tr className={strong ? "bg-[#e8eef7] font-semibold text-navy" : "bg-page font-semibold"}>
      <td className={`sticky left-0 z-[1] ${strong ? "bg-[#e8eef7]" : "bg-page"}`} colSpan={colSpan}>
        {label}
      </td>
      <MoneyCells m={m} />
      {trailing && <td />}
    </tr>
  );
}

function SectionRows({ name, rows, subtotal, showAsset, canEdit, onEdit }: { name: string; rows: CostLineRow[]; subtotal: Money; showAsset: boolean; canEdit: boolean; onEdit: (l: CostLineRow) => void }) {
  const textCols = 4 + (showAsset ? 1 : 0);
  return (
    <>
      <tr>
        <td colSpan={textCols + MONEY_COLUMNS.length + (canEdit ? 1 : 0)} className="sticky left-0 bg-white text-xs font-bold uppercase tracking-wide text-navy">
          {name}
        </td>
      </tr>
      {rows.length === 0 && (
        <tr>
          <td colSpan={textCols + MONEY_COLUMNS.length + (canEdit ? 1 : 0)} className="text-xs text-muted">
            No {name.toLowerCase()} lines.
          </td>
        </tr>
      )}
      {rows.map((l) => (
        <tr key={l.id} onDoubleClick={() => canEdit && onEdit(l)}>
          <td className="sticky left-0 z-[1] bg-white font-medium">{l.code}</td>
          <td>{l.package}</td>
          <td className="max-w-56 truncate" title={l.name}>
            {l.name || <span className="text-muted/60">—</span>}
          </td>
          <td>{l.contractor || <span className="text-muted/60">—</span>}</td>
          {showAsset && <td className="text-muted">{l.asset_code}</td>}
          <MoneyCells m={l} />
          {canEdit && (
            <td className="text-right">
              <button className="btn btn-ghost btn-sm" onClick={() => onEdit(l)} title="Edit line">
                <Pencil size={14} />
              </button>
            </td>
          )}
        </tr>
      ))}
      <TotalRow label={`${name} subtotal`} m={subtotal} colSpan={textCols} trailing={canEdit} />
    </>
  );
}

function ChartCard({ data }: { data: CostReport["chart"] }) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-ink">Approved Baseline Budget vs Anticipated Final Account by package</h2>
      <p className="mb-3 text-xs text-muted">SAR. Hover a package for the exact values; the Level 2 table holds the same figures.</p>
      <CostChart data={data} />
    </div>
  );
}
