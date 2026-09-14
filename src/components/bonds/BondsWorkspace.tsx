"use client";

import { useCallback, useMemo, useState } from "react";
import { FileText, Filter, X } from "lucide-react";
import type { RecordRow } from "@/lib/registers/types";
import { getBondsSummary } from "@/lib/bonds/summary";
import { CATEGORY_OPTIONS, EXPIRY_OPTIONS, NO_BONDS_FILTER, bondsFilterLabel, bondsFilterQuery, filterBonds, isFiltered, matchesBondsFilter, type BondsCategory, type BondsExpiry, type BondsFilter } from "@/lib/bonds/filter";
import { formatMoney } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";
import { RegisterPage } from "@/components/register/RegisterPage";
import { ExpiringSoonCard } from "@/components/bonds/ExpiringSoonCard";
import { ExportButtons } from "@/components/ui/ExportButtons";
import { HorizontalBars } from "@/components/charts/HorizontalBars";

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

/**
 * The Bonds & Insurance page below its header: the expiry / type filter, the figures for whatever is
 * filtered, and the register itself. The same filter is carried into the PDF and Excel reports, so a
 * download always matches what is on screen.
 */
export function BondsWorkspace({ rows, isAdmin, hasPeriod }: { rows: RecordRow[]; isAdmin: boolean; hasPeriod: boolean }) {
  const [filter, setFilter] = useState<BondsFilter>(NO_BONDS_FILTER);

  const visible = useMemo(() => filterBonds(rows, filter), [rows, filter]);
  const summary = useMemo(() => getBondsSummary(visible), [visible]);
  const filtered = isFiltered(filter);
  const label = bondsFilterLabel(filter);

  // each list counts against the other choice, so the numbers always add up to what a click would show
  const expiryCounts = useMemo(() => {
    const base = filterBonds(rows, { expiry: "all", category: filter.category });
    return new Map(EXPIRY_OPTIONS.map((o) => [o.value, base.filter((r) => matchesBondsFilter(r, { expiry: o.value, category: "all" })).length]));
  }, [rows, filter.category]);
  const categoryCounts = useMemo(() => {
    const base = filterBonds(rows, { expiry: filter.expiry, category: "all" });
    return new Map(CATEGORY_OPTIONS.map((o) => [o.value, base.filter((r) => matchesBondsFilter(r, { expiry: "all", category: o.value })).length]));
  }, [rows, filter.expiry]);

  const byTypeChart = useMemo(() => {
    const byType = new Map<string, number>();
    for (const r of visible) {
      if (r.released === true || r.superseded === true) continue;
      const k = String(r.type_id__label ?? "(no type)");
      byType.set(k, (byType.get(k) ?? 0) + num(r.amount_provided));
    }
    return [...byType.entries()].map(([l, value]) => ({ label: l, value: Math.round(value) })).sort((a, b) => b.value - a.value);
  }, [visible]);

  const rowFilter = useCallback((r: RecordRow) => matchesBondsFilter(r, filter), [filter]);

  return (
    <>
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Filter size={15} className="text-navy" /> Filter
            {label && <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-medium text-navy">{label}</span>}
          </h2>
          <div className="flex items-center gap-2">
            {filtered && (
              <button className="btn btn-ghost btn-sm" onClick={() => setFilter(NO_BONDS_FILTER)}>
                <X size={14} /> Clear
              </button>
            )}
            {hasPeriod && (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2 py-1 shadow-sm">
                <FileText size={14} className="text-navy" />
                <ExportButtons
                  section="bonds_report"
                  label={filtered ? "Report on this filter" : "Bonds & insurance report"}
                  params={bondsFilterQuery(filter)}
                  title={filtered ? `Bonds & insurance report – ${label}` : "Bonds & insurance report"}
                />
              </span>
            )}
          </div>
        </div>
        <FilterRow<BondsExpiry>
          title="Expiry"
          options={EXPIRY_OPTIONS}
          counts={expiryCounts}
          value={filter.expiry}
          onPick={(v) => setFilter((f) => ({ ...f, expiry: v }))}
        />
        <FilterRow<BondsCategory>
          title="Type"
          options={CATEGORY_OPTIONS}
          counts={categoryCounts}
          value={filter.category}
          onPick={(v) => setFilter((f) => ({ ...f, category: v }))}
        />
        <p className="text-xs text-muted">
          {filtered ? `Showing ${visible.length} of ${rows.length} item(s). The figures, the chart, the log below and the PDF / Excel report all follow this filter.` : `Showing all ${rows.length} item(s). Pick a filter to narrow the page – the PDF and Excel report follow it.`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={filtered ? "Filtered bonds & policies" : "Bonds & policies"}
          value={String(summary.total)}
          sub={`${summary.expired} expired · ${summary.red} within 30 days · ${summary.amber} in 31–60 days${summary.released ? ` · ${summary.released} released (contract closed)` : ""}${summary.superseded ? ` · ${summary.superseded} superseded` : ""}`}
          tone={summary.expired + summary.red > 0 ? "red" : summary.amber > 0 ? "amber" : undefined}
        />
        <Stat label="Provided vs required" value={`${formatMoney(summary.provided)} / ${formatMoney(summary.required)}`} sub="total face value held vs total contract requirement" small />
        <Stat label="Shortfalls" value={String(summary.shortfall)} sub={summary.shortfall ? `${formatMoney(summary.shortfallValue)} below requirement in total` : "every item meets its requirement"} tone={summary.shortfall ? "red" : "green"} />
        <div className="card min-w-0 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Checks outstanding</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip tone={summary.notApproved ? "amber" : "green"}>Not approved {summary.notApproved}</Chip>
            <Chip tone={summary.notVerified ? "amber" : "green"}>Bank not verified {summary.notVerified}</Chip>
          </div>
        </div>
      </div>

      <ExpiringSoonCard items={summary.expiring} expired={summary.expired} released={summary.released} superseded={summary.superseded} />

      {byTypeChart.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Cover provided by type</h2>
          <p className="mb-3 text-xs text-muted">Face value held, active and expiring items only{filtered ? `, ${label?.toLowerCase()}` : ""}.</p>
          <HorizontalBars rows={byTypeChart} valueLabel="provided" />
        </div>
      )}

      <p className="text-xs text-muted">
        Rows turn amber within 60 days of expiry and red within 30 days or once expired. A bond whose contract is closed shows as Released and is not flagged: the Final Account Status decides first (Closed, Not Required or Direct Payment – No FA), Payment Tracking (Closed, Completed, Terminated) decides where there is no final account, and &quot;Contract closed&quot; can be ticked on the row. Contracts are recognised by their code (031C02), so a closed contract releases the bonds on every one of its cost lines. An older policy replaced by a newer one of the same type on the same contract shows as Superseded. Contract requirement = the % entered × revised contract value (or the original sum if no cost line is linked), or the fixed SAR amount. Types are managed under Settings → Insurance / Bond Types, and each one counts as a bond, an insurance policy or &quot;other&quot; from its name.
      </p>
      <RegisterPage registerKey="bonds" isAdmin={isAdmin} rowFilter={filtered ? rowFilter : undefined} exportParams={bondsFilterQuery(filter)} />
    </>
  );
}

function FilterRow<T extends string>({ title, options, counts, value, onPick }: { title: string; options: { value: T; label: string; help: string }[]; counts: Map<T, number>; value: T; onPick: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-14 shrink-0 text-xs font-medium uppercase tracking-wide text-muted">{title}</span>
      {options.map((o) => {
        const n = counts.get(o.value) ?? 0;
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.help}
            onClick={() => onPick(o.value)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${on ? "border-navy bg-navy text-white shadow-sm" : n === 0 ? "border-line bg-white text-muted/60 hover:border-muted" : "border-line bg-white text-ink hover:border-navy hover:text-navy"}`}
          >
            {o.label} <span className={`tnum ${on ? "text-white/80" : "text-muted"}`}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}

function Stat({ label, value, sub, tone, small }: { label: string; value: string; sub?: string; tone?: "red" | "amber" | "green"; small?: boolean }) {
  const cls = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-ink";
  return (
    <div className="card min-w-0 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 truncate font-semibold tnum ${small ? "text-sm" : "text-lg"} ${cls}`} title={value}>
        {value}
      </div>
      {sub && (
        <div className="truncate text-xs text-muted" title={sub}>
          {sub}
        </div>
      )}
    </div>
  );
}
