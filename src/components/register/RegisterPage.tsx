"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useScopeKey } from "@/components/layout/ScopeContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Search, Download, Upload, Pencil, Trash2, History, RotateCcw, EyeOff, ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight, RefreshCw, Lock, Unlock, Filter, X, ExternalLink, Columns3, Copy, ClipboardPaste, Paperclip, FolderUp, Loader2 } from "lucide-react";
import { tableClipboard, writeClipboard } from "@/lib/copy-rows";
import { PasteDialog } from "./PasteDialog";
import type { FieldDef, LookupOption, RecordRow, RegisterDef } from "@/lib/registers/types";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { RecordForm, type FormValues } from "./RecordForm";
import { RecordHistory } from "./HistoryPanel";
import { ImportDialog } from "./ImportDialog";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ChangePackButtons } from "@/components/changes/ChangePackButtons";
import { uploadBondDocuments } from "@/lib/bonds/upload-client";
import { filesFromDataTransfer, hasFiles } from "@/lib/dnd-client";

const PAGE_SIZE = 50;

async function fetchRegister(registerKey: string): Promise<Loaded> {
  const res = await fetch(`/api/registers/${registerKey}`, { cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "Could not load this register.");
  return j as Loaded;
}

interface Loaded {
  def: RegisterDef;
  rows: RecordRow[];
  lookups: Record<string, LookupOption[]>;
  canEdit: boolean;
  /** May add rows (editors, admins and "data entry" users). */
  canCreate?: boolean;
  /** May delete rows (admins and editors); when missing, everyone who may edit may delete. */
  canDelete?: boolean;
  readOnlyReason?: string | null;
  scopeDefaults?: Record<string, number>;
}

export function RegisterPage({
  registerKey,
  isAdmin = false,
  fixedFilter,
  rowFilter,
  exportParams,
  hideFields = [],
  onRows,
  hideFilterPanel = false,
}: {
  registerKey: string;
  isAdmin?: boolean;
  /** Only show rows matching these values (scalar = equals, and new records get it by default; { in } / { notIn } = set filters). */
  fixedFilter?: Record<string, number | string | { in?: (number | string)[]; notIn?: (number | string)[] }>;
  /** Only show rows this returns true for – for filters the page owns (see the Bonds & Insurance page). */
  rowFilter?: (row: RecordRow) => boolean;
  /** Query string added to the table's own Export, so it downloads the same rows the page filter shows. */
  exportParams?: string;
  /** Fields to leave out of the table (e.g. the one fixed by fixedFilter). */
  hideFields?: string[];
  /** Hands the loaded rows to a page that filters them itself, so it counts from the same data the
   *  table shows – and again after every save, so its counts never go stale. */
  onRows?: (rows: RecordRow[]) => void;
  /** Leave out the generic Filters button and panel when the page provides its own filters. */
  hideFilterPanel?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  // the project / asset / report in the top bar: the rows are fetched again whenever it changes
  const scopeKey = useScopeKey();
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // a link into the register can name what to search for (…/modules/change-management?q=CH-006C58-7)
  useEffect(() => {
    let q: string | null = null;
    try {
      q = new URLSearchParams(window.location.search).get("q");
    } catch {
      q = null;
    }
    if (!q) return;
    const t = setTimeout(() => setSearch(q!), 0);
    return () => clearTimeout(t);
  }, []);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ row: RecordRow | null; values: FormValues } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyFor, setHistoryFor] = useState<RecordRow | null>(null);
  // documents dropped on (or picked for) one bond / insurance row: kept with that entry
  const [dropRow, setDropRow] = useState<number | null>(null);
  const [uploadingRow, setUploadingRow] = useState<number | null>(null);
  const pickFor = useRef<number | null>(null);
  const rowFilesRef = useRef<HTMLInputElement>(null);
  const rowFolderRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<RecordRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // which columns the person keeps on this register's table (remembered in this browser); none set = the register's own choice
  const [showColumns, setShowColumns] = useState(false);
  const storedCols = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener("columns-changed", onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener("columns-changed", onChange);
      };
    },
    () => {
      try {
        return localStorage.getItem(`columns:${registerKey}`);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const hiddenCols = useMemo<Set<string> | null>(() => {
    try {
      return storedCols ? new Set(JSON.parse(storedCols) as string[]) : null;
    } catch {
      return null;
    }
  }, [storedCols]);
  // column widths dragged on the header, remembered in this browser per register
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [closedLists, setClosedLists] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  /** The row last clicked: Ctrl+C copies it, Ctrl+V pastes next to it. */
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; row: RecordRow } | null>(null);
  /** Where pasted rows go: the reference of the row they should follow (they sort right after it as "… (copy)"). */
  const [pasteAfter, setPasteAfter] = useState<{ ref: string; where: string } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`colwidths:${registerKey}`);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setColWidths(raw ? (JSON.parse(raw) as Record<string, number>) : {});
    } catch {
      /* no storage: the register's own widths */
    }
  }, [registerKey]);
  const rememberWidths = (next: Record<string, number>) => {
    setColWidths(next);
    try {
      if (Object.keys(next).length) localStorage.setItem(`colwidths:${registerKey}`, JSON.stringify(next));
      else localStorage.removeItem(`colwidths:${registerKey}`);
    } catch {
      /* ignore */
    }
  };
  const startResize = (key: string) => (e: React.MouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.parentElement as HTMLElement | null;
    const startX = e.clientX;
    const startW = th?.getBoundingClientRect().width ?? 120;
    let latest = colWidths;
    const move = (ev: MouseEvent) => {
      const w = Math.max(48, Math.round(startW + ev.clientX - startX));
      latest = { ...colWidths, [key]: w };
      setColWidths(latest);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      rememberWidths(latest);
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const widthStyle = (f: FieldDef): React.CSSProperties | undefined => {
    const w = colWidths[f.key];
    if (w) return { width: w, minWidth: w, maxWidth: w };
    return f.width ? { width: f.width, minWidth: f.width } : undefined;
  };
  const rememberCols = (next: Set<string> | null) => {
    try {
      if (next) localStorage.setItem(`columns:${registerKey}`, JSON.stringify([...next]));
      else localStorage.removeItem(`columns:${registerKey}`);
      window.dispatchEvent(new Event("columns-changed"));
    } catch {
      /* a browser without storage keeps the register's own columns */
    }
  };

  const attachToRow = useCallback(
    async (bondId: number, files: File[]) => {
      if (!files.length) return;
      setUploadingRow(bondId);
      try {
        if (files.length > 1) toast(`Uploading ${files.length} files…`);
        const names = await uploadBondDocuments(bondId, files);
        toast(`${names.length} document${names.length === 1 ? "" : "s"} kept with the entry – open ${names.length === 1 ? "it" : "them"} from the Documents column.`);
        const loaded = await fetchRegister(registerKey);
        setData(loaded);
        onRows?.(loaded.rows);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Something went wrong.", "error");
      } finally {
        setUploadingRow(null);
      }
    },
    [registerKey, onRows, toast],
  );
  const rowIdAt = (t: EventTarget | null) => {
    const tr = (t as Element | null)?.closest?.("tr[data-row-id]");
    return tr ? Number(tr.getAttribute("data-row-id")) : null;
  };
  const pickedForRow = (e: React.ChangeEvent<HTMLInputElement>) => {
    const id = pickFor.current;
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (id && files.length) void attachToRow(id, files);
  };

  const load = useCallback(() => {
    return fetchRegister(registerKey).then(
      (loaded) => {
        setData(loaded);
        onRows?.(loaded.rows);
      },
      (e: Error) => setLoadError(e.message),
    );
  }, [registerKey, onRows]);

  useEffect(() => {
    void scopeKey; // a project, asset or report switch in the top bar fetches the rows again
    let live = true;
    fetchRegister(registerKey).then(
      (loaded) => {
        if (!live) return;
        setData(loaded);
        onRows?.(loaded.rows);
      },
      (e: Error) => live && setLoadError(e.message),
    );
    return () => {
      live = false;
    };
  }, [registerKey, onRows, scopeKey]);

  const def = data?.def;
  // every column the table can show, before the person's own choice
  const allTableFields = useMemo(() => def?.fields.filter((f) => !["programme_id", "contract_closed"].includes(f.key) && f.type !== "password" && !f.hideInForm && !hideFields.includes(f.key)) ?? [], [def, hideFields]);
  const tableFields = useMemo(() => {
    // a wide tracker shows every column of the record (scrolled sideways); the others keep their compact set;
    // a person's own choice of columns (the Columns button) stands over both
    const shown = def?.fields.filter((f) => (hiddenCols ? !hiddenCols.has(f.key) && !["programme_id", "contract_closed"].includes(f.key) && !f.hideInForm : def.wideTable ? !["programme_id", "contract_closed"].includes(f.key) : !f.hideInTable) && f.type !== "password" && !hideFields.includes(f.key)) ?? [];
    // a field can ask for its place in the table without moving on the record form
    return shown
      .map((f, i) => ({ f, i }))
      .sort((a, b) => (a.f.tableOrder ?? Number.MAX_SAFE_INTEGER) - (b.f.tableOrder ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
      .map((x) => x.f);
  }, [def, hideFields, hiddenCols]);
  const filterFields = useMemo(() => {
    if (!def) return [];
    const explicit = def.fields.filter((f) => f.filter && !(fixedFilter && f.key in fixedFilter));
    if (explicit.length) return explicit.filter((f) => f.type === "select" || f.type === "lookup" || f.type === "boolean");
    return def.fields.filter((f) => (f.type === "select" || f.type === "lookup" || f.type === "boolean") && !(fixedFilter && f.key in fixedFilter));
  }, [def, fixedFilter]);
  const effectiveSort = sort ?? def?.defaultSort ?? null;

  const visible = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    let rows = data.rows;
    if (fixedFilter) {
      rows = rows.filter((r) =>
        Object.entries(fixedFilter).every(([k, v]) => {
          const cell = String(r[k] ?? "");
          if (typeof v === "object" && v !== null) {
            if (v.in && !v.in.map(String).includes(cell)) return false;
            if (v.notIn && v.notIn.map(String).includes(cell)) return false;
            return true;
          }
          return cell === String(v);
        }),
      );
    }
    if (rowFilter) rows = rows.filter(rowFilter);
    if (q) {
      rows = rows.filter((r) => data.def.fields.some((f) => String(displayValue(f, r) ?? "").toLowerCase().includes(q)) || String(r.id) === q);
    }
    for (const [key, val] of Object.entries(filters)) {
      if (val === "") continue;
      rows = rows.filter((r) => {
        const f = data.def.fields.find((x) => x.key === key)!;
        if (f.type === "boolean") return (r[key] === true ? "Yes" : r[key] === false ? "No" : "") === val;
        if (f.type === "lookup") return String(r[key] ?? "") === val;
        return String(r[key] ?? "") === val;
      });
    }
    if (effectiveSort) {
      const f = data.def.fields.find((x) => x.key === effectiveSort.field);
      const dir = effectiveSort.dir === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = f ? sortValue(f, a) : a[effectiveSort.field];
        const bv = f ? sortValue(f, b) : b[effectiveSort.field];
        if (av === null || av === undefined || av === "") return 1;
        if (bv === null || bv === undefined || bv === "") return -1;
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
      });
    }
    return rows;
  }, [data, search, filters, effectiveSort, fixedFilter, rowFilter]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function toggleSort(field: string) {
    setPage(1);
    setSort((s) => (s?.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" }));
  }
  function changeSearch(value: string) {
    setPage(1);
    setSearch(value);
  }
  function changeFilter(key: string, value: string) {
    setPage(1);
    setFilters((x) => ({ ...x, [key]: value }));
  }

  function openNew() {
    if (!def) return;
    const values: FormValues = {};
    for (const f of def.fields) if (f.defaultValue !== undefined) values[f.key] = f.defaultValue as FormValues[string];
    for (const [k, v] of Object.entries(data?.scopeDefaults ?? {})) values[k] = v;
    for (const [k, v] of Object.entries(fixedFilter ?? {})) if (typeof v !== "object") values[k] = v;
    setFormErrors({});
    setFormError(null);
    setEditing({ row: null, values });
  }

  function openEdit(row: RecordRow) {
    if (!def) return;
    const values: FormValues = {};
    for (const f of def.fields) {
      if (f.type === "password") continue;
      values[f.key] = (row[f.key] as FormValues[string]) ?? null;
    }
    setFormErrors({});
    setFormError(null);
    setEditing({ row, values });
  }

  async function save() {
    if (!editing || !def) return;
    setSaving(true);
    setFormErrors({});
    setFormError(null);
    const body: Record<string, unknown> = {};
    for (const f of def.fields) {
      if (f.hideInForm || f.readonly) continue;
      const v = editing.values[f.key];
      if (f.type === "password" && (v === null || v === undefined || v === "")) continue;
      body[f.key] = v === undefined ? null : v;
    }
    const url = editing.row ? `/api/registers/${registerKey}/${editing.row.id}` : `/api/registers/${registerKey}`;
    const res = await fetch(url, { method: editing.row ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setFormErrors(j.fieldErrors ?? {});
      setFormError(j.error ?? "Could not save.");
      return;
    }
    toast(editing.row ? `${def.singular} updated.` : `${def.singular} added.`);
    setEditing(null);
    await load();
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting || !def) return;
    const res = await fetch(`/api/registers/${registerKey}/${deleting.id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(j.error ?? "Could not delete.", "error");
      setDeleting(null);
      return;
    }
    toast(`${def.singular} deleted.`);
    setDeleting(null);
    await load();
    router.refresh();
  }

  // an entry goes back to how it stood in the last issued report; one added since is removed
  async function resetRow(row: RecordRow) {
    if (!def) return;
    const name = String(row[def.displayField] ?? `#${row.id}`);
    const pre = await fetch(`/api/registers/${registerKey}/${row.id}/reset`).then((r) => r.json().catch(() => ({})));
    if (pre.error) return toast(pre.error, "error");
    if (pre.action === "none") return toast(pre.why);
    if (!pre.canApply) return toast(pre.why, "error");
    const lines = pre.action === "remove" ? [pre.why] : [pre.why, "", ...pre.changes.map((c: { label: string; from: string; to: string }) => `${c.label}: ${c.from} → ${c.to}`), ...(pre.skipped?.length ? ["", `Cannot be taken back: ${pre.skipped.join(", ")}`] : [])];
    if (!window.confirm(`Reset ${def.singular} ${name} to ${pre.report}?

${lines.join("\n")}`)) return;
    const res = await fetch(`/api/registers/${registerKey}/${row.id}/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error ?? "Could not reset.", "error");
    toast(j.action === "remove" ? `${def.singular} ${name} removed – it was added after ${j.report}.` : `${def.singular} ${name} reset to ${j.report}.`);
    await load();
    router.refresh();
  }

  async function periodAction(row: RecordRow, action: "lock" | "unlock") {
    let res = await fetch(`/api/periods/${row.id}/${action}`, { method: "POST" });
    let j = await res.json().catch(() => ({}));
    if (!res.ok && j.fieldErrors?.force === "confirm" && window.confirm(`${j.error}\n\nLock anyway?`)) {
      res = await fetch(`/api/periods/${row.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
      j = await res.json().catch(() => ({}));
    }
    if (!res.ok) return toast(j.error ?? "Action failed.", "error");
    toast(action === "lock" ? `Period locked. Snapshot stored (${j.records ?? 0} record(s)).` : "Period unlocked.");
    await load();
    router.refresh();
  }

  const canPaste = !!data && (data.canEdit || data.canCreate);
  const refOf = useCallback((r: RecordRow | undefined | null) => (r && def ? String(r[def.displayField] ?? "").trim() : ""), [def]);
  /** The paste position for "above" / "below" a row: the reference the new rows should follow. */
  const anchorFor = useCallback(
    (row: RecordRow, where: "above" | "below"): { ref: string; where: string } | null => {
      if (!def) return null;
      const field = def.fields.find((f) => f.key === def.displayField);
      if (!field?.unique || (field.type !== "text" && field.type !== "textarea")) return null;
      if (where === "below") return { ref: refOf(row), where: `below ${refOf(row)}` };
      const i = visible.findIndex((x) => x.id === row.id);
      const prev = i > 0 ? visible[i - 1] : null;
      return prev ? { ref: refOf(prev), where: `above ${refOf(row)}` } : { ref: refOf(row), where: `next to ${refOf(row)}` };
    },
    [def, visible, refOf],
  );
  const pasteRowsOpen = (text: string, anchor: { ref: string; where: string } | null) => {
    setPasteAfter(anchor);
    setPasteText(text);
    setPasteOpen(true);
  };
  // Ctrl+V anywhere on the page (outside a box) with rows on the clipboard opens the paste window with them,
  // placed above the row last clicked; Ctrl+C with a row clicked (and no text selected) copies that row
  useEffect(() => {
    if (!data) return;
    const inBox = (t: HTMLElement | null) => !!t && !!t.closest("input, textarea, select, [contenteditable=true]");
    const onPaste = (e: ClipboardEvent) => {
      if (!canPaste) return;
      if (inBox(e.target as HTMLElement | null) || document.querySelector("[role=dialog]")) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!/\t/.test(text) || !/\n/.test(text.trim())) return;
      e.preventDefault();
      const row = focusedId !== null ? visible.find((x) => Number(x.id) === focusedId) : undefined;
      pasteRowsOpen(text, row ? anchorFor(row, "above") : null);
    };
    const onCopy = (e: ClipboardEvent) => {
      if (inBox(e.target as HTMLElement | null) || document.querySelector("[role=dialog]")) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return; // text selected: the page-wide table copy handles it
      const rows = selected.size ? visible.filter((r) => selected.has(Number(r.id))) : focusedId !== null ? visible.filter((r) => Number(r.id) === focusedId) : [];
      if (!rows.length) return;
      const { text, html } = tableClipboard(
        tableFields.map((f) => f.label),
        rows.map((r) => tableFields.map((f) => displayValue(f, r))),
      );
      e.clipboardData?.setData("text/plain", text);
      e.clipboardData?.setData("text/html", html);
      e.preventDefault();
      toast(`${rows.length === 1 ? "Row" : `${rows.length} rows`} copied – click a row and press Ctrl+V to paste above it.`);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    const onClick = () => setMenu(null);
    document.addEventListener("paste", onPaste);
    document.addEventListener("copy", onCopy);
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast is stable; the rest are the inputs
  }, [data, canPaste, focusedId, selected, visible, tableFields, anchorFor]);
  /** Opens the right-click menu for a row. */
  const rowMenu = (r: RecordRow) => (e: React.MouseEvent) => {
    e.preventDefault();
    setFocusedId(Number(r.id));
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 220), row: r });
  };
  /** Pastes from the clipboard next to a row (from the menu); when the browser will not hand the clipboard over, the paste window opens for Ctrl+V. */
  const pasteFromMenu = async (row: RecordRow, where: "above" | "below") => {
    const anchor = anchorFor(row, where);
    let text = "";
    try {
      text = (await navigator.clipboard.readText()) ?? "";
    } catch {
      text = "";
    }
    pasteRowsOpen(/\t/.test(text) ? text : "", anchor);
  };

  if (loadError) return <div className="card p-6 text-sm text-red-700">{loadError}</div>;
  const rowUploads = registerKey === "bonds" && !!data?.canEdit;
  if (!data || !def) return <div className="card p-6 text-sm text-muted">Loading…</div>;

  /** Copies rows as cells (tab-separated text + an HTML table) in the columns shown on the table. */
  async function copyRows(rows: RecordRow[], what: string) {
    if (!def) return;
    const { text, html } = tableClipboard(
      tableFields.map((f) => f.label),
      rows.map((r) => tableFields.map((f) => displayValue(f, r))),
    );
    const ok = await writeClipboard(text, html);
    toast(ok ? `${what} copied – paste into Excel, an email, or any tracker's Paste rows.` : "The browser did not allow copying – select the rows and press Ctrl+C instead.");
  }
  const toggleSelected = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const activeFilterCount = Object.values(filters).filter((v) => v !== "").length;
  const isPeriods = registerKey === "reporting_periods";

  return (
    <div className="space-y-3">
      {data.readOnlyReason && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <Lock size={14} /> {data.readOnlyReason}
        </div>
      )}
      {/* Toolbar */}
      <div className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder={`Search ${def.title.toLowerCase()}…`} value={search} onChange={(e) => changeSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {!hideFilterPanel && filterFields.length > 0 && (
            <button className={`btn btn-secondary ${activeFilterCount ? "border-accent text-accent" : ""}`} onClick={() => setShowFilters((s) => !s)}>
              <Filter size={16} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </button>
          )}
          <button className={`btn btn-secondary ${hiddenCols ? "border-accent text-accent" : ""}`} onClick={() => setShowColumns((s) => !s)} title="Choose which columns to keep on the table">
            <Columns3 size={16} /> Columns
          </button>
          <button className="btn btn-secondary" onClick={load} title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button
            className={`btn btn-secondary ${selected.size ? "border-accent text-accent" : ""}`}
            onClick={() => {
              const chosen = selected.size ? visible.filter((r) => selected.has(Number(r.id))) : visible;
              void copyRows(chosen, selected.size ? `${selected.size} selected row(s)` : `${visible.length} row(s)`);
            }}
            disabled={visible.length === 0}
            title={selected.size ? "Copy the ticked rows as cells – paste into Excel, an email or another tracker" : "Copy every row on this table (as filtered) as cells – tick rows to copy only some"}
          >
            <Copy size={16} /> Copy{selected.size ? ` (${selected.size})` : ""}
          </button>
          {canPaste && (
            <button className="btn btn-secondary" onClick={() => { setPasteText(""); setPasteOpen(true); }} title="Add rows copied from another tracker or from Excel (or just press Ctrl+V on this page)">
              <ClipboardPaste size={16} /> Paste rows
            </button>
          )}
          <a className="btn btn-secondary" href={`/api/registers/${registerKey}/export${exportParams ? `?${exportParams}` : ""}`} title={exportParams ? "Download this table as Excel, with the page's filter applied" : "Download this table as Excel"}>
            <Download size={16} /> Export
          </a>
          {data.canEdit && (
            <button className="btn btn-secondary" onClick={() => setImportOpen(true)}>
              <Upload size={16} /> Import
            </button>
          )}
          {(data.canEdit || data.canCreate) && (
            <button className="btn btn-primary" onClick={openNew}>
              <Plus size={16} /> Add {def.singular}
            </button>
          )}
        </div>
      </div>

      {showColumns && (
        <div className="card p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-ink">Columns on the table <span className="font-normal text-muted">– tick to keep, untick to hide; remembered on this computer</span></div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-sm btn-secondary" onClick={() => rememberCols(new Set())}>Show all</button>
              <button className="btn btn-sm btn-secondary" onClick={() => rememberCols(new Set(allTableFields.filter((f) => f.hideInTable).map((f) => f.key)))}>Compact</button>
              <button className="btn btn-sm btn-ghost" onClick={() => rememberCols(null)}>Reset</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowColumns(false)} aria-label="Close"><X size={14} /></button>
            </div>
          </div>
          {Object.entries(allTableFields.reduce<Record<string, FieldDef[]>>((g, f) => ((g[f.section ?? "General"] ??= []).push(f), g), {})).map(([section, fields]) => (
            <div key={section} className="mb-2">
              <div className={`mb-1 rounded px-1 text-[11px] font-semibold uppercase tracking-wide text-muted ${stageTint(registerKey, fields[0]?.key ?? "").th}`}>{section}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {fields.map((f) => {
                  const on = tableFields.some((x) => x.key === f.key);
                  return (
                    <label key={f.key} className="inline-flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => {
                          const next = new Set(hiddenCols ?? allTableFields.filter((x) => !tableFields.some((t) => t.key === x.key)).map((x) => x.key));
                          if (e.target.checked) next.delete(f.key);
                          else next.add(f.key);
                          rememberCols(next);
                        }}
                      />
                      {f.label}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {!hideFilterPanel && showFilters && filterFields.length > 0 && (
        <div className="card flex flex-wrap items-end gap-3 p-3">
          {filterFields.map((f) => (
            <div key={f.key} className="flex min-w-48 flex-col gap-1 text-xs text-muted">
              {f.label}
              <SearchableSelect
                value={filters[f.key] ?? ""}
                onChange={(v) => changeFilter(f.key, v)}
                options={
                  f.type === "boolean"
                    ? [
                        { value: "Yes", label: "Yes" },
                        { value: "No", label: "No" },
                      ]
                    : f.type === "select"
                      ? (f.options ?? []).map((o) => ({ value: o, label: o }))
                      : (data.lookups[f.key] ?? []).map((o) => ({ value: String(o.id), label: o.label }))
                }
              />
            </div>
          ))}
          {activeFilterCount > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setFilters({})}>
              <X size={14} /> Clear
            </button>
          )}
        </div>
      )}

      {/* Quick catch: the open items at each stage, in the same columns as the table below */}
      {registerKey === "changes" &&
        QUICK_LISTS.map((q) => {
          const rows = visible.filter((r) => r.is_closed !== true && q.stages.includes(String(r.current_stage ?? "")));
          const open = !closedLists.has(q.key);
          return (
            <div key={q.key} className={`card overflow-hidden border-l-4 ${q.border}`}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-black/[0.02]"
                onClick={() => setClosedLists((prev) => { const next = new Set(prev); if (next.has(q.key)) next.delete(q.key); else next.add(q.key); return next; })}
                title={open ? "Collapse this list" : "Expand this list"}
              >
                {open ? <ChevronDown size={15} className="text-muted" /> : <ChevronRight size={15} className="text-muted" />}
                <span className="text-sm font-semibold text-ink">{q.title}</span>
                <Chip tone={rows.length ? q.tone : "grey"}>{rows.length}</Chip>
                <span className="text-xs text-muted">{q.hint}</span>
              </button>
              {open && rows.length > 0 && (
                <div className="max-h-[40vh] overflow-auto border-t border-line">
                  <table className="data compact w-full">
                    <thead>
                      <tr>
                        {tableFields.map((f) => (
                          <th key={f.key} style={widthStyle(f)} className={`${isNumeric(f) ? "text-right" : ""} ${stageTint(registerKey, f.key).th}`}>
                            <span className={colWidths[f.key] ? "block truncate" : ""}>{f.label}</span>
                          </th>
                        ))}
                        <th className="text-right" data-nocopy>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} onClick={() => setFocusedId(Number(r.id))} onContextMenu={rowMenu(r)} onDoubleClick={() => data.canEdit && openEdit(r)} className={focusedId === Number(r.id) ? "outline outline-2 -outline-offset-2 outline-accent/60" : ""}>
                          {tableFields.map((f) => (
                            <td key={f.key} style={colWidths[f.key] ? widthStyle(f) : undefined} className={`${isNumeric(f) ? "tnum text-right" : ""} ${colWidths[f.key] ? "overflow-hidden text-ellipsis whitespace-nowrap" : ""} ${stageTint(registerKey, f.key).td}`} title={f.type === "textarea" || colWidths[f.key] ? String(r[f.key] ?? "") : undefined}>
                              <Cell field={f} row={r} />
                            </td>
                          ))}
                          <td className="text-right" data-nocopy>
                            <div className="inline-flex items-center gap-0.5">
                              {data.canEdit && <ChangePackButtons changeId={Number(r.id)} stage={String(r.current_stage ?? "")} />}
                              <button className="btn btn-ghost btn-sm" onClick={() => void copyRows([r], "Row")} title="Copy this row as cells">
                                <Copy size={15} />
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={() => setHistoryFor(r)} title="Change history">
                                <History size={15} />
                              </button>
                              {data.canEdit && (
                                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)} title="Edit">
                                  <Pencil size={15} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {open && rows.length === 0 && <div className="border-t border-line px-4 py-2 text-xs text-muted">Nothing open at this stage{Object.values(filters).some((v) => v !== "") || search.trim() ? " within the current search / filters" : ""}.</div>}
            </div>
          );
        })}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="max-h-[70vh] overflow-auto">
          {rowUploads && (
            <>
              <input ref={rowFilesRef} type="file" multiple className="hidden" onChange={pickedForRow} />
              <input ref={rowFolderRef} type="file" multiple className="hidden" onChange={pickedForRow} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
            </>
          )}
          <table className="data w-full">
            <thead>
              <tr>
                <th className="w-8 pr-0" data-nocopy title="Tick rows to copy only those">
                  <input
                    type="checkbox"
                    aria-label="Select every row on this page"
                    checked={pageRows.length > 0 && pageRows.every((r) => selected.has(Number(r.id)))}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const r of pageRows) if (e.target.checked) next.add(Number(r.id)); else next.delete(Number(r.id));
                        return next;
                      })
                    }
                  />
                </th>
                {data.canEdit && <th className="w-9" title="Edit" data-nocopy />}
                {tableFields.map((f) => (
                  <th key={f.key} style={widthStyle(f)} className={`group relative ${isNumeric(f) ? "text-right" : ""} ${stageTint(registerKey, f.key).th}`}>
                    <button className="inline-flex max-w-full items-center gap-1 font-semibold text-muted hover:text-ink" onClick={() => toggleSort(f.key)}>
                      <span className={colWidths[f.key] ? "truncate" : ""}>{f.label}</span>
                      {effectiveSort?.field === f.key ? (
                        effectiveSort.dir === "asc" ? (
                          <ChevronUp size={13} />
                        ) : (
                          <ChevronDown size={13} />
                        )
                      ) : (
                        <ChevronsUpDown size={13} className="opacity-40" />
                      )}
                    </button>
                    {/* hide this column (the Columns button brings it back) */}
                    <button
                      type="button"
                      className="ml-1 inline-flex rounded p-0.5 text-muted opacity-0 transition hover:bg-black/5 hover:text-ink group-hover:opacity-100"
                      title="Hide this column – the Columns button above brings it back"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = new Set(hiddenCols ?? allTableFields.filter((x) => !tableFields.some((t) => t.key === x.key)).map((x) => x.key));
                        next.add(f.key);
                        rememberCols(next);
                      }}
                    >
                      <EyeOff size={12} />
                    </button>
                    {/* drag to set the column's width; double-click to let it size itself again */}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      className="absolute -right-0.5 top-0 z-[1] h-full w-2 cursor-col-resize select-none hover:bg-navy/30"
                      title="Drag to change the column width · double-click to reset"
                      onMouseDown={startResize(f.key)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        const next = { ...colWidths };
                        delete next[f.key];
                        rememberWidths(next);
                      }}
                    />
                  </th>
                ))}
                <th className="text-right" data-nocopy>Actions</th>
              </tr>
            </thead>
            <tbody
              data-dropzone={rowUploads ? "" : undefined}
              {...(rowUploads
                ? {
                    onDragEnter: (e: React.DragEvent) => {
                      if (!hasFiles(e.dataTransfer)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setDropRow(rowIdAt(e.target));
                    },
                    onDragOver: (e: React.DragEvent) => {
                      if (!hasFiles(e.dataTransfer)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "copy";
                      const id = rowIdAt(e.target);
                      if (id !== dropRow) setDropRow(id);
                    },
                    onDragLeave: (e: React.DragEvent) => {
                      if (!hasFiles(e.dataTransfer)) return;
                      e.stopPropagation();
                      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropRow(null);
                    },
                    onDrop: async (e: React.DragEvent) => {
                      if (!hasFiles(e.dataTransfer)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const id = rowIdAt(e.target);
                      setDropRow(null);
                      const files = await filesFromDataTransfer(e.dataTransfer);
                      if (id && files.length) void attachToRow(id, files);
                    },
                  }
                : {})}
            >
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={tableFields.length + 2 + (data.canEdit ? 1 : 0)} className="py-10 text-center text-muted">
                    {data.rows.length === 0 ? `No ${def.title.toLowerCase()} yet.` : "Nothing matches your search / filters."}
                  </td>
                </tr>
              )}
              {pageRows.map((r) => (
                <tr
                  key={r.id}
                  data-row-id={rowUploads ? r.id : undefined}
                  onClick={() => setFocusedId(Number(r.id))}
                  onContextMenu={rowMenu(r)}
                  onDoubleClick={() => data.canEdit && openEdit(r)}
                  className={`${ROW_TONE[String(r.__row_tone ?? "")] ?? ""} ${selected.has(Number(r.id)) ? "bg-sky-50!" : ""} ${focusedId === Number(r.id) ? "outline outline-2 -outline-offset-2 outline-accent/60" : ""} ${dropRow === Number(r.id) ? "outline outline-2 outline-dashed -outline-offset-2 outline-navy bg-navy/10!" : ""}`}
                >
                  <td className="w-8 pr-0" data-nocopy>
                    <input type="checkbox" aria-label={`Select ${String(r[def.displayField ?? "id"] ?? r.id)}`} checked={selected.has(Number(r.id))} onChange={() => toggleSelected(Number(r.id))} />
                  </td>
                  {data.canEdit && (
                    <td className="w-9 pr-0" data-nocopy>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)} title="Edit this entry">
                        <Pencil size={14} />
                      </button>
                    </td>
                  )}
                  {tableFields.map((f) => (
                    <td key={f.key} style={colWidths[f.key] ? widthStyle(f) : undefined} className={`${isNumeric(f) ? "tnum text-right" : ""} ${colWidths[f.key] ? "overflow-hidden text-ellipsis whitespace-nowrap" : ""} ${stageTint(registerKey, f.key).td}`} title={f.type === "textarea" || colWidths[f.key] ? String(r[f.key] ?? "") : undefined}>
                      <Cell field={f} row={r} />
                    </td>
                  ))}
                  <td className="text-right" data-nocopy>
                    <div className="inline-flex items-center gap-0.5">
                      {def.rowLinkTemplate && (
                        <Link href={def.rowLinkTemplate.replace("{id}", String(r.id))} className="btn btn-secondary btn-sm">
                          <ExternalLink size={13} /> {def.rowLinkLabel ?? "Open"}
                        </Link>
                      )}
                      {registerKey === "changes" && data.canEdit && <ChangePackButtons changeId={Number(r.id)} stage={String(r.current_stage ?? "")} />}
                      {isPeriods &&
                        isAdmin &&
                        (r.status === "Locked" ? (
                          <button className="btn btn-secondary btn-sm" onClick={() => periodAction(r, "unlock")} title="Unlock this period">
                            <Unlock size={13} /> Unlock
                          </button>
                        ) : (
                          <button className="btn btn-primary btn-sm" onClick={() => periodAction(r, "lock")} title="Lock this period and store a snapshot">
                            <Lock size={13} /> Lock
                          </button>
                        ))}
                      <button className="btn btn-ghost btn-sm" onClick={() => void copyRows([r], "Row")} title="Copy this row as cells – paste into Excel, an email, or another tracker's Paste rows">
                        <Copy size={15} />
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setHistoryFor(r)} title="Change history">
                        <History size={15} />
                      </button>
                      {rowUploads && dropRow === Number(r.id) && <span className="mr-1 whitespace-nowrap text-xs font-semibold text-navy">Drop to attach</span>}
                      {rowUploads && (
                        <>
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={uploadingRow === Number(r.id)}
                            onClick={() => {
                              pickFor.current = Number(r.id);
                              rowFilesRef.current?.click();
                            }}
                            title="Attach files to this entry – the certificate, the guarantee, an endorsement, the transmittal. Files and folders can also be dropped straight on the row."
                          >
                            {uploadingRow === Number(r.id) ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={uploadingRow === Number(r.id)}
                            onClick={() => {
                              pickFor.current = Number(r.id);
                              rowFolderRef.current?.click();
                            }}
                            title="Attach a whole folder to this entry"
                          >
                            <FolderUp size={15} />
                          </button>
                        </>
                      )}
                      {data.canEdit && ["payment_applications", "contracts", "bonds"].includes(registerKey) && (
                        <button className="btn btn-ghost btn-sm" onClick={() => resetRow(r)} title="Reset to the previous report – the entry goes back to how it stood in the last issued report; one added since is removed">
                          <RotateCcw size={15} />
                        </button>
                      )}
                      {data.canEdit && (
                        <>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)} title="Edit">
                            <Pencil size={15} />
                          </button>
                          {(data.canDelete ?? true) && (
                            <button className="btn btn-ghost btn-sm text-red-600" onClick={() => setDeleting(r)} title="Delete">
                              <Trash2 size={15} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {def.totals && def.totals.length > 0 && visible.length > 0 && (
              <tfoot>
                <tr className="bg-page font-semibold">
                  {tableFields.map((f, i) => (
                    <td key={f.key} className={isNumeric(f) ? "tnum text-right" : ""}>
                      {i === 0 ? `Total (${visible.length})` : def.totals!.includes(f.key) ? <TotalCell field={f} rows={visible} /> : ""}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-muted">
          <span>
            {visible.length} of {fixedFilter ? visible.length : data.rows.length} {def.title.toLowerCase()}
            {rowFilter && visible.length !== data.rows.length && <span> (page filter applied)</span>}
            {data.canEdit && <span className="hidden sm:inline"> · double-click a row to edit</span>}
          </span>
          {pageCount > 1 && (
            <span className="inline-flex items-center gap-2">
              <button className="btn btn-secondary btn-sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                Previous
              </button>
              Page {safePage} of {pageCount}
              <button className="btn btn-secondary btn-sm" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
                Next
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Add / edit */}
      <Modal
        open={!!editing}
        title={editing?.row ? `Edit ${def.singular}` : `Add ${def.singular}`}
        onClose={() => setEditing(null)}
        size="lg"
        footer={
          <>
            {formError && <span className="mr-auto text-sm text-red-700">{formError}</span>}
            <button className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {editing && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <RecordForm
              def={def}
              values={editing.values}
              lookups={data.lookups}
              errors={formErrors}
              isNew={!editing.row}
              onChange={(k, v) => setEditing((s) => (s ? { ...s, values: { ...s.values, [k]: v } } : s))}
            />
            <button type="submit" className="hidden" />
          </form>
        )}
      </Modal>

      {/* History */}
      <Modal open={!!historyFor} title={`Change history · ${historyFor ? String(historyFor[def.displayField] ?? `#${historyFor.id}`) : ""}`} onClose={() => setHistoryFor(null)}>
        {historyFor && <RecordHistory registerKey={registerKey} recordId={historyFor.id} />}
      </Modal>

      {/* Delete */}
      <Modal
        open={!!deleting}
        title={`Delete ${def.singular}?`}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={confirmDelete}>
              <Trash2 size={15} /> Delete
            </button>
          </>
        }
      >
        <p className="text-sm text-ink">
          This will permanently delete <strong>{deleting ? String(deleting[def.displayField] ?? `#${deleting.id}`) : ""}</strong>. The change history keeps a
          record of what was deleted.
        </p>
      </Modal>

      <ImportDialog registerKey={registerKey} title={def.title} open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
      <PasteDialog
        registerKey={registerKey}
        title={def.title}
        singular={def.singular}
        fields={def.fields}
        open={pasteOpen}
        initialText={pasteText}
        after={pasteAfter}
        onClose={() => setPasteOpen(false)}
        onDone={(ids) => {
          if (ids.length) {
            setSelected(new Set(ids));
            setFocusedId(ids[0]);
          }
          void load();
          router.refresh();
        }}
      />
      {menu && (
        <div
          role="menu"
          className="fixed z-50 min-w-[15rem] rounded-lg border border-line bg-white py-1 text-sm shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="truncate px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{refOf(menu.row) || `#${menu.row.id}`}</div>
          <MenuItem icon={<Copy size={14} />} label="Copy this row" hint="Ctrl+C" onClick={() => { setMenu(null); void copyRows([menu.row], "Row"); }} />
          {selected.size > 0 && <MenuItem icon={<Copy size={14} />} label={`Copy the ${selected.size} ticked row(s)`} onClick={() => { setMenu(null); void copyRows(visible.filter((r) => selected.has(Number(r.id))), `${selected.size} row(s)`); }} />}
          {canPaste && (
            <>
              <MenuItem icon={<ClipboardPaste size={14} />} label="Paste rows above this row" hint="Ctrl+V" onClick={() => { setMenu(null); void pasteFromMenu(menu.row, "above"); }} />
              <MenuItem icon={<ClipboardPaste size={14} />} label="Paste rows below this row" onClick={() => { setMenu(null); void pasteFromMenu(menu.row, "below"); }} />
            </>
          )}
          <div className="my-1 border-t border-line" />
          {data.canEdit && <MenuItem icon={<Pencil size={14} />} label="Edit" onClick={() => { setMenu(null); openEdit(menu.row); }} />}
          <MenuItem icon={<History size={14} />} label="History" onClick={() => { setMenu(null); setHistoryFor(menu.row); }} />
        </div>
      )}
    </div>
  );
}

function TotalCell({ field: f, rows }: { field: FieldDef; rows: RecordRow[] }) {
  const total = rows.reduce((t, r) => t + (typeof r[f.key] === "number" ? (r[f.key] as number) : Number(r[f.key] ?? 0) || 0), 0);
  if (f.type === "money") return <>{formatMoney(total)}</>;
  if (f.type === "percent") return <>{formatPercent(total)}</>;
  return <>{formatNumber(total, Number.isInteger(total) ? 0 : 2)}</>;
}

function MenuItem({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-page" onClick={onClick}>
      <span className="text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </button>
  );
}

function isNumeric(f: FieldDef) {
  return f.type === "number" || f.type === "money" || f.type === "percent";
}

function displayValue(f: FieldDef, r: RecordRow): unknown {
  if (f.type === "lookup") return r[`${f.key}__label`];
  if (f.type === "boolean") return r[f.key] === true ? "Yes" : r[f.key] === false ? "No" : "";
  if (f.type === "date") return formatDate(r[f.key] as string);
  return r[f.key];
}

function sortValue(f: FieldDef, r: RecordRow): unknown {
  if (f.type === "lookup") return r[`${f.key}__label`];
  if (f.type === "boolean") return r[f.key] === true ? 1 : 0;
  return r[f.key];
}

/**
 * Light background per stage of the Change Management Tracker, so the RFC, PVO, VO, EI and DVO
 * columns can be told apart at a glance: [header class, cell class].
 */
const STAGE_TINT: { prefix: string; th: string; td: string }[] = [
  { prefix: "ew_", th: "bg-none! bg-slate-100!", td: "bg-slate-50/70" },
  { prefix: "rfc_", th: "bg-none! bg-sky-100!", td: "bg-sky-50/70" },
  { prefix: "pvo_", th: "bg-none! bg-amber-100!", td: "bg-amber-50/70" },
  { prefix: "vo_", th: "bg-none! bg-violet-100!", td: "bg-violet-50/70" },
  { prefix: "ei_", th: "bg-none! bg-teal-100!", td: "bg-teal-50/70" },
  { prefix: "dvo_", th: "bg-none! bg-emerald-100!", td: "bg-emerald-50/70" },
];

function stageTint(registerKey: string, key: string): { th: string; td: string } {
  if (registerKey !== "changes") return { th: "", td: "" };
  const t = STAGE_TINT.find((x) => key.startsWith(x.prefix));
  return t ? { th: t.th, td: t.td } : { th: "", td: "" };
}

/** The quick-catch lists above the Change Management Tracker: the open items at each stage. */
const QUICK_LISTS: { key: string; title: string; hint: string; stages: string[]; tone: "amber" | "blue" | "green"; border: string }[] = [
  { key: "pvo", title: "Open PVOs", hint: "Potential Variation Orders not yet closed – the full row, in the columns chosen below.", stages: ["PVO"], tone: "amber", border: "border-l-amber-400" },
  { key: "vo", title: "Open VOs / EIs", hint: "Variation Orders and Engineer's Instructions not yet closed.", stages: ["VO", "EI"], tone: "blue", border: "border-l-violet-400" },
  { key: "dvo", title: "Open DVOs", hint: "Determined Variation Orders still to be approved, including those at funding.", stages: ["DVO", "Funding"], tone: "green", border: "border-l-emerald-400" },
];

const ROW_TONE: Record<string, string> = {
  red: "bg-red-50/70",
  amber: "bg-amber-50/70",
};

const TONE_CLASS: Record<string, string> = {
  red: "rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-700",
  amber: "rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700",
  green: "rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700",
};

function Cell({ field: f, row: r }: { field: FieldDef; row: RecordRow }) {
  const v = r[f.key];
  if (v === null || v === undefined || v === "") {
    // a figure the dashboard expects rather than knows (a payment not yet made): shown in its column, marked
    const exp = r[`${f.key}__expected`];
    if (exp !== null && exp !== undefined && exp !== "") {
      const shown = f.type === "date" ? formatDate(String(exp)) : f.type === "money" ? formatMoney(Number(exp)) : f.type === "number" ? formatNumber(Number(exp), Number.isInteger(exp) ? 0 : 2) : String(exp);
      return (
        <span className="inline-flex items-center gap-1 italic text-amber-700" title={`Expected – not yet paid. Worked out from ${String(r.__expected_basis ?? "the payment history")}.`}>
          {shown}
          <span className="rounded bg-amber-100 px-1 py-px text-[9px] font-semibold not-italic uppercase tracking-wide text-amber-800">exp.</span>
        </span>
      );
    }
    return <span className="text-muted/60">—</span>;
  }
  const tone = r[`${f.key}__tone`] as string | null | undefined;
  const wrap = (node: React.ReactNode) => (tone && TONE_CLASS[tone] ? <span className={TONE_CLASS[tone]}>{node}</span> : <>{node}</>);
  if (f.key === "documents" && Array.isArray(r.__docs)) {
    const docs = r.__docs as { id: number; name: string; note?: string; href?: string }[];
    return (
      <span className="flex flex-col gap-0.5">
        {docs.map((d) => (
          <a key={d.id} href={d.href ?? `/api/bonds/documents/${d.id}`} target="_blank" rel="noreferrer" className="text-accent hover:underline" title={d.note ? `${d.name} – ${d.note}` : d.name}>
            {d.name.length > 48 ? `${d.name.slice(0, 45)}…` : d.name}
          </a>
        ))}
      </span>
    );
  }
  switch (f.type) {
    case "money":
      return wrap(formatMoney(v as number));
    case "number":
      return wrap(formatNumber(v as number, Number.isInteger(v) ? 0 : 2));
    case "percent":
      return <>{formatPercent(v as number)}</>;
    case "date":
      return <>{formatDate(v as string)}</>;
    case "boolean":
      return <Chip tone={v ? "green" : "grey"}>{v ? "Yes" : "No"}</Chip>;
    case "lookup": {
      const label = String(r[`${f.key}__label`] ?? "");
      return f.chip && label ? <Chip>{label}</Chip> : <>{label}</>;
    }
    case "select":
      return f.chip ? <Chip>{String(v)}</Chip> : <>{String(v)}</>;
    case "text":
      return f.chip ? <Chip>{String(v)}</Chip> : <>{String(v)}</>;
    case "textarea":
      // Two lines of real text rather than one cut off mid-word: a description or a comment is the
      // point of the row, and a fixed 20rem cap ignored however wide the column asked to be. The
      // cell still carries the whole text as its tooltip.
      return (
        <span
          style={{
            maxWidth: f.width ?? "20rem",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
            whiteSpace: "normal",
          }}
        >
          {String(v)}
        </span>
      );
    default:
      return <>{String(v)}</>;
  }
}
