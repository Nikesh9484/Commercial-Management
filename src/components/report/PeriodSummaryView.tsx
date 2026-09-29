"use client";

import { useState } from "react";
import Link from "next/link";
import { FileDown, FileSpreadsheet, Copy, Check, ChevronDown, TrendingUp, TrendingDown, Minus, Sparkles, ArrowRight } from "lucide-react";
import type { PeriodSummary, CategorySection, ItemKind } from "@/lib/report/period-summary";
import { sar, sarMove } from "@/lib/report/period-summary";
import { formatMoney } from "@/lib/format";
import { EmailReportButton } from "@/components/dashboard/EmailReportButton";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * The Period Summary on screen: the same story as the PDF and the email – projected cost to
 * complete, budget position, what moved the forecast, change status, and the items behind each
 * movement – laid out to be read on a screen: colour-coded cards, a movement chart, and each
 * category folded away until it is opened.
 */
const KIND_TONE: Record<ItemKind, string> = {
  new: "bg-emerald-50 text-emerald-800 border-emerald-200",
  in: "bg-sky-50 text-sky-800 border-sky-200",
  revised: "bg-amber-50 text-amber-800 border-amber-200",
  out: "bg-violet-50 text-violet-800 border-violet-200",
  removed: "bg-slate-100 text-slate-700 border-slate-200",
};
const KIND_LABEL: Record<ItemKind, string> = { new: "New", in: "Moved in", revised: "Revised", out: "Cascaded", removed: "Closed" };
const CAT_COLOR: Record<string, string> = { H: "#7c3aed", J: "#2f80ed", K: "#0ea5e9", L: "#f59e0b", M: "#ef4444" };

function Move({ value, className = "" }: { value: number | null; className?: string }) {
  if (value === null) return <span className={`text-muted ${className}`}>–</span>;
  const up = value > 0.5;
  const down = value < -0.5;
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 tnum ${up ? "text-red-700" : down ? "text-emerald-700" : "text-muted"} ${className}`}>
      <Icon size={14} /> {sarMove(value)}
    </span>
  );
}

/** Horizontal signed bars: increases to the right (red), reductions to the left (green). */
function MovementChart({ rows, net }: { rows: { key: string; label: string; short: string; value: number }[]; net: number | null }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)), Math.abs(net ?? 0));
  const all = [...rows.map((r) => ({ key: r.key, label: r.short, value: r.value })), ...(net === null ? [] : [{ key: "net", label: "Net forecast movement", value: net }])];
  const L = 150; // label column
  const W = 300; // bar area
  const V = 110; // value column
  const H = all.length * 26 + 8;
  return (
    <svg viewBox={`0 0 ${L + W + V} ${H}`} className="w-full" role="img" aria-label="Forecast movement analysis">
      {all.map((r, i) => {
        const y = 4 + i * 26;
        const len = (Math.abs(r.value) / max) * (W / 2 - 4);
        const mid = L + W / 2;
        const isNet = r.key === "net";
        const fill = r.value > 0.5 ? "#dc2626" : r.value < -0.5 ? "#059669" : "#cbd5e1";
        return (
          <g key={r.key}>
            <text x={L - 8} y={y + 15} textAnchor="end" fontSize="11" fontWeight={isNet ? 700 : 500} fill="#172033">
              {r.label}
            </text>
            <line x1={mid} x2={mid} y1={y} y2={y + 22} stroke="#94a3b8" strokeWidth="1" />
            {Math.abs(r.value) >= 0.5 && <rect x={r.value > 0 ? mid : mid - len} y={y + 4} width={Math.max(2, len)} height={14} rx={3} fill={fill} opacity={isNet ? 1 : 0.85} />}
            <text x={L + W + V - 4} y={y + 15} textAnchor="end" fontSize="11" fontWeight={isNet ? 700 : 500} fill={r.value > 0.5 ? "#b91c1c" : r.value < -0.5 ? "#047857" : "#64748b"}>
              {sarMove(r.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Category({ c, open, onToggle }: { c: CategorySection; open: boolean; onToggle: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 8;
  return (
    <div className="card overflow-hidden p-0" style={{ borderTop: `4px solid ${CAT_COLOR[c.col]}` }}>
      <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 text-left hover:bg-page" aria-expanded={open}>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">{c.label}</div>
          <div className="text-xs text-muted">
            {c.count} item{c.count === 1 ? "" : "s"} moved · balance in this report {sar(c.balance)}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Move value={c.total} className="text-base font-semibold" />
          <ChevronDown size={18} className={`text-muted transition ${open ? "rotate-180" : ""}`} />
        </div>
      </button>
      {open && (
        <div className="space-y-4 border-t border-line px-5 py-4">
          <p className="text-sm leading-relaxed text-ink">{c.narrative}</p>
          {c.groups.map((g) => {
            const items = showAll ? g.items : g.items.slice(0, LIMIT);
            return (
              <div key={g.kind}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${KIND_TONE[g.kind]}`}>{KIND_LABEL[g.kind]}</span>
                  <span className="text-xs font-semibold text-ink">{g.heading}</span>
                  <Move value={g.total} className="text-xs" />
                </div>
                <div className="overflow-x-auto rounded-md border border-line">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Ref</th>
                        <th className="px-2 py-1.5 text-left">Description</th>
                        <th className="px-2 py-1.5 text-left">Contractor</th>
                        <th className="px-2 py-1.5 text-right">Previous</th>
                        <th className="px-2 py-1.5 text-right">Current</th>
                        <th className="px-2 py-1.5 text-right">Movement</th>
                        <th className="px-2 py-1.5 text-left">What happened</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {items.map((it) => (
                        <tr key={it.key} className="hover:bg-page">
                          <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-ink">{it.key}</td>
                          <td className="px-2 py-1.5 text-ink">{it.title}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-muted">{it.party}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right tnum">{formatMoney(it.prev)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right tnum">{formatMoney(it.now)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right">
                            <Move value={it.delta} />
                          </td>
                          <td className="px-2 py-1.5 text-muted">{it.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {g.items.length > LIMIT && (
                  <button type="button" className="mt-1 text-xs font-medium text-accent hover:underline" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Show fewer" : `Show all ${g.items.length} items`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PeriodSummaryView({ summary: ps, periodId }: { summary: PeriodSummary; periodId: number }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(ps.categories.filter((c) => Math.abs(c.total) >= 0.5).slice(0, 1).map((c) => c.col)));
  const [copied, setCopied] = useState(false);
  const toggle = (col: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(col)) n.delete(col);
      else n.add(col);
      return n;
    });
  const allOpen = ps.categories.length > 0 && ps.categories.every((c) => open.has(c.col));
  const pid = `&period=${periodId}`;

  const copyText = async () => {
    try {
      const r = await fetch("/api/email-report?format=json&kind=period_summary");
      const j = await r.json();
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([j.html], { type: "text/html" }), "text/plain": new Blob([j.text], { type: "text/plain" }) })]);
      } else await navigator.clipboard.writeText(j.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard not available – the Email draft button still works */
    }
  };

  const verdictTone = ps.budget.verdict === "OVER BUDGET" ? "kpi-red" : ps.budget.verdict === "UNDER BUDGET" ? "kpi-green" : "kpi-blue";
  const netTone = ps.projected.delta === null ? "kpi-blue" : ps.projected.delta > 0.5 ? "kpi-red" : ps.projected.delta < -0.5 ? "kpi-green" : "kpi-blue";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${ps.programme.code} · ${ps.assetName} · Reports`}
        title="Period Summary – Key Period Movements"
        subtitle={`Commercial Report No. ${ps.period.reportNo} · ${ps.period.label} · cut-off ${ps.period.cutOff}${ps.locked ? "" : " · draft from live data"}${ps.previous ? ` · compared with ${ps.previous.label}` : ""}`}
        actions={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={copyText} title="Copy the summary (formatted) to paste into any email or document">
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
            </button>
            <EmailReportButton kind="period_summary" label="Email draft" attachments="Period Summary.pdf · Executive Summary.pdf · Cost Report Level 1.pdf · Cost Report Level 2.pdf" tone="secondary" />
            <a className="btn btn-sm btn-pdf" href={`/api/export?section=period_summary&format=pdf${pid}`}>
              <FileDown size={14} /> PDF
            </a>
            <a className="btn btn-sm btn-excel" href={`/api/export?section=period_summary&format=xlsx${pid}`}>
              <FileSpreadsheet size={14} /> Excel
            </a>
          </>
        }
      />

      {ps.warning && <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">{ps.warning}</div>}

      {/* Headline cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card kpi kpi-E min-w-0 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Previous report{ps.previous ? ` · ${ps.previous.short}` : ""}</div>
          <div className="mt-1 truncate text-lg font-semibold tnum text-ink">{ps.projected.prev === null ? "–" : sar(ps.projected.prev)}</div>
          <div className="text-xs text-muted">projected cost to complete</div>
        </div>
        <div className="card kpi kpi-N min-w-0 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Updated position · {ps.period.short}</div>
          <div className="mt-1 truncate text-lg font-semibold tnum text-ink">{sar(ps.projected.now)}</div>
          <div className="text-xs text-muted">anticipated final account</div>
        </div>
        <div className={`card kpi ${netTone} min-w-0 p-4`}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Net movement</div>
          <div className="mt-1 truncate text-lg font-semibold">
            <Move value={ps.projected.delta} />
          </div>
          <div className="text-xs text-muted">{ps.projected.deltaPct === null ? "no issued previous report" : `${ps.projected.deltaPct > 0 ? "+" : ""}${ps.projected.deltaPct.toFixed(2)}% on the previous forecast`}</div>
        </div>
        <div className={`card kpi ${verdictTone} min-w-0 p-4`}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Variance to budget · {ps.budget.verdict}</div>
          <div className="mt-1 truncate text-lg font-semibold">
            <Move value={ps.budget.variance} />
          </div>
          <div className="text-xs text-muted">
            {ps.budget.variancePct > 0 ? "+" : ""}
            {ps.budget.variancePct.toFixed(2)}% of {sar(ps.budget.approved)}
          </div>
        </div>
      </div>

      {/* Narrative */}
      <div className="card border-l-4 border-l-navy p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Sparkles size={16} className="text-navy" /> Projected cost to complete
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-ink">{ps.projected.narrative}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Budget position */}
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-ink">Budget position</h2>
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-line">
              <tr>
                <td className="py-2 text-ink">Current forecast</td>
                <td className="py-2 text-right tnum font-medium">{sar(ps.budget.forecast)}</td>
              </tr>
              <tr>
                <td className="py-2 text-ink">Approved budget</td>
                <td className="py-2 text-right tnum font-medium">{sar(ps.budget.approved)}</td>
              </tr>
              <tr className="bg-page">
                <td className="py-2 font-semibold text-ink">Variance ({ps.budget.verdict})</td>
                <td className="py-2 text-right font-semibold">
                  <Move value={ps.budget.variance} /> <span className="text-xs text-muted">· {ps.budget.variancePct.toFixed(2)}%</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs italic leading-relaxed text-muted">Note: {ps.budget.note}</p>
        </div>

        {/* Forecast movement analysis */}
        <div className="card p-5 lg:col-span-3">
          <h2 className="text-sm font-semibold text-ink">Forecast movement analysis</h2>
          {ps.hasComparison ? (
            <>
              <p className="text-xs text-muted">What moved the anticipated final account since {ps.previous!.label}. Red bars increase the forecast, green bars reduce it.</p>
              <div className="mt-3">
                <MovementChart rows={ps.movement.rows} net={ps.movement.net} />
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">The movement analysis needs an issued previous report to compare with.</p>
          )}
        </div>
      </div>

      {/* Change status */}
      {ps.status.length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-ink">Change management – monthly status summary</h2>
          <p className="text-xs text-muted">Items still pending at each stage{ps.previous ? `, last month → this month` : ""}.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {ps.status.map((s) => (
              <Link key={s.stage} href="/modules/change-management" className="rounded-lg border border-line bg-page px-4 py-3 transition hover:border-accent">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">{s.label} pending</div>
                <div className="mt-1 flex items-center gap-2 text-lg font-semibold tnum text-ink">
                  {ps.hasComparison && (
                    <>
                      <span className="text-muted">{s.prev}</span>
                      <ArrowRight size={14} className="text-muted" />
                    </>
                  )}
                  <span>{s.now}</span>
                  {ps.hasComparison && <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${s.delta > 0 ? "bg-red-100 text-red-700" : s.delta < 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{s.delta > 0 ? `+${s.delta}` : s.delta}</span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Categories */}
      {ps.hasComparison && ps.categories.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Key period movements by category</h2>
            <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setOpen(allOpen ? new Set() : new Set(ps.categories.map((c) => c.col)))}>
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {ps.categories.map((c) => (
              <button key={c.col} type="button" onClick={() => toggle(c.col)} className={`rounded-lg border px-3 py-2 text-left transition hover:border-navy ${open.has(c.col) ? "border-navy bg-white shadow-sm" : "border-line bg-page"}`}>
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: CAT_COLOR[c.col] }} /> {c.short}
                </div>
                <div className="mt-1 text-sm font-semibold">
                  <Move value={c.total} />
                </div>
              </button>
            ))}
          </div>
          {ps.categories.map((c) => (
            <Category key={c.col} c={c} open={open.has(c.col)} onToggle={() => toggle(c.col)} />
          ))}
        </div>
      )}

      {/* Balances */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-ink">Balances carried in the cost report</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {ps.balances.map((b) => (
            <div key={b.label} className="rounded-lg border border-line px-3 py-2">
              <div className="text-[11px] text-muted">{b.label}</div>
              <div className="text-sm font-semibold tnum text-ink">{sar(b.value)}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Figures are the cost report&apos;s anticipated final account; movements compare with the previous issued report. Positive movements are increases in forecast cost.</p>
      </div>
    </div>
  );
}
