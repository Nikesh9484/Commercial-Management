"use client";

import { useState } from "react";
import Link from "next/link";
import { RegisterPage } from "@/components/register/RegisterPage";
import { Chip } from "@/components/ui/Chip";
import { formatMoney, formatNumber } from "@/lib/format";
import type { EwSummary, RiskSummary, HeatCell } from "@/lib/risks/summary";
import { HeatMap } from "./HeatMap";

type Tab = "ew" | "risks";

export function EwRisksPage({ ew, risks, isAdmin, initialTab }: { ew: EwSummary; risks: RiskSummary; isAdmin: boolean; initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-line">
        {(
          [
            ["ew", `Early Warnings (${ew.total})`],
            ["risks", `Risks & Opportunities (${risks.totals[0].count + risks.totals[1].count})`],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${tab === k ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "ew" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Early warnings" value={String(ew.total)} sub={`${ew.open} open · ${ew.converted} converted to RFC · ${ew.closed} closed`} />
            <Stat label="Open – potential cost (L)" value={formatMoney(ew.openCost)} sub={ew.unlinked ? `${ew.unlinked} open item(s) not linked to a cost line` : "all open items linked to a cost line"} tone={ew.unlinked ? "amber" : undefined} />
            <Stat label="Open – potential time" value={`${formatNumber(ew.openTime, 0)} days`} sub="sum of potential time impact" />
            <div className="card min-w-0 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">Open by likelihood</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Chip tone="green">Low {ew.byLikelihood.Low}</Chip>
                <Chip tone="amber">Med {ew.byLikelihood.Med}</Chip>
                <Chip tone="red">High {ew.byLikelihood.High}</Chip>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted">
            Open early warnings feed column L of the{" "}
            <Link href="/modules/cost-report" className="text-accent hover:underline">
              cost report
            </Link>
            . When one becomes an RFC, set its status to <em>Converted to RFC</em> and link the change item so the value moves to the change tracker instead.
          </p>
          <RegisterPage registerKey="early_warnings" isAdmin={isAdmin} />
        </>
      )}

      {tab === "risks" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {risks.totals.map((t) => (
              <Stat
                key={t.type}
                label={`${t.type === "Risk" ? "Risks" : "Opportunities"} – expected value`}
                value={formatMoney(t.expectedValue)}
                sub={`${t.open} open of ${t.count} · impact ${formatMoney(t.costImpact)} · ${formatNumber(t.timeImpact, 0)} days`}
                tone={t.type === "Risk" ? "red" : "green"}
              />
            ))}
            <Stat label="Net expected exposure" value={formatMoney(risks.netExpected)} sub="risk expected value − opportunity expected value (open items)" tone={risks.netExpected > 0 ? "amber" : "green"} />
            <div className="card min-w-0 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">How it is calculated</div>
              <p className="mt-1 text-xs text-muted">
                Expected value = probability % × cost impact. Open and Mitigating items count; Closed and Realised do not. {risks.unrated > 0 && <span className="text-amber-700">{risks.unrated} open item(s) have no probability or impact yet.</span>}
              </p>
            </div>
          </div>
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-ink">Heat map – probability vs cost impact (open items)</h2>
            <p className="mb-3 text-xs text-muted">Impact bands: Low under 1,000,000 · Medium 1,000,000 – 5,000,000 · High over 5,000,000 SAR. Probability bands: Low ≤ 33% · Medium 34–66% · High over 66%.</p>
            <HeatMap cells={risks.heat as HeatCell[]} probabilityBands={risks.probabilityBands} impactBands={risks.impactBands} />
          </div>
          <RegisterPage registerKey="risks" isAdmin={isAdmin} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "red" | "amber" | "green" }) {
  const cls = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-ink";
  return (
    <div className="card min-w-0 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 truncate text-lg font-semibold tnum ${cls}`} title={value}>
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
