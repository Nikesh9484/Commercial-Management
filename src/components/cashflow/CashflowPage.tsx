"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, RefreshCw, Calendar, Undo2 } from "lucide-react";
import type { Cashflow, CashCell } from "@/lib/cashflow/compute";
import { formatMoney, formatDate } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { Chip } from "@/components/ui/Chip";
import { LineChart } from "@/components/charts/LineChart";

type Tab = "grid" | "chart" | "accruals";
type Loaded = Cashflow & { canEdit: boolean };

export function CashflowPage() {
  const toast = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("grid");
  const [rangeOpen, setRangeOpen] = useState(false);

  const load = useCallback(
    () =>
      fetch("/api/cashflow", { cache: "no-store" })
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "Could not load the cash flow.");
          return j as Loaded;
        })
        .then(setData, (e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function saveCell(contract_id: number, month: string, patch: { forecast?: number | null; actual_override?: number | null }) {
    const res = await fetch("/api/cashflow/cell", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contract_id, month, ...patch }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error ?? "Could not save.", "error");
    load();
  }

  async function saveRange(start: string, count: number) {
    const res = await fetch("/api/cashflow/range", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start, count }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error ?? "Could not save.", "error");
    setRangeOpen(false);
    load();
  }

  if (error) return <div className="card p-6 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="card p-6 text-sm text-muted">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 border-b border-line">
          {(
            [
              ["grid", "Monthly grid"],
              ["chart", "Cumulative chart"],
              ["accruals", `Accruals (${data.accruals.byContract.length})`],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${tab === k ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto flex flex-wrap gap-2">
          {data.canEdit && (
            <button className="btn btn-secondary btn-sm" onClick={() => setRangeOpen((o) => !o)}>
              <Calendar size={14} /> Months: {data.months[0]?.label} – {data.months[data.months.length - 1]?.label}
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={load}>
            <RefreshCw size={14} /> Refresh
          </button>
          <a className="btn btn-secondary btn-sm" href="/api/cashflow/export">
            <Download size={14} /> Export (Excel)
          </a>
        </span>
      </div>

      {rangeOpen && <RangeEditor start={data.range.start} count={data.range.count} onSave={saveRange} onCancel={() => setRangeOpen(false)} />}

      {tab === "grid" && <Grid data={data} onSave={saveCell} />}
      {tab === "chart" && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-ink">Cumulative forecast vs actual</h2>
          <p className="mb-3 text-xs text-muted">SAR excl. VAT, all contracts. {data.actualsNote}</p>
          <LineChart
            ariaLabel="Cumulative forecast vs actual cash flow"
            series={[
              { key: "forecast", label: "Cumulative forecast", color: "#2a78d6" },
              { key: "actual", label: "Cumulative actual", color: "#eb6834" },
            ]}
            points={data.chart.map((p) => ({ label: p.label, values: { forecast: p.forecast, actual: p.actual } }))}
          />
        </div>
      )}
      {tab === "accruals" && <AccrualsView data={data} />}
    </div>
  );
}

function RangeEditor({ start, count, onSave, onCancel }: { start: string; count: number; onSave: (s: string, c: number) => void; onCancel: () => void }) {
  const [s, setS] = useState(start);
  const [c, setC] = useState(count);
  return (
    <div className="card flex flex-wrap items-end gap-3 p-3 text-sm">
      <label className="flex flex-col gap-1 text-xs text-muted">
        First month
        <input type="month" className="input" value={s} onChange={(e) => setS(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Number of months
        <input type="number" min={1} max={120} className="input w-28" value={c} onChange={(e) => setC(Number(e.target.value))} />
      </label>
      <button className="btn btn-primary btn-sm" onClick={() => onSave(s, c)}>
        Apply
      </button>
      <button className="btn btn-ghost btn-sm" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function Grid({ data, onSave }: { data: Loaded; onSave: (contract_id: number, month: string, patch: { forecast?: number | null; actual_override?: number | null }) => void }) {
  if (!data.rows.length) {
    return (
      <div className="card p-6 text-sm text-muted">
        No contracts yet. Add them under{" "}
        <Link href="/modules/invoices-payments" className="text-accent hover:underline">
          Invoices &amp; Payments
        </Link>{" "}
        and they will appear here as cash flow rows.
      </div>
    );
  }
  const textCols = ["Transaction No", "Supplier", "Line Description", "Coding", "CBS", "Programme"];
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Type a forecast in any month and press Tab or click away to save. {data.actualsNote} Click an actual to override it; clear the box to go back to the automatic value. Difference = Actual − Forecast (red = more than forecast).
      </p>
      <div className="card overflow-hidden">
        <div className="max-h-[70vh] overflow-auto">
          <table className="data w-full">
            <thead>
              <tr>
                {textCols.map((c, i) => (
                  <th key={c} rowSpan={2} className={`align-bottom ${i === 0 ? "sticky left-0 z-[3] bg-[#f7f8fb]" : ""}`}>
                    {c}
                  </th>
                ))}
                {data.months.map((m) => (
                  <th key={m.key} colSpan={3} className="border-l border-line text-center">
                    {m.label}
                  </th>
                ))}
                <th colSpan={3} className="border-l border-line text-center">
                  Total
                </th>
              </tr>
              <tr>
                {data.months.map((m) => (
                  <Sub key={m.key} />
                ))}
                <Sub />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.contract_id}>
                  <td className="sticky left-0 z-[1] bg-white font-medium">{r.transaction_no || <span className="text-muted/60">—</span>}</td>
                  <td>{r.supplier}</td>
                  <td className="max-w-56 truncate" title={r.description}>
                    {r.description}
                  </td>
                  <td>{r.coding || <span className="text-muted/60">—</span>}</td>
                  <td>{r.cbs || <span className="text-muted/60">—</span>}</td>
                  <td className="text-muted">{r.programme}</td>
                  {data.months.map((m) => (
                    <MonthCells key={m.key} cell={r.cells[m.key]} canEdit={data.canEdit} onForecast={(v) => onSave(r.contract_id, m.key, { forecast: v })} onOverride={(v) => onSave(r.contract_id, m.key, { actual_override: v })} />
                  ))}
                  <td className="tnum border-l border-line text-right font-medium">{formatMoney(r.total_forecast)}</td>
                  <td className="tnum text-right font-medium">{formatMoney(r.total_actual)}</td>
                  <td className={`tnum text-right font-medium ${diffCls(r.total_difference)}`}>{formatMoney(r.total_difference)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[#e8eef7] font-semibold text-navy">
                <td className="sticky left-0 z-[1] bg-[#e8eef7]" colSpan={6}>
                  Total
                </td>
                {data.months.map((m) => (
                  <MonthTotal key={m.key} t={data.monthTotals[m.key]} />
                ))}
                <td className="tnum border-l border-line text-right">{formatMoney(data.grand.forecast)}</td>
                <td className="tnum text-right">{formatMoney(data.grand.actual)}</td>
                <td className={`tnum text-right ${diffCls(data.grand.difference)}`}>{formatMoney(data.grand.difference)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function Sub() {
  return (
    <>
      <th className="border-l border-line text-right text-[11px] font-medium">Forecast</th>
      <th className="text-right text-[11px] font-medium">Actual</th>
      <th className="text-right text-[11px] font-medium">Diff</th>
    </>
  );
}

function MonthTotal({ t }: { t: { forecast: number; actual: number; difference: number } }) {
  return (
    <>
      <td className="tnum border-l border-line text-right">{formatMoney(t.forecast)}</td>
      <td className="tnum text-right">{formatMoney(t.actual)}</td>
      <td className={`tnum text-right ${diffCls(t.difference)}`}>{formatMoney(t.difference)}</td>
    </>
  );
}

function diffCls(v: number | null) {
  if (v === null) return "text-muted/60";
  return v > 0.004 ? "text-red-700" : v < -0.004 ? "text-emerald-700" : "text-muted";
}

function MonthCells({ cell, canEdit, onForecast, onOverride }: { cell: CashCell; canEdit: boolean; onForecast: (v: number | null) => void; onOverride: (v: number | null) => void }) {
  return (
    <>
      <td className="border-l border-line p-1">
        <MoneyInput value={cell.forecast} canEdit={canEdit} onCommit={onForecast} placeholder="0.00" />
      </td>
      <td className="p-1">
        <div className="flex items-center gap-1">
          <MoneyInput value={cell.actual_override ?? (cell.actual_auto === 0 ? null : cell.actual_auto)} canEdit={canEdit} onCommit={onOverride} placeholder={formatMoney(cell.actual_auto) || "0.00"} title={cell.actual_override !== null ? `Manual override. Automatic value: ${formatMoney(cell.actual_auto)}` : "Automatic from Payment Tracking. Type to override."} className={cell.actual_override !== null ? "border-amber-300 bg-amber-50" : ""} />
          {cell.actual_override !== null && canEdit && (
            <button className="text-muted hover:text-ink" title="Remove override (back to automatic)" onClick={() => onOverride(null)}>
              <Undo2 size={13} />
            </button>
          )}
        </div>
      </td>
      <td className={`tnum text-right ${diffCls(cell.difference)}`}>{cell.difference === null ? "—" : formatMoney(cell.difference)}</td>
    </>
  );
}

function MoneyInput({ value, canEdit, onCommit, placeholder, title, className = "" }: { value: number | null; canEdit: boolean; onCommit: (v: number | null) => void; placeholder?: string; title?: string; className?: string }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  if (!canEdit) return <span className="tnum block text-right">{value === null ? <span className="text-muted/60">{placeholder}</span> : formatMoney(value)}</span>;
  const commit = () => {
    setEditing(false);
    const n = text.trim() === "" ? null : Number(text.replace(/,/g, ""));
    if (n !== null && Number.isNaN(n)) return setText(value === null ? "" : String(value));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      className={`input tnum w-28 px-1.5 py-0.5 text-right text-xs ${className}`}
      value={editing ? text : value === null ? "" : formatMoney(value)}
      placeholder={placeholder}
      title={title}
      onFocus={() => {
        setEditing(true);
        setText(value === null ? "" : String(value));
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value === null ? "" : String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function AccrualsView({ data }: { data: Loaded }) {
  const a = data.accruals;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="card min-w-0 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Accrued (certified, not paid)</div>
          <div className="mt-1 text-lg font-semibold tnum text-ink">{formatMoney(a.totalAccrued)}</div>
          <div className="text-xs text-muted">net, excl. VAT · {a.byContract.length} contract(s)</div>
        </div>
        <div className="card min-w-0 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Of which overdue for payment</div>
          <div className={`mt-1 text-lg font-semibold tnum ${a.totalOverdue > 0 ? "text-red-700" : "text-emerald-700"}`}>{formatMoney(a.totalOverdue)}</div>
          <div className="text-xs text-muted">past the contractual payment due date</div>
        </div>
        <div className="card min-w-0 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Unpaid certificates</div>
          <div className="mt-1 text-lg font-semibold tnum text-ink">{a.applications.length}</div>
          <div className="text-xs text-muted">IPCs certified with no paid date</div>
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="px-5 pt-4">
          <h2 className="text-sm font-semibold text-ink">By contract</h2>
        </div>
        <div className="overflow-x-auto px-2 pb-2 pt-3">
          <table className="data w-full">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Supplier</th>
                <th className="text-right">Net certified</th>
                <th className="text-right">Net paid</th>
                <th className="text-right">Accrued</th>
              </tr>
            </thead>
            <tbody>
              {a.byContract.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted">
                    Nothing certified is awaiting payment.
                  </td>
                </tr>
              )}
              {a.byContract.map((c) => (
                <tr key={c.contract_id}>
                  <td className="font-medium">
                    <Link href={`/modules/invoices-payments/${c.contract_id}`} className="hover:text-accent">
                      {c.contract}
                    </Link>
                  </td>
                  <td>{c.supplier}</td>
                  <td className="tnum text-right">{formatMoney(c.net_certified)}</td>
                  <td className="tnum text-right">{formatMoney(c.net_paid)}</td>
                  <td className="tnum text-right font-semibold">{formatMoney(c.accrued)}</td>
                </tr>
              ))}
            </tbody>
            {a.byContract.length > 0 && (
              <tfoot>
                <tr className="bg-page font-semibold">
                  <td colSpan={4}>Total</td>
                  <td className="tnum text-right">{formatMoney(a.totalAccrued)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="px-5 pt-4">
          <h2 className="text-sm font-semibold text-ink">Unpaid certificates</h2>
        </div>
        <div className="overflow-x-auto px-2 pb-2 pt-3">
          <table className="data w-full">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Application</th>
                <th>IPC</th>
                <th>IPC date</th>
                <th className="text-right">Net certified</th>
                <th className="text-right">VAT</th>
                <th className="text-right">Incl. VAT</th>
                <th>Payment due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {a.applications.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-muted">
                    No unpaid certificates.
                  </td>
                </tr>
              )}
              {a.applications.map((x) => (
                <tr key={`${x.contract_id}-${x.application_no}`} className={(x.days_overdue ?? 0) > 0 ? "bg-red-50/70" : ""}>
                  <td className="font-medium">{x.contract}</td>
                  <td>{x.application_no}</td>
                  <td>{x.ipc_no || <span className="text-muted/60">—</span>}</td>
                  <td>{formatDate(x.ipc_date) || <span className="text-muted/60">not issued</span>}</td>
                  <td className="tnum text-right">{formatMoney(x.net_certified)}</td>
                  <td className="tnum text-right">{formatMoney(x.vat)}</td>
                  <td className="tnum text-right">{formatMoney(x.gross)}</td>
                  <td>{formatDate(x.payment_due_date) || <span className="text-muted/60">—</span>}</td>
                  <td>{x.days_overdue !== null && x.days_overdue > 0 ? <Chip tone="red">{x.days_overdue} days overdue</Chip> : <Chip tone="amber">Awaiting payment</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
