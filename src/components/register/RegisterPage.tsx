"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Download, Upload, Pencil, Trash2, History, ChevronUp, ChevronDown, ChevronsUpDown, RefreshCw, Lock, Unlock, Filter, X } from "lucide-react";
import type { FieldDef, LookupOption, RecordRow, RegisterDef } from "@/lib/registers/types";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { RecordForm, type FormValues } from "./RecordForm";
import { RecordHistory } from "./HistoryPanel";
import { ImportDialog } from "./ImportDialog";

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
  scopeDefaults?: Record<string, number>;
}

export function RegisterPage({ registerKey, isAdmin = false }: { registerKey: string; isAdmin?: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ row: RecordRow | null; values: FormValues } | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyFor, setHistoryFor] = useState<RecordRow | null>(null);
  const [deleting, setDeleting] = useState<RecordRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(() => {
    return fetchRegister(registerKey).then(
      (loaded) => setData(loaded),
      (e: Error) => setLoadError(e.message),
    );
  }, [registerKey]);

  useEffect(() => {
    let live = true;
    fetchRegister(registerKey).then(
      (loaded) => live && setData(loaded),
      (e: Error) => live && setLoadError(e.message),
    );
    return () => {
      live = false;
    };
  }, [registerKey]);

  const def = data?.def;
  const tableFields = useMemo(() => def?.fields.filter((f) => !f.hideInTable && f.type !== "password") ?? [], [def]);
  const filterFields = useMemo(() => {
    if (!def) return [];
    const explicit = def.fields.filter((f) => f.filter);
    if (explicit.length) return explicit.filter((f) => f.type === "select" || f.type === "lookup" || f.type === "boolean");
    return def.fields.filter((f) => f.type === "select" || f.type === "lookup" || f.type === "boolean");
  }, [def]);
  const effectiveSort = sort ?? def?.defaultSort ?? null;

  const visible = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    let rows = data.rows;
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
  }, [data, search, filters, effectiveSort]);

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

  async function periodAction(row: RecordRow, action: "lock" | "unlock") {
    const res = await fetch(`/api/periods/${row.id}/${action}`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return toast(j.error ?? "Action failed.", "error");
    toast(action === "lock" ? `Period locked. Snapshot stored (${j.records ?? 0} record(s)).` : "Period unlocked.");
    await load();
    router.refresh();
  }

  if (loadError) return <div className="card p-6 text-sm text-red-700">{loadError}</div>;
  if (!data || !def) return <div className="card p-6 text-sm text-muted">Loading…</div>;

  const activeFilterCount = Object.values(filters).filter((v) => v !== "").length;
  const isPeriods = registerKey === "reporting_periods";

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder={`Search ${def.title.toLowerCase()}…`} value={search} onChange={(e) => changeSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {filterFields.length > 0 && (
            <button className={`btn btn-secondary ${activeFilterCount ? "border-accent text-accent" : ""}`} onClick={() => setShowFilters((s) => !s)}>
              <Filter size={16} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </button>
          )}
          <button className="btn btn-secondary" onClick={load} title="Refresh">
            <RefreshCw size={16} />
          </button>
          <a className="btn btn-secondary" href={`/api/registers/${registerKey}/export`}>
            <Download size={16} /> Export
          </a>
          {data.canEdit && (
            <button className="btn btn-secondary" onClick={() => setImportOpen(true)}>
              <Upload size={16} /> Import
            </button>
          )}
          {data.canEdit && (
            <button className="btn btn-primary" onClick={openNew}>
              <Plus size={16} /> Add {def.singular}
            </button>
          )}
        </div>
      </div>

      {showFilters && filterFields.length > 0 && (
        <div className="card flex flex-wrap items-end gap-3 p-3">
          {filterFields.map((f) => (
            <label key={f.key} className="flex min-w-40 flex-col gap-1 text-xs text-muted">
              {f.label}
              <select className="input" value={filters[f.key] ?? ""} onChange={(e) => changeFilter(f.key, e.target.value)}>
                <option value="">All</option>
                {f.type === "boolean" && (
                  <>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </>
                )}
                {f.type === "select" && (f.options ?? []).map((o) => <option key={o}>{o}</option>)}
                {f.type === "lookup" &&
                  (data.lookups[f.key] ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          {activeFilterCount > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setFilters({})}>
              <X size={14} /> Clear
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="max-h-[70vh] overflow-auto">
          <table className="data w-full">
            <thead>
              <tr>
                {tableFields.map((f) => (
                  <th key={f.key} style={{ width: f.width }} className={isNumeric(f) ? "text-right" : ""}>
                    <button className="inline-flex items-center gap-1 font-semibold text-muted hover:text-ink" onClick={() => toggleSort(f.key)}>
                      {f.label}
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
                  </th>
                ))}
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={tableFields.length + 1} className="py-10 text-center text-muted">
                    {data.rows.length === 0 ? `No ${def.title.toLowerCase()} yet.` : "Nothing matches your search / filters."}
                  </td>
                </tr>
              )}
              {pageRows.map((r) => (
                <tr key={r.id} onDoubleClick={() => data.canEdit && openEdit(r)}>
                  {tableFields.map((f) => (
                    <td key={f.key} className={isNumeric(f) ? "tnum text-right" : ""} title={f.type === "textarea" ? String(r[f.key] ?? "") : undefined}>
                      <Cell field={f} row={r} />
                    </td>
                  ))}
                  <td className="text-right">
                    <div className="inline-flex items-center gap-0.5">
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
                      <button className="btn btn-ghost btn-sm" onClick={() => setHistoryFor(r)} title="Change history">
                        <History size={15} />
                      </button>
                      {data.canEdit && (
                        <>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)} title="Edit">
                            <Pencil size={15} />
                          </button>
                          <button className="btn btn-ghost btn-sm text-red-600" onClick={() => setDeleting(r)} title="Delete">
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-muted">
          <span>
            {visible.length} of {data.rows.length} {def.title.toLowerCase()}
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
    </div>
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

const TONE_CLASS: Record<string, string> = {
  red: "rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-700",
  amber: "rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700",
  green: "rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700",
};

function Cell({ field: f, row: r }: { field: FieldDef; row: RecordRow }) {
  const v = r[f.key];
  if (v === null || v === undefined || v === "") return <span className="text-muted/60">—</span>;
  const tone = r[`${f.key}__tone`] as string | null | undefined;
  const wrap = (node: React.ReactNode) => (tone && TONE_CLASS[tone] ? <span className={TONE_CLASS[tone]}>{node}</span> : <>{node}</>);
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
      return <span className="block max-w-xs truncate">{String(v)}</span>;
    default:
      return <>{String(v)}</>;
  }
}
