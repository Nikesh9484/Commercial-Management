"use client";

import { useState } from "react";
import type { HeatCell } from "@/lib/risks/summary";

const SEVERITY_CLASS: Record<HeatCell["severity"], string> = {
  Low: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  Medium: "bg-amber-50 text-amber-900 ring-amber-200",
  High: "bg-red-50 text-red-900 ring-red-200",
};

/** 3×3 grid: rows = probability (High at top), columns = cost impact (Low → High). */
export function HeatMap({ cells, probabilityBands, impactBands }: { cells: HeatCell[]; probabilityBands: string[]; impactBands: string[] }) {
  const [selected, setSelected] = useState<HeatCell | null>(null);
  const rows = [...probabilityBands].map((_, i) => probabilityBands.length - 1 - i);
  return (
    <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
      <div className="overflow-x-auto">
        <div className="grid" style={{ gridTemplateColumns: `auto repeat(${impactBands.length}, minmax(6.5rem, 1fr))`, gap: 2 }}>
          <div />
          {impactBands.map((b) => (
            <div key={b} className="px-2 pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
              {b} impact
            </div>
          ))}
          {rows.map((p) => (
            <RowCells key={p} p={p} label={probabilityBands[p]} cells={cells.filter((c) => c.prob === p)} selected={selected} onSelect={setSelected} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-emerald-50 ring-1 ring-inset ring-emerald-200" /> Low
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-amber-50 ring-1 ring-inset ring-amber-200" /> Medium
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-red-50 ring-1 ring-inset ring-red-200" /> High
          </span>
          <span>· R = risks, O = opportunities. Click a cell to list its items.</span>
        </div>
      </div>
      <div className="rounded-lg border border-line bg-page p-3 text-sm">
        {selected ? (
          <>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {probabilityBands[selected.prob]} probability · {impactBands[selected.impact]} impact · {selected.severity} severity
            </div>
            {selected.items.length === 0 ? (
              <p className="text-muted">No open items in this cell.</p>
            ) : (
              <ul className="space-y-1">
                {selected.items.map((it) => (
                  <li key={it.no} className="flex gap-2">
                    <span className={`shrink-0 rounded px-1.5 text-xs font-semibold ${it.type === "Opportunity" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{it.type === "Opportunity" ? "O" : "R"}</span>
                    <span className="font-medium text-ink">{it.no}</span>
                    <span className="truncate text-muted" title={it.description}>
                      {it.description}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-muted">Click a cell of the heat map to see which risks and opportunities sit in it.</p>
        )}
      </div>
    </div>
  );
}

function RowCells({ p, label, cells, selected, onSelect }: { p: number; label: string; cells: HeatCell[]; selected: HeatCell | null; onSelect: (c: HeatCell) => void }) {
  return (
    <>
      <div className="flex items-center pr-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{label} prob.</div>
      {[...cells]
        .sort((a, b) => a.impact - b.impact)
        .map((c) => {
          const active = selected?.prob === c.prob && selected?.impact === c.impact;
          return (
            <button
              key={`${p}-${c.impact}`}
              onClick={() => onSelect(c)}
              className={`flex h-16 flex-col items-center justify-center rounded-md ring-1 ring-inset transition ${SEVERITY_CLASS[c.severity]} ${active ? "outline outline-2 outline-navy" : "hover:brightness-95"}`}
              title={`${c.risks} risk(s), ${c.opportunities} opportunity(ies)`}
            >
              <span className="tnum text-lg font-semibold">{c.risks + c.opportunities}</span>
              <span className="text-[11px] opacity-80">
                R {c.risks} · O {c.opportunities}
              </span>
            </button>
          );
        })}
    </>
  );
}
