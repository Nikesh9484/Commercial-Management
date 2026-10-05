"use client";

import { useCallback, useMemo, useState } from "react";
import { FileSpreadsheet, FileText, Filter, X } from "lucide-react";
import type { RecordRow } from "@/lib/registers/types";
import { getBondsSummary } from "@/lib/bonds/summary";
import { CATEGORY_OPTIONS, EXPIRY_OPTIONS, NO_BONDS_FILTER, bondsFilterLabel, bondsFilterQuery, filterBonds, isFiltered, matchesBondsFilter, type BondsCategory, type BondsExpiry, type BondsFilter } from "@/lib/bonds/filter";
import { formatMoney } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";
import { RegisterPage } from "@/components/register/RegisterPage";
import { ExpiringSoonCard } from "@/components/bonds/ExpiringSoonCard";
import { BondsAlertSummaries } from "@/components/bonds/BondsAlertSummaries";
import { DuplicatesCard } from "@/components/bonds/DuplicatesCard";
import type { DuplicateGroup } from "@/lib/bonds/duplicates";
import { ExportButtons } from "@/components/ui/ExportButtons";
import { AddFromDocuments } from "@/components/changes/AddFromDocuments";
import { HorizontalBars } from "@/components/charts/HorizontalBars";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

/**
 * The Bonds & Insurance page below its header: the expiry / type filter, the figures for whatever is
 * filtered, and the register itself. The same filter is carried into the PDF and Excel reports, so a
 * download always matches what is on screen.
 */
export function BondsWorkspace({ rows, isAdmin, hasPeriod, canUpload = false, duplicates = [], canMerge = false, initialCategory = "all" }: { rows: RecordRow[]; isAdmin: boolean; hasPeriod: boolean; canUpload?: boolean; duplicates?: DuplicateGroup[]; canMerge?: boolean; initialCategory?: BondsFilter["category"] }) {
  const [filter, setFilter] = useState<BondsFilter>({ ...NO_BONDS_FILTER, category: initialCategory });

  const visible = useMemo(() => filterBonds(rows, filter), [rows, filter]);
  const summary = useMemo(() => getBondsSummary(visible), [visible]);
  const filtered = isFiltered(filter);
  const label = bondsFilterLabel(filter);

  // each list counts against the other choice, so the numbers always add up to what a click would show
  const expiryCounts = useMemo(() => {
    const base = filterBonds(rows, { expiry: "all", category: filter.category, contractor: filter.contractor });
    return new Map(EXPIRY_OPTIONS.map((o) => [o.value, base.filter((r) => matchesBondsFilter(r, { expiry: o.value, category: "all", contractor: "" })).length]));
  }, [rows, filter.category, filter.contractor]);
  const categoryCounts = useMemo(() => {
    const base = filterBonds(rows, { expiry: filter.expiry, category: "all", contractor: filter.contractor });
    return new Map(CATEGORY_OPTIONS.map((o) => [o.value, base.filter((r) => matchesBondsFilter(r, { expiry: "all", category: o.value, contractor: "" })).length]));
  }, [rows, filter.expiry, filter.contractor]);

  const byTypeChart = useMemo(() => {
    const byType = new Map<string, number>();
    for (const r of visible) {
      if (r.released === true || r.superseded === true) continue;
      const k = String(r.type_id__label ?? "(no type)");
      byType.set(k, (byType.get(k) ?? 0) + num(r.amount_provided));
    }
    return [...byType.entries()].map(([l, value]) => ({ label: l, value: Math.round(value) })).sort((a, b) => b.value - a.value);
  }, [visible]);

  // every contractor that actually has a bond or policy on this project
  const contractors = useMemo(() => [...new Set(rows.map((r) => String(r.contractor_id__label ?? "")).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rows]);

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
            {canUpload && (
              <AddFromDocuments
                endpoint="/api/bonds/from-documents"
                title="Add a bond or insurance from its documents"
                button="Add from documents"
                intro="Drop the policy schedule, the certificate of insurance or the bank guarantee – with its Aconex transmittal if you have it – for one or several at once. The type, the policy number, the insurer or bank, the contractor and contract, the period and the amount are read (scanned pages included) and the register is updated, whatever report is selected."
                tip="A policy of the same type already held for that contractor stops the upload: the old and the new are shown side by side for you to replace or keep. A renewal, an extension or an amendment only moves the expiry date on (and the amount when it changes) – the start date stays the date the bond was first put in place. Anything the files do not give is listed with the entry – use the pencil on the row to add it."
              />
            )}
            {filtered && (
              <button className="btn btn-ghost btn-sm" onClick={() => setFilter(NO_BONDS_FILTER)}>
                <X size={14} /> Clear
              </button>
            )}
            {hasPeriod && (
              <a href="/api/bonds/tracker" className="btn btn-excel btn-sm" title="The register written into the Bonds & Insurance tab of your own cost report workbook – the tab's formulas, colours, fonts and layout exactly as in the report">
                <FileSpreadsheet size={14} /> Insurance tracker (report layout)
              </a>
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">Contractor</span>
          <div className="min-w-0 max-w-sm flex-1">
            <SearchableSelect
              placeholder="All contractors"
              value={filter.contractor}
              onChange={(v) => setFilter((f) => ({ ...f, contractor: v }))}
              options={contractors.map((c) => ({ value: c, label: c, hint: `${rows.filter((r) => String(r.contractor_id__label ?? "") === c).length} item(s)` }))}
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          {filtered ? `Showing ${visible.length} of ${rows.length} item(s). The figures, the chart, the log below and the PDF / Excel report all follow this filter.` : `Showing all ${rows.length} item(s). Pick a filter to narrow the page – the PDF and Excel report follow it.`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label={filtered ? "Filtered bonds & policies" : "Bonds & policies"}
          value={String(summary.total)}
          sub={`${summary.expired} expired · ${summary.red} within 30 days · ${summary.amber} in 31–60 days${summary.released ? ` · ${summary.released} released (contract closed)` : ""}${summary.superseded ? ` · ${summary.superseded} superseded` : ""}`}
          tone={summary.expired + summary.red > 0 ? "red" : summary.amber > 0 ? "amber" : undefined}
        />
        <Stat label="Shortfalls" value={String(summary.shortfall)} sub={summary.shortfall ? `${formatMoney(summary.shortfallValue)} below requirement in total` : "every item meets its requirement"} tone={summary.shortfall ? "red" : "green"} />
        <div className="card min-w-0 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Checks outstanding</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip tone={summary.notApproved ? "amber" : "green"}>Not approved {summary.notApproved}</Chip>
            <Chip tone={summary.notVerified ? "amber" : "green"}>Bank not verified {summary.notVerified}</Chip>
          </div>
        </div>
      </div>

      {/* the two chase lists, each downloadable on its own, worked out from every row rather than the
          page filter – they are the same two lists whatever is filtered above */}
      <DuplicatesCard groups={duplicates} canMerge={canMerge} />

      <BondsAlertSummaries rows={rows} hasPeriod={hasPeriod} contractor={filter.contractor} />

      <ExpiringSoonCard items={summary.expiring} expired={summary.expired} released={summary.released} superseded={summary.superseded} />

      {byTypeChart.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Cover provided by type</h2>
          <p className="mb-3 text-xs text-muted">Face value held, active and expiring items only{filtered ? `, ${label?.toLowerCase()}` : ""}.</p>
          <HorizontalBars rows={byTypeChart} valueLabel="provided" />
        </div>
      )}

      <p className="text-xs text-muted">
        Rows turn amber within 60 days of expiry and red within 30 days or once expired. Only a bond on an open contract is chased: a contract is open when its Final Account Status says Open (Payment Tracking&apos;s Active decides where there is no final account) and closed on any other status. A bond is tied to its contract by the cost report line, else the package, else the wording of its package name, else the contractor; one that cannot be tied to any open contract shows as Released and is not flagged, and &quot;Contract closed&quot; can be ticked on the row. Contracts are recognised by their code (031C02), so a closed contract releases the bonds on every one of its cost lines. An older policy replaced by a newer one of the same type on the same contract shows as Superseded. Contract requirement = the % entered × revised contract value (or the original sum if no cost line is linked), or the fixed SAR amount. Types are managed under Settings → Insurance / Bond Types, and each one counts as a bond, an insurance policy or &quot;other&quot; from its name.
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
