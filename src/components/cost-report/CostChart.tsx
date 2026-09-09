"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";

/** Grouped bar chart: Approved Baseline Budget vs Anticipated Final Account, by package. */
const SERIES = [
  { key: "baseline", label: "Approved Baseline Budget", color: "#2a78d6" },
  { key: "afa", label: "Anticipated Final Account", color: "#eb6834" },
] as const;

export function CostChart({ data }: { data: { package: string; baseline: number; afa: number }[] }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  if (!data.length) return <p className="py-8 text-center text-sm text-muted">Add cost lines to see the chart.</p>;

  const width = Math.max(560, data.length * 96 + 80);
  const height = 280;
  const pad = { top: 16, right: 16, bottom: 56, left: 64 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.flatMap((d) => [d.baseline, d.afa]));
  const niceMax = niceCeil(max);
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => t * niceMax);
  const band = plotW / data.length;
  const barW = Math.min(24, (band - 16) / 2 - 1);
  const y = (v: number) => pad.top + plotH - (v / niceMax) * plotH;

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Baseline budget vs anticipated final account by package">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="#e2e6ee" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#5b6577">
                {compact(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = pad.left + band * i + band / 2;
            return (
              <g key={d.package} onMouseEnter={(e) => setHover({ i, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHover(null)}>
                <rect x={pad.left + band * i} y={pad.top} width={band} height={plotH} fill={hover?.i === i ? "#f3f5f9" : "transparent"} />
                {SERIES.map((s, si) => {
                  const v = d[s.key];
                  const x = cx - barW - 1 + si * (barW + 2);
                  const top = y(v);
                  const h = Math.max(0, pad.top + plotH - top);
                  return <path key={s.key} d={roundedBar(x, top, barW, h)} fill={s.color} />;
                })}
                <text x={cx} y={height - pad.bottom + 16} textAnchor="middle" fontSize={11} fill="#172033">
                  {truncate(d.package, 14)}
                </text>
              </g>
            );
          })}
          <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="#c9cfda" strokeWidth={1} />
        </svg>
      </div>
      {hover && (
        <div className="pointer-events-none fixed z-50 rounded-md border border-line bg-white px-3 py-2 text-xs shadow-lg" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <div className="mb-1 font-semibold text-ink">{data[hover.i].package}</div>
          {SERIES.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-muted">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
              {s.label}: <span className="tnum text-ink">{formatMoney(data[hover.i][s.key])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function roundedBar(x: number, top: number, w: number, h: number) {
  const r = Math.min(4, h, w / 2);
  if (h <= 0) return "";
  return `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${top + h} Z`;
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
function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
