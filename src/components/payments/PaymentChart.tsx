"use client";

import { useState } from "react";
import { formatMoney, formatDate } from "@/lib/format";

export interface TimelinePoint {
  date: string;
  claimed: number;
  certified: number;
  paid: number;
}

const SERIES = [
  { key: "claimed", label: "Cumulative claimed", color: "#2a78d6" },
  { key: "certified", label: "Cumulative certified", color: "#eb6834" },
  { key: "paid", label: "Cumulative paid (net, excl. VAT)", color: "#1baf7a" },
] as const;

/** Line chart of cumulative claimed vs certified vs paid over time. */
export function PaymentChart({ points }: { points: TimelinePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return <p className="py-8 text-center text-sm text-muted">Add payment applications to see the chart.</p>;

  const width = 760;
  const height = 260;
  const pad = { top: 16, right: 24, bottom: 40, left: 64 };
  // at most ~8 date labels so the chart never needs to scroll
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.flatMap((p) => [p.claimed, p.certified, p.paid]));
  const niceMax = niceCeil(max);
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => t * niceMax);
  const x = (i: number) => pad.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (v / niceMax) * plotH;
  const path = (key: (typeof SERIES)[number]["key"]) => points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p[key])}`).join(" ");

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <div>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Cumulative claimed, certified and paid over time" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="#e2e6ee" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#5b6577">
                {compact(t)}
              </text>
            </g>
          ))}
          {SERIES.map((s) => (
            <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {points.map((p, i) => (
            <g key={p.date}>
              <rect x={x(i) - (points.length > 1 ? plotW / (points.length - 1) / 2 : plotW / 2)} y={pad.top} width={points.length > 1 ? plotW / (points.length - 1) : plotW} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
              {hover === i && <line x1={x(i)} x2={x(i)} y1={pad.top} y2={pad.top + plotH} stroke="#c9cfda" strokeWidth={1} />}
              {SERIES.map((s) => (
                <circle key={s.key} cx={x(i)} cy={y(p[s.key])} r={hover === i ? 5 : points.length > 24 ? 2 : 3.5} fill={s.color} stroke="#fff" strokeWidth={hover === i ? 2 : 1} style={{ pointerEvents: "none" }} />
              ))}
              {(i % labelEvery === 0 || i === points.length - 1) && (
                <text x={x(i)} y={height - pad.bottom + 18} textAnchor="middle" fontSize={11} fill="#172033">
                  {formatDate(p.date)}
                </text>
              )}
            </g>
          ))}
          <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="#c9cfda" strokeWidth={1} />
        </svg>
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute left-3 top-8 rounded-md border border-line bg-white px-3 py-2 text-xs shadow-lg">
          <div className="mb-1 font-semibold text-ink">{formatDate(points[hover].date)}</div>
          {SERIES.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-muted">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}: <span className="tnum text-ink">{formatMoney(points[hover][s.key])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function niceCeil(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * p;
}
function compact(v: number) {
  if (v >= 1e9) return `${trim(v / 1e9)}bn`;
  if (v >= 1e6) return `${trim(v / 1e6)}M`;
  if (v >= 1e3) return `${trim(v / 1e3)}k`;
  return String(v);
}
function trim(n: number) {
  return Number(n.toFixed(2)).toString();
}
