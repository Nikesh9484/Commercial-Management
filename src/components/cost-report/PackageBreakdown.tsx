"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";

/**
 * Cost report by package as a ranked list: one row per package, a bar for the approved baseline
 * budget with the anticipated final account drawn over it, the amounts and the variance. Fits any
 * screen width (no scrolling) and reads like a league table – the largest packages first.
 */
const whole = (v: number) => Math.round(v).toLocaleString("en-US");

export function PackageBreakdown({ data, initial = 10, compact = false }: { data: { package: string; baseline: number; afa: number }[]; initial?: number; compact?: boolean }) {
  const [all, setAll] = useState(false);
  if (!data.length) return <p className="py-8 text-center text-sm text-muted">Add cost lines to see the packages.</p>;
  const sorted = [...data].sort((a, b) => Math.max(b.afa, b.baseline) - Math.max(a.afa, a.baseline));
  const shown = all ? sorted : sorted.slice(0, initial);
  const rest = sorted.slice(shown.length);
  const max = Math.max(1, ...sorted.flatMap((d) => [d.baseline, d.afa]));
  const totals = data.reduce((t, d) => ({ baseline: t.baseline + d.baseline, afa: t.afa + d.afa }), { baseline: 0, afa: 0 });
  const restTotals = rest.reduce((t, d) => ({ baseline: t.baseline + d.baseline, afa: t.afa + d.afa }), { baseline: 0, afa: 0 });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm bg-[#c9d8ee]" /> Approved Baseline Budget
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm bg-[#eb6834]" /> Anticipated Final Account
        </span>
        <span className="ml-auto">
          Total AFA <b className="tnum text-ink">{whole(totals.afa)}</b> vs budget <b className="tnum text-ink">{whole(totals.baseline)}</b>
        </span>
      </div>
      <ul className="space-y-1.5">
        {shown.map((d) => (
          <Row key={d.package} name={d.package} baseline={d.baseline} afa={d.afa} max={max} compact={compact} />
        ))}
        {!all && rest.length > 0 && <Row name={`${rest.length} smaller package${rest.length === 1 ? "" : "s"}`} baseline={restTotals.baseline} afa={restTotals.afa} max={max} muted compact={compact} />}
      </ul>
      {sorted.length > initial && (
        <button type="button" className="mt-3 text-xs font-medium text-accent hover:underline" onClick={() => setAll(!all)}>
          {all ? `Show the ${initial} largest only` : `Show all ${sorted.length} packages`}
        </button>
      )}
    </div>
  );
}

function Row({ name, baseline, afa, max, muted, compact }: { name: string; baseline: number; afa: number; max: number; muted?: boolean; compact?: boolean }) {
  const variance = Math.round((afa - baseline) * 100) / 100;
  const pct = baseline ? Math.round((variance / baseline) * 1000) / 10 : null;
  const tone = variance > 0.004 ? "bg-red-50 text-red-700 ring-red-200" : variance < -0.004 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200";
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <li className={`grid items-center gap-3 ${compact ? "grid-cols-[minmax(0,9rem)_minmax(4rem,1fr)_auto] sm:grid-cols-[minmax(0,12rem)_minmax(5rem,1fr)_auto]" : "grid-cols-[minmax(0,11rem)_minmax(4rem,1fr)_auto] sm:grid-cols-[minmax(0,15rem)_minmax(6rem,1fr)_auto]"} ${muted ? "text-muted" : ""}`} title={`${name}\nBaseline ${formatMoney(baseline)}\nAnticipated final account ${formatMoney(afa)}`}>
      <span className={`truncate text-xs ${muted ? "italic" : "font-medium text-ink"}`}>{name}</span>
      <span className="relative h-4 overflow-hidden rounded bg-slate-100">
        <span className="absolute inset-y-0 left-0 rounded bg-[#c9d8ee]" style={{ width: w(baseline) }} />
        <span className="absolute inset-y-1 left-0 rounded bg-[#eb6834]" style={{ width: w(afa) }} />
      </span>
      <span className="flex items-center justify-end gap-2 whitespace-nowrap text-xs">
        {!compact && <span className="tnum hidden w-24 text-right text-ink sm:inline">{whole(afa)}</span>}
        <span className={`tnum inline-flex min-w-[5rem] justify-end rounded-full px-2 py-0.5 ring-1 ${tone}`}>
          {variance > 0 ? "+" : ""}
          {whole(variance)}
          {pct !== null && !compact && <span className="ml-1 opacity-70">({pct > 0 ? "+" : ""}{pct}%)</span>}
        </span>
      </span>
    </li>
  );
}
