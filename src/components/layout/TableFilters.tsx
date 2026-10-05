"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * An Excel-style filter on every column of every table on the page (the registers carry their own, with the
 * same look, and are left alone). A funnel shows on each column heading; it lists the column's values with how
 * many rows hold each, searchable, tick to show or hide – the rows the filter leaves out are hidden, the rest
 * stay exactly as the page drew them. A table's total rows always show, and a detail row the page opens under
 * a row (one cell across the whole table) follows that row. Filters are kept while the page re-draws its rows
 * and cleared when the page changes.
 */
interface Open {
  table: HTMLTableElement;
  col: number;
  top: number;
  left: number;
}

const FUNNEL = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
const filters = new WeakMap<HTMLTableElement, Map<number, Set<string>>>();

/** the column each cell of a row sits in (cells spanning several columns counted) */
function cellAt(row: HTMLTableRowElement, col: number): HTMLTableCellElement | null {
  let at = 0;
  for (const c of Array.from(row.cells)) {
    const span = Math.max(1, c.colSpan || 1);
    if (col >= at && col < at + span) return c;
    at += span;
  }
  return null;
}

const text = (c: HTMLTableCellElement | null) => (c ? (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim() : "");

function bodyRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.tBodies).flatMap((b) => Array.from(b.rows));
}

/** a row the filter leaves alone: a total, or a detail row spanning the whole table */
function isTotal(row: HTMLTableRowElement): boolean {
  const first = text(row.cells[0] ?? null).toLowerCase();
  return /^(grand )?total\b|^sub-?total\b/.test(first);
}
function isDetail(row: HTMLTableRowElement, width: number): boolean {
  return row.cells.length === 1 && (row.cells[0].colSpan || 1) >= Math.max(2, width - 1);
}

function headerRow(table: HTMLTableElement): HTMLTableRowElement | null {
  const head = table.tHead;
  if (!head || !head.rows.length) return null;
  return head.rows[head.rows.length - 1];
}

function widthOf(table: HTMLTableElement): number {
  const h = headerRow(table);
  return h ? Array.from(h.cells).reduce((t, c) => t + Math.max(1, c.colSpan || 1), 0) : 0;
}

function apply(table: HTMLTableElement) {
  const f = filters.get(table);
  const width = widthOf(table);
  let lastShown = true;
  for (const row of bodyRows(table)) {
    let show = true;
    if (isDetail(row, width)) show = lastShown;
    else if (!isTotal(row) && f && f.size) {
      for (const [col, keep] of f) {
        if (!keep.has(text(cellAt(row, col)))) {
          show = false;
          break;
        }
      }
    }
    if (!isDetail(row, width)) lastShown = show;
    if (show) row.removeAttribute("data-cf-hidden");
    else row.setAttribute("data-cf-hidden", "1");
  }
  // the funnels show which columns filter
  const h = headerRow(table);
  if (h)
    for (const btn of Array.from(h.querySelectorAll<HTMLButtonElement>("button[data-cf-btn]"))) {
      const on = !!f?.has(Number(btn.dataset.cfBtn));
      btn.classList.toggle("cf-on", on);
      btn.title = on ? "Filtered – click to change" : "Filter this column";
    }
}

function eligible(table: HTMLTableElement): boolean {
  if (table.closest("[data-colfilter='own'], [data-colfilter='off'], [role='dialog'], .modal")) return false;
  if (table.dataset.colfilter === "own" || table.dataset.colfilter === "off") return false;
  const h = headerRow(table);
  if (!h || h.cells.length < 2) return false;
  const width = widthOf(table);
  return bodyRows(table).filter((r) => !isDetail(r, width) && !isTotal(r)).length >= 3;
}

export function TableFilters() {
  const [open, setOpen] = useState<Open | null>(null);
  const [, bump] = useState(0);
  const openRef = useRef<Open | null>(null);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    let raf = 0;
    const scan = () => {
      const main = document.querySelector("main");
      if (!main) return;
      for (const table of Array.from(main.querySelectorAll<HTMLTableElement>("table"))) {
        if (!eligible(table)) continue;
        const h = headerRow(table)!;
        let col = 0;
        for (const th of Array.from(h.cells)) {
          const span = Math.max(1, th.colSpan || 1);
          const label = text(th);
          if (!th.querySelector("button[data-cf-btn]") && label && !th.hasAttribute("data-nocopy") && !/^actions?$/i.test(label)) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.dataset.cfBtn = String(col);
            btn.setAttribute("data-nocopy", "");
            btn.className = "cf-btn";
            btn.title = "Filter this column";
            btn.innerHTML = FUNNEL;
            btn.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              const r = btn.getBoundingClientRect();
              const cur = openRef.current;
              const c = Number(btn.dataset.cfBtn);
              if (cur && cur.table === table && cur.col === c) setOpen(null);
              else setOpen({ table, col: c, top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 300)) });
            });
            th.appendChild(btn);
          }
          col += span;
        }
        if (filters.get(table)?.size) apply(table);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(scan);
    };
    const mo = new MutationObserver((list) => {
      // the funnels this component adds do not need another pass
      if (list.every((m) => m.addedNodes.length > 0 && m.removedNodes.length === 0 && [...m.addedNodes].every((n) => n instanceof HTMLElement && n.dataset.cfBtn !== undefined))) return;
      schedule();
    });
    const main = document.querySelector("main");
    if (main) mo.observe(main, { childList: true, subtree: true });
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
    };
  }, []);

  // close on a click elsewhere, follow the funnel when the page scrolls
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest("[data-cf-pop]") && !el.closest("button[data-cf-btn]")) setOpen(null);
    };
    const place = () => {
      const btn = open.table.querySelector<HTMLButtonElement>(`button[data-cf-btn='${open.col}']`);
      if (!btn || !document.body.contains(btn)) return setOpen(null);
      const r = btn.getBoundingClientRect();
      setOpen((o) => (o ? { ...o, top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 300)) } : o));
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(<Pop open={open} onChange={() => bump((x) => x + 1)} onClose={() => setOpen(null)} />, document.body);
}

function Pop({ open, onChange, onClose }: { open: Open; onChange: () => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const { table, col } = open;
  const width = widthOf(table);
  // the values the column holds among the rows the other columns' filters leave
  const others = new Map([...(filters.get(table) ?? new Map<number, Set<string>>())].filter(([c]) => c !== col));
  const counts = new Map<string, number>();
  for (const row of bodyRows(table)) {
    if (isDetail(row, width) || isTotal(row)) continue;
    if ([...others].some(([c, keep]) => !keep.has(text(cellAt(row, c))))) continue;
    const v = text(cellAt(row, col));
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const numeric = [...counts.keys()].filter(Boolean).every((v) => /^[-–(]?[\d,.]+\)?%?$/.test(v));
  const values = [...counts.entries()]
    .map(([v, n]) => ({ v, n }))
    .sort((a, b) => (numeric ? Number(a.v.replace(/[^\d.-]/g, "")) - Number(b.v.replace(/[^\d.-]/g, "")) : a.v.localeCompare(b.v, undefined, { numeric: true })));
  const selected = filters.get(table)?.get(col);
  const shown = values.filter((x) => !q || x.v.toLowerCase().includes(q.toLowerCase()));
  const set = (next: Set<string> | undefined) => {
    const f = filters.get(table) ?? new Map<number, Set<string>>();
    if (!next || (next.size >= values.length && values.every((x) => next.has(x.v)))) f.delete(col);
    else f.set(col, next);
    filters.set(table, f);
    apply(table);
    onChange();
  };
  const toggle = (v: string) => {
    const next = new Set(selected ?? values.map((x) => x.v));
    if (next.has(v)) next.delete(v);
    else next.add(v);
    set(next);
  };
  const filtered = filters.get(table)?.size ?? 0;
  return (
    <div data-cf-pop style={{ position: "fixed", top: open.top, left: open.left }} className="z-[1000] w-72 rounded-lg border border-line bg-white p-2 text-left text-xs font-normal normal-case tracking-normal text-ink shadow-xl">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search values…" className="input h-7 w-full text-xs" />
      <div className="my-1 flex items-center gap-3 text-[11px]">
        <button type="button" className="text-accent hover:underline" onClick={() => set(undefined)}>
          Select all
        </button>
        <button type="button" className="text-accent hover:underline" onClick={() => set(new Set())}>
          Clear
        </button>
        {q && (
          <button type="button" className="text-accent hover:underline" onClick={() => set(new Set(shown.map((x) => x.v)))}>
            Only these
          </button>
        )}
        <span className="ml-auto text-muted">
          {values.length} value{values.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {shown.length === 0 && <div className="py-1 text-muted">No value matches.</div>}
        {shown.map((x) => (
          <label key={x.v} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
            <input type="checkbox" checked={!selected || selected.has(x.v)} onChange={() => toggle(x.v)} />
            <span className={`flex-1 truncate ${x.v ? "" : "italic text-muted"}`} title={x.v}>
              {x.v || "(blank)"}
            </span>
            <span className="tnum text-muted">{x.n}</span>
          </label>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between">
        {filtered > 0 ? (
          <button
            type="button"
            className="text-[11px] text-accent hover:underline"
            onClick={() => {
              filters.delete(table);
              apply(table);
              onChange();
            }}
          >
            Clear every filter on this table ({filtered})
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
