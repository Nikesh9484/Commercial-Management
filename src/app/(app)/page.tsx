import Link from "next/link";
import { Lock, Unlock, AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getDashboard } from "@/lib/dashboard/summary";
import { formatMoney, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { CostChart } from "@/components/cost-report/CostChart";
import { PaymentChart } from "@/components/payments/PaymentChart";
import { ExpiringSoonCard } from "@/components/bonds/ExpiringSoonCard";
import { KeyIssues } from "@/components/dashboard/KeyIssues";
import { ActionsList } from "@/components/dashboard/ActionsList";
import { MovementPanel } from "@/components/dashboard/MovementPanel";
import { PaymentTracker } from "@/components/dashboard/PaymentTracker";
import { EmailReportButton } from "@/components/dashboard/EmailReportButton";
import { getMovement } from "@/lib/dashboard/movement";
import { executiveTotals } from "@/lib/cost-report/executive";

export const metadata = { title: "Executive Summary" };

export default async function HomePage() {
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  if (!ctx.programme) {
    return (
      <div>
        <PageHeader exportSection="exec" title="Executive Summary" />
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Add a programme under Settings and select it in the top bar.
        </div>
      </div>
    );
  }
  const d = getDashboard(getDb(), ctx.programme.id, ctx.period?.id ?? null);
  const movement = getMovement(getDb(), ctx.programme.id, ctx.period?.id ?? null);
  const g = executiveTotals(d.report);
  const canEdit = user.role !== "viewer";

  const money: { label: string; value: number; sub?: string; signed?: boolean; col: string }[] = [
    { label: "Approved Budget", value: g.E, col: "E" },
    { label: "Latest Budget", value: g.G, col: "G", sub: `incl. transfers ${formatMoney(g.F)}` },
    { label: "Committed", value: g.I, col: "I", sub: `incl. DVOs ${formatMoney(g.H)}` },
    { label: "Anticipated Final Account", value: g.N, col: "N", sub: `PVO/RFC/EW/claims ${formatMoney(g.J + g.K + g.L + g.M)}` },
    { label: "Variance to Latest Budget", value: g.O, col: "O", signed: true, sub: g.O > 0 ? "over budget" : g.O < 0 ? "under budget" : "on budget" },
    { label: "Certified to Date", value: g.P, col: "P", sub: g.N ? `${Math.round((g.P / g.N) * 100)}% of anticipated final account` : undefined },
    { label: "Works to Complete", value: g.Q, col: "Q" },
    { label: "Period Movement", value: g.S, col: "S", signed: true, sub: d.report.previousPeriod ? (d.report.previousPeriod.snapshotAvailable ? `vs ${d.report.previousPeriod.label}` : "previous period not locked") : "no previous period" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader exportSection="exec"
        eyebrow={`${ctx.programme.code} · ${ctx.asset?.code ?? ""} · Module 11`}
        title="Executive Summary"
        subtitle={`${ctx.period?.label ?? "No reporting period"}${ctx.period ? ` · cut-off ${formatDate(ctx.period.period_end)}` : ""} · all amounts SAR`}
        actions={
          <>
            {ctx.period && (
              <Chip tone={ctx.period.status === "Locked" ? "green" : "amber"}>
                {ctx.period.status === "Locked" ? <Lock size={11} className="mr-1" /> : <Unlock size={11} className="mr-1" />}
                {ctx.period.status}
              </Chip>
            )}
            {d.checklist.total > 0 && (
              <Link href="/modules/project-setup">
                <Chip tone={d.checklist.done === d.checklist.total ? "green" : d.checklist.done > 0 ? "amber" : "red"}>
                  Checklist {d.checklist.done}/{d.checklist.total}
                </Chip>
              </Link>
            )}
            <Chip tone={d.report.checkOk ? "green" : "red"}>L1 − L2 check {d.report.checkOk ? "OK" : "FAILED"}</Chip>
            {ctx.period && <EmailReportButton />}
          </>
        }
      />

      {/* Money cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {money.map((m) => (
          <Link key={m.col} href={`/modules/cost-report?tab=${["E", "G"].includes(m.col) ? "level1" : "level2"}`} className={`card kpi kpi-${m.col} min-w-0 p-4 transition hover:border-accent`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">{m.label}</span>
              <span className="rounded bg-navy/10 px-1 text-[10px] font-bold text-navy">{m.col}</span>
            </div>
            <div className={`mt-1 truncate text-lg font-semibold tnum ${m.signed ? (m.value > 0.004 ? "text-red-700" : m.value < -0.004 ? "text-emerald-700" : "text-ink") : "text-ink"}`} title={formatMoney(m.value)}>
              {formatMoney(m.value)}
            </div>
            {m.sub && (
              <div className="truncate text-xs text-muted" title={m.sub}>
                {m.sub}
              </div>
            )}
          </Link>
        ))}
      </div>

      {/* Count cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/modules/change-management" className="card kpi kpi-blue min-w-0 p-4 transition hover:border-accent">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Open changes by stage</div>
          <div className="mt-2 grid grid-cols-4 gap-1 text-center">
            {d.openStages.map((s) => (
              <div key={s.stage}>
                <div className={`text-lg font-semibold tnum ${s.open ? "text-ink" : "text-muted/60"}`}>{s.open}</div>
                <div className="text-[11px] text-muted">{s.stage}</div>
              </div>
            ))}
          </div>
          <div className="mt-1 text-xs text-muted">{d.openChanges} change(s) open in total</div>
        </Link>
        <Count href="/modules/claims-disputes" label="Open claims" value={d.openClaims} sub={`${formatMoney(d.claimsPendingValue)} claimed and pending`} tone={d.openClaims ? "amber" : "green"} />
        <Count href="/modules/early-warnings" label="Open early warnings" value={d.openEarlyWarnings} sub={`${formatMoney(d.ewOpenValue)} potential cost · ${d.openRisks} open risk(s)`} tone={d.openEarlyWarnings ? "amber" : "green"} />
        <Count
          href="/modules/bonds-insurance"
          label="Bonds & insurance expiring"
          value={d.bonds.expiring.length}
          sub={`${d.bonds.expired} expired · ${d.bonds.red} within 30 days · ${d.bonds.amber} within 60 days`}
          tone={d.bonds.expired + d.bonds.red ? "red" : d.bonds.amber ? "amber" : "green"}
        />
      </div>

      {/* What changed since the last issued report */}
      {movement && <MovementPanel m={movement} />}

      {/* Payment status per contract */}
      {movement && <PaymentTracker rows={movement.payments} previousLabel={movement.previous?.label ?? null} />}

      {/* Commentary + actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KeyIssues periodId={ctx.period?.id ?? null} periodLabel={ctx.period?.label ?? ""} initial={d.keyIssues} canEdit={canEdit} />
        <ActionsList actions={d.actions} canEdit={canEdit} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="card min-w-0 p-5">
          <h2 className="text-sm font-semibold text-ink">Cost report by package</h2>
          <p className="mb-3 text-xs text-muted">Approved Baseline Budget vs Anticipated Final Account, SAR.</p>
          <CostChart data={d.report.chart} />
        </div>
        <div className="card min-w-0 p-5">
          <h2 className="text-sm font-semibold text-ink">Cumulative payments</h2>
          <p className="mb-3 text-xs text-muted">Claimed vs certified vs paid across all contracts, SAR excl. VAT.</p>
          <PaymentChart points={d.payments} />
        </div>
      </div>

      {(d.bonds.expiring.length > 0 || d.bonds.expired > 0) && <ExpiringSoonCard items={d.bonds.expiring} expired={d.bonds.expired} />}
    </div>
  );
}

function Count({ href, label, value, sub, tone }: { href: string; label: string; value: number; sub?: string; tone?: "red" | "amber" | "green" }) {
  const cls = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-ink";
  return (
    <Link href={href} className={`card kpi kpi-${tone ?? "blue"} min-w-0 p-4 transition hover:border-accent`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-lg font-semibold tnum ${cls}`}>{value}</div>
      {sub && (
        <div className="truncate text-xs text-muted" title={sub}>
          {sub}
        </div>
      )}
    </Link>
  );
}
