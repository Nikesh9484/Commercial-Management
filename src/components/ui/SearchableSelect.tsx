"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  /** Shown in small grey text under the label – a code, a count, a contract. */
  hint?: string;
  /** Puts the option under a heading in the list. */
  group?: string;
}

/**
 * A dropdown that can be typed into. Below a handful of choices it behaves like an ordinary one; once
 * there are more than five it grows a search box, because past that point a list is quicker to type
 * into than to read down. Used for every filter on the site so they all behave the same way.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "All",
  searchFrom = 5,
  className = "",
  disabled,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** The "nothing chosen" entry, always offered at the top. */
  placeholder?: string;
  /** Show the search box once there are more than this many options. */
  searchFrom?: number;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement | null>(null);
  const chosen = options.find((o) => o.value === value);
  const searchable = options.length > searchFrom;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const needle = q.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? options.filter((o) => `${o.label} ${o.hint ?? ""} ${o.group ?? ""}`.toLowerCase().includes(needle)) : options),
    [options, needle],
  );

  const groups = useMemo(() => {
    const out: { name: string | null; list: SelectOption[] }[] = [];
    for (const o of matches) {
      const name = o.group ?? null;
      const g = out.find((x) => x.name === name);
      if (g) g.list.push(o);
      else out.push({ name, list: [o] });
    }
    return out;
  }, [matches]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={box} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        className="input flex w-full items-center gap-1 text-left"
        disabled={disabled}
        onClick={() => {
          setQ("");
          setOpen((o) => !o);
        }}
        title={chosen?.label ?? placeholder}
      >
        <span className={`min-w-0 flex-1 truncate${chosen ? "" : " text-muted"}`}>{chosen?.label ?? placeholder}</span>
        {chosen && (
          <span
            role="button"
            tabIndex={-1}
            className="shrink-0 rounded p-0.5 text-muted hover:text-red-600"
            title="Clear"
            onClick={(e) => {
              e.stopPropagation();
              pick("");
            }}
          >
            <X size={12} />
          </span>
        )}
        <ChevronDown size={13} className="shrink-0 text-muted" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[14rem] rounded-lg border border-line bg-white shadow-lg">
          {searchable && (
            <div className="relative m-1.5">
              <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input
                autoFocus
                className="input h-7 w-full py-0 pl-6 text-xs"
                placeholder={`Search ${options.length}…`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  if (e.key === "Enter" && matches.length) pick(matches[0].value);
                }}
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto pb-1">
            {!needle && (
              <button type="button" className="block w-full px-2.5 py-1 text-left text-xs text-muted hover:bg-page" onClick={() => pick("")}>
                {placeholder}
              </button>
            )}
            {matches.length === 0 && <p className="px-2.5 py-2 text-xs text-muted">Nothing matches “{q}”.</p>}
            {groups.map((g, gi) => (
              <div key={g.name ?? `g${gi}`}>
                {g.name && <p className="bg-page px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{g.name}</p>}
                {g.list.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`flex w-full items-start gap-1.5 px-2.5 py-1 text-left text-xs hover:bg-page ${o.value === value ? "font-semibold text-navy" : "text-ink"}`}
                    onClick={() => pick(o.value)}
                  >
                    <Check size={12} className={`mt-0.5 shrink-0 ${o.value === value ? "" : "invisible"}`} />
                    <span className="min-w-0">
                      <span className="block break-words">{o.label}</span>
                      {o.hint && <span className="block text-[11px] text-muted">{o.hint}</span>}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
