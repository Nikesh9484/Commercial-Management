"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
}
export interface LinePoint {
  label: string;
  values: Record<string, number>;
}

/** Simple multi-series line chart (2 px lines, 8 px markers with a surface ring, hover crosshair + tooltip). */
export function LineChart({ series, points, ariaLabel }: { series: LineSeries[]; points: LinePoint[]; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return <p className="py-8 text-center text-sm text-muted">No data yet.</p>;
  const width = Math.max(640, points.length * 64 + 130);
  const height = 280;
  const pad = { top: 16, right: 56, bottom: 44, left: 72 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)));
  const niceMax = niceCeil(max);
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => t * niceMax);
  const x = (i: number) => pad.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (v / niceMax) * plotH;
  const band = points.length > 1 ? plotW / (points.length - 1) : plotW;
  const labelEvery = Math.ceil(points.length / 12);
  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="#e2e6ee" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#5b6577">
                {compact(t)}
              </text>
            </g>
          ))}
          {series.map((s) => (
            <path key={s.key} d={points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.values[s.key] ?? 0)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {points.map((p, i) => (
            <g key={i}>
              <rect x={x(i) - band / 2} y={pad.top} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
              {hover === i && <line x1={x(i)} x2={x(i)} y1={pad.top} y2={pad.top + plotH} stroke="#c9cfda" strokeWidth={1} />}
              {series.map((s) => (
                <circle key={s.key} cx={x(i)} cy={y(p.values[s.key] ?? 0)} r={hover === i ? 5 : 4} fill={s.color} stroke="#fff" strokeWidth={2} style={{ pointerEvents: "none" }} />
              ))}
              {i % labelEvery === 0 && (
                <text x={x(i)} y={height - pad.bottom + 18} textAnchor="middle" fontSize={11} fill="#172033">
                  {p.label}
                </text>
              )}
            </g>
          ))}
          <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="#c9cfda" strokeWidth={1} />
        </svg>
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute left-3 top-8 rounded-md border border-line bg-white px-3 py-2 text-xs shadow-lg">
          <div className="mb-1 font-semibold text-ink">{points[hover].label}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-muted">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}: <span className="tnum text-ink">{formatMoney(points[hover].values[s.key] ?? 0)}</span>
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
