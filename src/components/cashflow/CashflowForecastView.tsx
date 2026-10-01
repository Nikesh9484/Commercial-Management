"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import type { CashflowForecast, CashMonth } from "@/lib/cashflow/forecast";
import { monthLabel } from "@/lib/cashflow/months";
import { formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExportButtons } from "@/components/ui/ExportButtons";
import { LineChart } from "@/components/charts/LineChart";

/**
 * The cash flow forecast on screen: the executive summary and KPI cards, the three charts
 * (monthly bars, cumulative S-curve, budget vs actual vs forecast), then the monthly, package
 * and yearly tables and the observations – the same model as the PDF and the Excel.
 */
const money = (v: number) => (Math.abs(v) < 0.005 ? "–" : formatMoney(v));
const pct = (v: number | null) => (v === null ? "–" : `${v}%`);

function Card({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "red" | "green" }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-lg font-bold tnum ${tone === "red" ? "text-red-700" : tone === "green" ? "text-emerald-700" : "text-ink"}`}>{value}</div>
      {note && <div className="mt-0.5 text-xs text-muted">{note}</div>}
    </div>
  );
}

function Section({ title, note, children, open = true }: { title: string; note?: string; children: React.ReactNode; open?: boolean }) {
  const [shown, setShown] = useState(open);
  return (
    <section className="card">
      <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setShown((v) => !v)}>
        <span>
          <span className="font-semibold text-ink">{title}</span>
          {note && <span className="ml-2 text-xs text-muted">{note}</span>}
        </span>
        <ChevronDown size={16} className={`shrink-0 text-muted transition ${shown ? "rotate-180" : ""}`} />
      </button>
      {shown && <div className="border-t border-line px-4 py-3">{children}</div>}
    </section>
  );
}

/** Monthly bars: planned (blue) beside actual (green) or forecast (orange). */
function MonthlyBars({ months }: { months: CashMonth[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!months.length) return null;
  const width = Math.max(640, months.length * 34 + 90);
  const height = 240;
  const pad = { top: 14, right: 12, bottom: 40, left: 70 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...months.flatMap((m) => [m.planned, m.total]));
  const band = plotW / months.length;
  const bw = Math.max(3, Math.min(12, band / 2.6));
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label="Monthly cash flow">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(max * t)} y2={y(max * t)} stroke="#e5e9f0" />
            <text x={pad.left - 6} y={y(max * t) + 3} fontSize={10} textAnchor="end" fill="#5b6577">
              {compact(max * t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = pad.left + band * i + band / 2;
          return (
            <g key={m.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={cx - bw - 1} y={y(m.planned)} width={bw} height={plotH + pad.top - y(m.planned)} fill="#2a78d6" opacity={0.85} />
              <rect x={cx + 1} y={y(m.total)} width={bw} height={plotH + pad.top - y(m.total)} fill={m.kind === "forecast" ? "#eb6834" : "#067647"} opacity={0.9} />
              {(i % Math.max(1, Math.ceil(months.length / 18)) === 0 || months.length < 20) && (
                <text x={cx} y={height - pad.bottom + 14} fontSize={9} textAnchor="middle" fill="#172033">
                  {m.label}
                </text>
              )}
              {m.kind === "current" && <text x={cx} y={pad.top - 2} fontSize={9} textAnchor="middle" fill="#b45309">report month</text>}
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <rect x={Math.min(width - 230, pad.left + band * hover)} y={pad.top} width={220} height={58} rx={6} fill="#172033" opacity={0.92} />
            <text x={Math.min(width - 230, pad.left + band * hover) + 10} y={pad.top + 16} fontSize={11} fill="#fff" fontWeight={600}>
              {months[hover].label} · {months[hover].kind}
            </text>
            <text x={Math.min(width - 230, pad.left + band * hover) + 10} y={pad.top + 32} fontSize={10} fill="#cfe0ff">
              Planned {formatMoney(months[hover].planned)}
            </text>
            <text x={Math.min(width - 230, pad.left + band * hover) + 10} y={pad.top + 48} fontSize={10} fill="#ffd9c7">
              {months[hover].kind === "forecast" ? "Forecast" : "Actual"} {formatMoney(months[hover].total)}
            </text>
          </g>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted">
        <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-[#2a78d6] align-middle" /> Planned</span>
        <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-[#067647] align-middle" /> Actual (certified)</span>
        <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-[#eb6834] align-middle" /> Forecast</span>
      </div>
    </div>
  );
}

function compact(v: number) {
  if (v >= 1e9) return `${Number((v / 1e9).toFixed(2))}bn`;
  if (v >= 1e6) return `${Number((v / 1e6).toFixed(1))}M`;
  if (v >= 1e3) return `${Number((v / 1e3).toFixed(0))}k`;
  return String(Math.round(v));
}

export function CashflowForecastView({ forecast: cf, periodId, periods }: { forecast: CashflowForecast; periodId: number; periods: { id: number; label: string; status: string }[] }) {
  const router = useRouter();
  const s = cf.summary;
  const k = cf.kpis;
  const idx = cf.months.findIndex((m) => m.kind === "current");
  const around = cf.months.slice(Math.max(0, idx - 11), Math.min(cf.months.length, idx + 13));
  const [allMonths, setAllMonths] = useState(false);
  const shownMonths = allMonths ? cf.months : around;
  const curve = cf.months.map((m) => ({ label: m.label, values: { planned: m.cumulativePlanned, actual: m.kind === "forecast" ? 0 : m.cumulative, forecast: m.kind === "actual" ? 0 : m.cumulative } }));
  const trio = [
    { label: "Approved budget", value: s.budget, color: "#2a78d6" },
    { label: "Committed", value: s.committed, color: "#7c3aed" },
    { label: "Actual to date", value: s.actual, color: "#067647" },
    { label: "Forecast final", value: s.forecastFinal, color: "#eb6834" },
  ];
  const maxV = Math.max(1, ...trio.map((t) => t.value));
  const sum = (key: keyof CashMonth) => cf.months.reduce((t, m) => t + (Number(m[key]) || 0), 0);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Cash Flow Forecast"
        subtitle={`${cf.programme.name} (${cf.programme.code}) · ${cf.period.label} · ${monthLabel(s.start)} to ${monthLabel(s.end)} (${s.durationMonths} months) · SAR excl. VAT · built from the cost report, the IPC log and the contracts' completion dates`}
        actions={
          <span className="inline-flex flex-wrap items-center gap-2">
            {periods.length > 1 && (
              <select className="input input-sm" value={periodId} onChange={(e) => router.push(`/reports/cashflow-forecast?period=${e.target.value}`)} aria-label="Report">
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}{p.status === "Locked" ? " (issued)" : ""}
                  </option>
                ))}
              </select>
            )}
            <ExportButtons section="cashflow_forecast" params={`period=${periodId}`} title="Cash Flow Forecast" />
          </span>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="Total approved budget" value={formatMoney(s.budget)} note="cost report column G" />
        <Card label="Actual spend to date" value={formatMoney(s.actual)} note={`certified to ${cf.period.label}`} />
        <Card label="Committed cost" value={formatMoney(s.committed)} note="awarded contracts + determined VOs" />
        <Card label="Forecast remaining cost" value={formatMoney(s.forecastRemaining)} note="cash to completion" />
        <Card label="Forecast final cost" value={formatMoney(s.forecastFinal)} note={`anticipated final account ${formatMoney(s.afa)}`} />
        <Card label="Budget variance" value={`${s.variance > 0 ? "+" : ""}${formatMoney(s.variance)}`} note={s.variance > 0 ? "forecast above budget" : "within budget"} tone={s.variance > 0 ? "red" : "green"} />
        <Card label="Previous report forecast" value={s.previousForecastFinal === null ? "–" : formatMoney(s.previousForecastFinal)} note={s.forecastChange === null ? "no previous report" : `${s.forecastChange >= 0 ? "+" : ""}${formatMoney(s.forecastChange)} since last report`} />
        <Card label="Peak funding month" value={k.peakMonth ? k.peakMonth.label : "–"} note={k.peakMonth ? `SAR ${formatMoney(k.peakMonth.amount)}` : ""} />
      </div>

      <Section title="Management dashboard – KPIs">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Card label="Budget utilisation" value={pct(k.budgetUtilisation)} note="forecast final ÷ budget" tone={(k.budgetUtilisation ?? 0) > 100 ? "red" : undefined} />
          <Card label="Cost committed" value={pct(k.committedPct)} note="committed ÷ budget" />
          <Card label="Cost spent" value={pct(k.spentPct)} note="actual ÷ budget" />
          <Card label="Forecast completion" value={pct(k.completionPct)} note="actual ÷ forecast final" />
          <Card label="Remaining budget" value={formatMoney(k.remainingBudget)} note="budget − actual" />
          <Card label="Peak funding month" value={k.peakMonth?.label ?? "–"} note={k.peakMonth ? formatMoney(k.peakMonth.amount) : ""} />
        </div>
      </Section>

      <Section title="Budget vs actual vs forecast">
        <div className="space-y-2">
          {trio.map((t) => (
            <div key={t.label} className="flex items-center gap-3 text-sm">
              <span className="w-36 shrink-0 text-muted">{t.label}</span>
              <span className="h-4 rounded-sm" style={{ width: `${Math.max(1, (t.value / maxV) * 60)}%`, background: t.color }} />
              <span className="tnum font-semibold">{formatMoney(t.value)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Monthly cash flow" note={`${shownMonths[0]?.label ?? ""} to ${shownMonths[shownMonths.length - 1]?.label ?? ""}`}>
        <MonthlyBars months={shownMonths} />
        <button type="button" className="btn btn-sm btn-secondary mt-2" onClick={() => setAllMonths((v) => !v)}>
          {allMonths ? "Show 12 months either side of the report" : "Show the whole project"}
        </button>
      </Section>

      <Section title="Cumulative cash flow – S-curve" note="planned against actual, then forecast">
        <LineChart
          series={[
            { key: "planned", label: "Planned (budget S-curve)", color: "#2a78d6" },
            { key: "actual", label: "Actual (certified)", color: "#067647" },
            { key: "forecast", label: "Forecast", color: "#eb6834" },
          ]}
          points={curve}
          ariaLabel="Cumulative cash flow"
        />
      </Section>

      <Section title="Monthly cash flow table" note="SAR excl. VAT">
        <div className="overflow-auto">
          <table className="table text-xs">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Planned</th>
                <th className="text-right">Actual</th>
                <th className="text-right">Forecast</th>
                <th className="text-right">Contractor</th>
                <th className="text-right">Consultant</th>
                <th className="text-right">Other</th>
                <th className="text-right">Total outflow</th>
                <th className="text-right">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {cf.months.map((m) => (
                <tr key={m.key} className={m.kind === "current" ? "bg-amber-50 font-semibold" : m.kind === "forecast" ? "text-orange-900" : ""}>
                  <td>{m.label}</td>
                  <td className="text-right tnum">{money(m.planned)}</td>
                  <td className="text-right tnum">{money(m.actual)}</td>
                  <td className="text-right tnum">{money(m.forecast)}</td>
                  <td className="text-right tnum">{money(m.contractor)}</td>
                  <td className="text-right tnum">{money(m.consultant)}</td>
                  <td className="text-right tnum">{money(m.other)}</td>
                  <td className="text-right tnum">{money(m.total)}</td>
                  <td className="text-right tnum">{money(m.cumulative)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td>Total</td>
                <td className="text-right tnum">{money(sum("planned"))}</td>
                <td className="text-right tnum">{money(sum("actual"))}</td>
                <td className="text-right tnum">{money(sum("forecast"))}</td>
                <td className="text-right tnum">{money(sum("contractor"))}</td>
                <td className="text-right tnum">{money(sum("consultant"))}</td>
                <td className="text-right tnum">{money(sum("other"))}</td>
                <td className="text-right tnum">{money(sum("total"))}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Cash flow by major package" note="SAR excl. VAT">
        <div className="overflow-auto">
          <table className="table text-xs">
            <thead>
              <tr>
                <th>Package</th>
                <th className="text-right">Lines</th>
                <th className="text-right">Approved budget</th>
                <th className="text-right">Committed</th>
                <th className="text-right">Actual to date</th>
                <th className="text-right">Forecast remaining</th>
                <th className="text-right">Forecast final</th>
                <th className="text-right">Variance</th>
                <th>Spending period</th>
                <th>Peak month</th>
              </tr>
            </thead>
            <tbody>
              {cf.packages.map((p) => (
                <tr key={p.category}>
                  <td className="font-medium">{p.category}</td>
                  <td className="text-right tnum">{p.lines}</td>
                  <td className="text-right tnum">{money(p.budget)}</td>
                  <td className="text-right tnum">{money(p.committed)}</td>
                  <td className="text-right tnum">{money(p.actual)}</td>
                  <td className="text-right tnum">{money(p.forecastRemaining)}</td>
                  <td className="text-right tnum">{money(p.forecastFinal)}</td>
                  <td className={`text-right tnum ${p.variance > 0.5 ? "text-red-700" : p.variance < -0.5 ? "text-emerald-700" : ""}`}>{money(p.variance)}</td>
                  <td>{p.firstMonth ? `${monthLabel(p.firstMonth)} – ${p.lastMonth ? monthLabel(p.lastMonth) : ""}` : "–"}</td>
                  <td>{p.peakMonth ? `${monthLabel(p.peakMonth)} (${formatMoney(p.peakAmount)})` : "–"}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td>Total</td>
                <td className="text-right tnum">{cf.packages.reduce((t, p) => t + p.lines, 0)}</td>
                <td className="text-right tnum">{money(s.budget)}</td>
                <td className="text-right tnum">{money(s.committed)}</td>
                <td className="text-right tnum">{money(s.actual)}</td>
                <td className="text-right tnum">{money(s.forecastRemaining)}</td>
                <td className="text-right tnum">{money(s.forecastFinal)}</td>
                <td className="text-right tnum">{money(s.variance)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Yearly summary" note="SAR excl. VAT">
        <table className="table text-xs">
          <thead>
            <tr>
              <th>Year</th>
              <th className="text-right">Annual budget</th>
              <th className="text-right">Annual forecast (actual + forecast)</th>
              <th className="text-right">Actual spend</th>
              <th className="text-right">Variance</th>
            </tr>
          </thead>
          <tbody>
            {cf.years.map((y) => (
              <tr key={y.year}>
                <td>{y.year}</td>
                <td className="text-right tnum">{money(y.budget)}</td>
                <td className="text-right tnum">{money(y.forecast)}</td>
                <td className="text-right tnum">{money(y.actual)}</td>
                <td className={`text-right tnum ${y.variance > 0.5 ? "text-red-700" : y.variance < -0.5 ? "text-emerald-700" : ""}`}>{money(y.variance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Key observations">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {cf.observations.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
        <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Basis of the forecast</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted">
          {cf.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </Section>

      <Section title="Lines behind the forecast" note={`${cf.lines.length} cost report lines`} open={false}>
        <div className="overflow-auto">
          <table className="table text-xs">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Contractor</th>
                <th>Package</th>
                <th>Payer</th>
                <th className="text-right">Budget</th>
                <th className="text-right">Committed</th>
                <th className="text-right">Actual</th>
                <th className="text-right">Forecast final</th>
                <th>Start</th>
                <th>End</th>
              </tr>
            </thead>
            <tbody>
              {cf.lines.map((l) => (
                <tr key={l.code}>
                  <td className="whitespace-nowrap">{l.code}</td>
                  <td>{l.name}</td>
                  <td>{l.contractor}</td>
                  <td>{l.category}</td>
                  <td>{l.payer}</td>
                  <td className="text-right tnum">{money(l.budget)}</td>
                  <td className="text-right tnum">{money(l.committed)}</td>
                  <td className="text-right tnum">{money(l.actual)}</td>
                  <td className="text-right tnum">{money(l.forecastFinal)}</td>
                  <td className="whitespace-nowrap">{monthLabel(l.start)}</td>
                  <td className="whitespace-nowrap">{monthLabel(l.end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
