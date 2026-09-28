"use client";

import { useCallback, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { RecordRow } from "@/lib/registers/types";
import { CLAIM_TYPES } from "@/lib/registers/defs/claims";
import { claimIsOpen, statusOutOfStep } from "@/lib/claims/status";
import { formatMoney } from "@/lib/format";
import { RegisterPage } from "@/components/register/RegisterPage";

/**
 * The Claims & Disputes register with filters built for the way claims are actually chased.
 *
 * One click narrows the table to a question somebody really asks – "which open claims has nobody
 * written about in a month?", "what is sitting with the commercial team?" – and every chip carries a
 * live count that already reflects the other choices, so a chip showing 0 is a dead end you can see
 * before you click it. Within a group, ticking two chips widens the set (either); across groups it
 * narrows it (both). The table's own search box still searches every column, the Remarks included.
 */

/** Days without a tracker update after which an open claim is called quiet – the same line the report draws. */
const QUIET_DAYS = 30;

type View = { id: string; label: string; help: string; test: (r: RecordRow, today: string) => boolean };

const VIEWS: View[] = [
  { id: "all", label: "All claims", help: "Every claim on the register.", test: () => true },
  { id: "open", label: "Being worked", help: "Pending, or still sitting with somebody on the tracker.", test: (r) => claimIsOpen(r) },
  {
    id: "quiet",
    label: `No update in ${QUIET_DAYS}+ days`,
    help: "Open claims whose latest tracker remark (or date of last action) is more than a month old – the ones to chase.",
    test: (r) => claimIsOpen(r) && r.days_since_update !== null && r.days_since_update !== undefined && Number(r.days_since_update) > QUIET_DAYS,
  },
  { id: "silent", label: "No remark recorded", help: "Open claims with nothing written in the tracker's Remarks at all.", test: (r) => claimIsOpen(r) && !r.last_update },
  {
    id: "overdue",
    label: "Target date passed",
    help: "Open claims whose target date for the next step is already behind us.",
    test: (r, today) => claimIsOpen(r) && typeof r.target_date === "string" && r.target_date !== "" && r.target_date < today,
  },
  {
    id: "mismatch",
    label: "Pending here, closed on tracker",
    help: "Still Pending on the dashboard, but the Claims Tracker says Closed – one of the two needs updating before the exposure figures can be trusted.",
    test: (r) => statusOutOfStep(r),
  },
  { id: "commercial", label: "With the commercial team", help: "Open claims the tracker says are with the commercial team.", test: (r) => claimIsOpen(r) && /commercial/i.test(String(r.action_with ?? "")) },
  { id: "closed", label: "Closed or rejected", help: "Claims no longer being worked.", test: (r) => !claimIsOpen(r) },
];

const NOT_SET = "(not set)";

type Facet = { key: string; label: string; values: (r: RecordRow) => string[]; order?: string[] };

const FACETS: Facet[] = [
  { key: "status", label: "Status", values: (r) => [String(r.status ?? "") || NOT_SET], order: ["Pending", "Approved", "Rejected"] },
  { key: "with", label: "Currently with", values: (r) => [String(r.action_with ?? "").trim() || NOT_SET] },
  { key: "contractor", label: "Contractor", values: (r) => [String(r.contractor_id__label ?? "").trim() || NOT_SET] },
  {
    key: "type",
    label: "Claim type",
    // a claim can be EOT and prolongation at once, so it counts under each
    values: (r) => {
      const t = CLAIM_TYPES.filter((c) => r[c.key] === true).map((c) => c.label);
      return t.length ? t : [NOT_SET];
    },
  },
  {
    key: "age",
    label: "Last update",
    values: (r) => {
      const d = r.days_since_update;
      if (d === null || d === undefined || d === "") return ["None recorded"];
      const n = Number(d);
      return [n <= QUIET_DAYS ? `Within ${QUIET_DAYS} days` : n <= 60 ? "31–60 days ago" : "Over 60 days ago"];
    },
    order: [`Within ${QUIET_DAYS} days`, "31–60 days ago", "Over 60 days ago", "None recorded"],
  },
];

type Picks = Record<string, string[]>;

export function ClaimsWorkspace({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [view, setView] = useState("all");
  const [picks, setPicks] = useState<Picks>({});
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const viewDef = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  /** Does a row pass every chosen facet, leaving one facet out so that facet's own counts stay honest. */
  const passesFacets = useCallback(
    (r: RecordRow, except?: string) =>
      FACETS.every((f) => {
        if (f.key === except) return true;
        const chosen = picks[f.key];
        if (!chosen?.length) return true;
        const vals = f.values(r);
        return chosen.some((c) => vals.includes(c));
      }),
    [picks],
  );

  const rowFilter = useCallback((r: RecordRow) => viewDef.test(r, today) && passesFacets(r), [viewDef, today, passesFacets]);
  const onRows = useCallback((r: RecordRow[]) => setRows(r), []);

  const shown = useMemo(() => rows.filter(rowFilter), [rows, rowFilter]);

  const viewCounts = useMemo(() => new Map(VIEWS.map((v) => [v.id, rows.filter((r) => v.test(r, today) && passesFacets(r)).length])), [rows, today, passesFacets]);

  const facetChips = useMemo(
    () =>
      FACETS.map((f) => {
        const base = rows.filter((r) => viewDef.test(r, today) && passesFacets(r, f.key));
        const counts = new Map<string, number>();
        for (const r of rows) for (const v of f.values(r)) if (!counts.has(v)) counts.set(v, 0);
        for (const r of base) for (const v of f.values(r)) counts.set(v, (counts.get(v) ?? 0) + 1);
        const chosen = picks[f.key] ?? [];
        const values = [...counts.entries()]
          .filter(([v, n]) => n > 0 || chosen.includes(v))
          .sort((a, b) => {
            const oa = f.order?.indexOf(a[0]) ?? -1;
            const ob = f.order?.indexOf(b[0]) ?? -1;
            if (oa !== -1 || ob !== -1) return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
            if (a[0] === NOT_SET) return 1;
            if (b[0] === NOT_SET) return -1;
            return b[1] - a[1] || a[0].localeCompare(b[0]);
          });
        return { facet: f, values };
      }),
    [rows, viewDef, today, passesFacets, picks],
  );

  function toggle(key: string, value: string) {
    setPicks((p) => {
      const cur = p[key] ?? [];
      const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
      return { ...p, [key]: next };
    });
  }

  const activeCount = (view === "all" ? 0 : 1) + Object.values(picks).reduce((t, v) => t + v.length, 0);
  const claimed = shown.reduce((t, r) => t + (Number(r.contractor_cost) || 0), 0);
  const days = shown.reduce((t, r) => t + (Number(r.contractor_eot_days) || 0), 0);
  const open = shown.filter((r) => claimIsOpen(r)).length;

  return (
    <div className="space-y-3">
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Find claims</h2>
          <p className="text-xs text-muted">
            {rows.length ? (
              <>
                Showing <b className="text-ink">{shown.length}</b> of {rows.length} · {open} open · SAR {formatMoney(claimed)} claimed · {days.toLocaleString("en-US")} EOT days claimed
              </>
            ) : (
              "Loading…"
            )}
            {activeCount > 0 && (
              <button
                type="button"
                className="ml-3 inline-flex items-center gap-1 font-medium text-accent hover:underline"
                onClick={() => {
                  setView("all");
                  setPicks({});
                }}
              >
                <X size={12} /> Clear {activeCount === 1 ? "filter" : `all ${activeCount} filters`}
              </button>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick views">
          {VIEWS.map((v) => {
            const n = viewCounts.get(v.id) ?? 0;
            const on = view === v.id;
            const alarm = (v.id === "quiet" || v.id === "silent" || v.id === "overdue" || v.id === "mismatch") && n > 0;
            return (
              <button
                key={v.id}
                type="button"
                title={v.help}
                aria-pressed={on}
                disabled={!on && n === 0 && v.id !== "all"}
                onClick={() => setView(on ? "all" : v.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  on ? "border-navy bg-navy text-white" : alarm ? "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500" : "border-line bg-white text-ink hover:border-navy"
                }`}
              >
                {v.label} <span className={on ? "text-white/80" : "text-muted"}>{n}</span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-x-6 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
          {facetChips.map(({ facet, values }) => (
            <div key={facet.key} className="min-w-0">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{facet.label}</div>
              <div className="flex flex-wrap gap-1">
                {values.length === 0 && <span className="text-xs text-muted">–</span>}
                {values.map(([v, n]) => {
                  const on = (picks[facet.key] ?? []).includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={on}
                      disabled={!on && n === 0}
                      onClick={() => toggle(facet.key, v)}
                      className={`max-w-full truncate rounded-md border px-2 py-0.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        on ? "border-accent bg-accent/10 font-medium text-ink" : "border-line bg-white text-ink hover:border-navy"
                      }`}
                      title={v}
                    >
                      {v} <span className="text-muted">{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <RegisterPage registerKey="claims" isAdmin={isAdmin} rowFilter={rowFilter} onRows={onRows} hideFilterPanel />
    </div>
  );
}
