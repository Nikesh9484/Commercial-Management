"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";

export interface SeverityRow {
  bucket: string;
  n: number;
  value: number;
}

/** The four reserved status steps (good -> warning -> serious -> critical), used only for genuine
 * ordinal severity (ageing buckets), never for unrelated categories. Values are always shown as direct
 * labels, so the colour is never the only carrier of meaning. */
const STEPS = ["#0ca30c", "#fab219", "#ec835a", "#d03b3b"];

/** Ageing / severity bar chart: exactly the buckets given, in order, coloured from good to critical. */
export function SeverityBars({ rows, valueLabel = "SAR" }: { rows: SeverityRow[]; valueLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">No data yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const w = r.value > 0 ? Math.max(2, (r.value / max) * 100) : 0;
        const color = STEPS[Math.min(i, STEPS.length - 1)];
        return (
          <div key={r.bucket} className="group relative flex items-center gap-2 text-xs" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}>
            <div className="w-32 shrink-0 truncate text-muted" title={r.bucket}>
              {r.bucket}
            </div>
            <div className="relative h-7 flex-1 rounded">
              <div className="absolute inset-0 rounded bg-page" />
              <div className="absolute inset-y-0 left-0 rounded transition-[width] duration-200" style={{ width: `${w}%`, background: color, opacity: hover === null || hover === i ? 1 : 0.55 }} />
              <div className="absolute inset-0 flex items-center justify-between px-2 text-[11px] font-medium tnum text-ink">
                <span>{r.n ? `${r.n}` : ""}</span>
                <span>{r.value ? formatMoney(r.value) : "–"}</span>
              </div>
            </div>
            {hover === i && (
              <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-white px-2.5 py-1.5 text-[11px] shadow-lg">
                <div className="font-semibold text-ink">{r.bucket}</div>
                <div className="tnum text-muted">
                  {r.n} item(s) · {formatMoney(r.value)} {valueLabel}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
