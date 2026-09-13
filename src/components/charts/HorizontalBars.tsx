"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";

export interface BarRow {
  label: string;
  value: number;
  sublabel?: string;
  /** overrides the chart's single hue for this row only (used sparingly, e.g. to flag a shortfall red) */
  color?: string;
}

/**
 * A single-series magnitude comparison across categories: one hue, direct labels, a hover tooltip.
 * Preferred over a donut/pie for comparing more than two or three values (a bar's length is read far
 * more accurately than a wedge's angle) – see the dataviz guidance this app follows.
 */
export function HorizontalBars({ rows, valueLabel = "SAR", color = "#2a78d6", format = "money", height = 28 }: { rows: BarRow[]; valueLabel?: string; color?: string; format?: "money" | "number"; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">No data yet.</p>;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const fmt = (v: number) => (format === "money" ? formatMoney(v) : v.toLocaleString("en"));
  const labelW = 160;

  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const w = Math.max(1, (Math.abs(r.value) / max) * 100);
        return (
          <div key={r.label} className="group relative flex items-center gap-2 text-xs" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}>
            <div className="shrink-0 truncate text-muted" style={{ width: labelW }} title={r.label}>
              {r.label}
            </div>
            <div className="relative flex-1 rounded" style={{ height }}>
              <div className="absolute inset-0 rounded bg-page" />
              <div
                className="absolute inset-y-0 left-0 rounded transition-[width] duration-200"
                style={{ width: `${w}%`, background: r.color ?? color, opacity: hover === null || hover === i ? 1 : 0.55 }}
              />
              <div className="absolute inset-0 flex items-center justify-end px-2 text-[11px] font-medium tnum text-ink" style={{ mixBlendMode: w > 85 ? "normal" : undefined }}>
                {fmt(r.value)}
              </div>
            </div>
            {hover === i && (
              <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-white px-2.5 py-1.5 text-[11px] shadow-lg">
                <div className="font-semibold text-ink">{r.label}</div>
                <div className="tnum text-muted">
                  {fmt(r.value)} {valueLabel}
                </div>
                {r.sublabel && <div className="text-muted">{r.sublabel}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
