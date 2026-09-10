import Link from "next/link";
import { ArrowRight, TrendingUp, PlusCircle, MinusCircle, RefreshCw, ListChecks, Hourglass } from "lucide-react";
import type { Movement, MoveItem } from "@/lib/dashboard/movement";
import { formatMoney } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";
import { ExportButtons } from "@/components/ui/ExportButtons";

const KPI_LABELS: Record<string, string> = {
  E: "Approved Budget",
  F: "Budget Transfers",
  G: "Latest Budget",
  H: "Determined VOs",
  I: "Committed",
  J: "Potential VOs",
  K: "RFCs",
  L: "Early Warnings",
  M: "Claims",
  N: "Anticipated Final Account",
  O: "Variance to Budget",
  P: "Certified to Date",
  Q: "Works to Complete",
};

function Delta({ value, invert }: { value: number; invert?: boolean }) {
  if (Math.abs(value) < 0.005) return <span className="text-muted">–</span>;
  const good = invert ? value < 0 : value > 0;
  return <span className={`font-semibold tnum ${good ? "text-emerald-700" : "text-red-700"}`}>{value > 0 ? "+" : ""}{formatMoney(value)}</span>;
}

function ItemLine({ it, kind }: { it: MoveItem; kind: "added" | "removed" | "changed" }) {
  const Icon = kind === "added" ? PlusCircle : kind === "removed" ? MinusCircle : RefreshCw;
  const color = kind === "added" ? "text-emerald-600" : kind === "removed" ? "text-red-600" : "text-sky-600";
  return (
    <li className="flex items-start gap-2 py-1 text-xs">
      <Icon size={13} className={`mt-0.5 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1">
        <span className="font-semibold text-ink">{it.key}</span> <span className="text-ink/80">{it.title}</span>
        <div className="text-[11px] text-muted">
          {kind === "changed" && it.from && it.to && it.from !== it.to && (
            <span className="mr-2 inline-flex items-center gap-1">
              {it.from} <ArrowRight size={10} /> <span className="font-medium text-ink">{it.to}</span>
            </span>
          )}
          {kind !== "changed" && it.to && <span className="mr-2">{it.to}</span>}
          {kind === "changed" && typeof it.delta === "number" && Math.abs(it.delta) > 0.5 && <Delta value={it.delta} />}
          {kind !== "changed" && typeof it.amount === "number" && Math.abs(it.amount) > 0.5 && <span className="tnum">{formatMoney(it.amount)}</span>}
        </div>
      </div>
    </li>
  );
}

/** "What changed since the last issued report" – shown on the Executive Summary and printed in the report. */
export function MovementPanel({ m }: { m: Movement }) {
  if (!m.previous) {
    return (
      <div className="space-y-4">
        <div className="card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <TrendingUp size={16} className="text-navy" /> Movement since the last issued report
          </h2>
          <p className="mt-1 text-sm text-muted">No earlier locked report yet. Import or enter the previous months in date order and lock each one; this panel then shows every change, month on month.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <StatusCounts m={m} />
          <DvoAgeing m={m} />
        </div>
      </div>
    );
  }
  const LIMIT = 8;
  return (
    <div className="space-y-4">
      <div className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-gradient-to-r from-navy to-[#1f4f8f] px-5 py-3 text-white">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp size={16} /> Movement since {m.previous.label}
          </h2>
          <span className="flex items-center gap-3 text-xs text-blue-100">
            {m.previous.label} <ArrowRight size={11} className="inline" /> {m.current.label}
            <ExportButtons section="movement" />
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="data w-full">
            <thead>
              <tr>
                <th>Cost report</th>
                <th className="text-right">Previous ({m.previous.label})</th>
                <th className="text-right">This report</th>
                <th className="text-right">Movement</th>
              </tr>
            </thead>
            <tbody>
              {m.kpis.map((k) => (
                <tr key={k.key} className={["N", "O"].includes(k.key) ? "bg-blue-50/60 font-semibold" : ""}>
                  <td>
                    <span className="mr-2 rounded bg-navy/10 px-1 text-[10px] font-bold text-navy">{k.key}</span>
                    {KPI_LABELS[k.key] ?? k.label}
                  </td>
                  <td className="tnum text-right text-muted">{formatMoney(k.prev)}</td>
                  <td className="tnum text-right">{formatMoney(k.now)}</td>
                  <td className="text-right">
                    <Delta value={k.delta} invert={["N", "O", "H", "J", "K", "L", "M", "Q"].includes(k.key)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-ink">Changes by stage</h3>
        <p className="mb-2 text-xs text-muted">Open changes at each stage and the cost-report amount they carry, previous report vs this one.</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {m.stages.map((s) => (
            <div key={s.stage} className="rounded-xl border border-line bg-gradient-to-b from-white to-slate-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">{s.stage}</span>
                <Chip tone={s.nowCount > s.prevCount ? "amber" : s.nowCount < s.prevCount ? "green" : "grey"}>
                  {s.prevCount} → {s.nowCount}
                </Chip>
              </div>
              <div className="mt-1 text-base font-semibold tnum text-ink">{formatMoney(s.nowAmount)}</div>
              <div className="text-[11px] text-muted">
                was {formatMoney(s.prevAmount)} · <Delta value={r2(s.nowAmount - s.prevAmount)} invert />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Key period movements per cost-report column – the items that make up each column's movement */}
      <div className="card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ListChecks size={15} className="text-navy" /> Key period movements
        </h3>
        <p className="mb-3 text-xs text-muted">The changes, early warnings and claims that moved each cost-report column since {m.previous.label}. The items in each box add up to that column&apos;s movement above.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {m.keyMovements.map((k) => {
            const tie = Math.abs(k.itemsTotal - k.kpiDelta) < 0.5;
            return (
              <div key={k.col} className="flex min-w-0 flex-col rounded-xl border border-line bg-gradient-to-b from-white to-slate-50">
                <div className="flex items-center justify-between gap-2 rounded-t-xl border-b border-line bg-navy/5 px-3 py-2">
                  <Link href={k.href} className="flex min-w-0 items-center gap-2 text-xs font-semibold text-ink hover:text-accent">
                    <span className="rounded bg-navy px-1.5 text-[10px] font-bold text-white">{k.col}</span>
                    <span className="truncate">{k.label}</span>
                  </Link>
                  <Delta value={k.kpiDelta} invert />
                </div>
                {k.items.length ? (
                  <ul className="divide-y divide-line/70 px-3">
                    {k.items.slice(0, 10).map((it) => (
                      <li key={it.key} className="flex items-start justify-between gap-2 py-1.5 text-xs">
                        <div className="min-w-0">
                          <span className="font-semibold text-ink">{it.key}</span> <span className="text-ink/80">{it.title}</span>
                          <div className="text-[11px] text-muted">{it.note}</div>
                        </div>
                        <Delta value={it.delta} invert />
                      </li>
                    ))}
                    {k.items.length > 10 && (
                      <li className="py-1 text-[11px] text-muted">
                        … {k.items.length - 10} more. <Link href={k.href} className="text-accent hover:underline">Open the module</Link>.
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="px-3 py-3 text-xs text-muted">No movement.</p>
                )}
                <div className="mt-auto flex items-center justify-between gap-2 rounded-b-xl border-t border-line px-3 py-1.5 text-[11px] text-muted">
                  <span>Items total</span>
                  <span className="flex items-center gap-2">
                    <span className="tnum font-medium text-ink">{formatMoney(k.itemsTotal)}</span>
                    {!tie && (
                      <Chip tone="amber" className="text-[10px]">
                        differs by {formatMoney(r2(k.kpiDelta - k.itemsTotal))}
                      </Chip>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {m.keyMovements.some((k) => Math.abs(k.itemsTotal - k.kpiDelta) >= 0.5) && (
          <p className="mt-2 text-[11px] text-muted">A difference means some of the column&apos;s movement is not explained by a listed item, for example a change that is not linked to a cost report line, or a budget-hold line absorbing part of it.</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <StatusCounts m={m} />
        <DvoAgeing m={m} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {m.groups.map((g) => {
          const quiet = !g.added.length && !g.removed.length && !g.changed.length;
          return (
            <div key={g.key} className={`card min-w-0 p-5 ${quiet ? "opacity-80" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={g.href} className="text-sm font-semibold text-ink hover:text-accent">
                  {g.label}
                </Link>
                <div className="flex flex-wrap gap-1.5">
                  <Chip tone="grey">{g.prevCount} → {g.nowCount} rows</Chip>
                  {g.added.length > 0 && <Chip tone="green">+{g.added.length} new</Chip>}
                  {g.changed.length > 0 && <Chip tone="amber">{g.changed.length} updated</Chip>}
                  {g.removed.length > 0 && <Chip tone="red">{g.removed.length} removed</Chip>}
                </div>
              </div>
              <div className="mt-1 text-xs text-muted">
                {g.valueLabel}: {formatMoney(g.prevValue)} <ArrowRight size={10} className="inline" /> <span className="font-medium text-ink tnum">{formatMoney(g.nowValue)}</span> (<Delta value={r2(g.nowValue - g.prevValue)} invert={["changes", "claims", "early_warnings", "risks"].includes(g.key)} />)
              </div>
              {quiet ? (
                <p className="mt-2 text-xs text-muted">No movement.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line/70">
                  {g.added.slice(0, LIMIT).map((it) => (
                    <ItemLine key={"a" + it.key} it={it} kind="added" />
                  ))}
                  {g.changed.slice(0, LIMIT).map((it) => (
                    <ItemLine key={"c" + it.key} it={it} kind="changed" />
                  ))}
                  {g.removed.slice(0, LIMIT).map((it) => (
                    <ItemLine key={"r" + it.key} it={it} kind="removed" />
                  ))}
                  {g.added.length + g.changed.length + g.removed.length > LIMIT * 3 && (
                    <li className="py-1 text-[11px] text-muted">
                      … and more. <Link href={g.href} className="text-accent hover:underline">Open the module</Link> for the full list.
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function r2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function Pair({ prev, now, hasPrev }: { prev: number; now: number; hasPrev: boolean }) {
  return (
    <span className="tnum">
      {hasPrev && <span className="text-muted">{prev} → </span>}
      <span className={`font-semibold ${now ? "text-ink" : "text-muted/60"}`}>{now}</span>
      {hasPrev && now !== prev && <span className={`ml-1 text-[10px] ${now > prev ? "text-amber-700" : "text-emerald-700"}`}>({now > prev ? "+" : ""}{now - prev})</span>}
    </span>
  );
}

/** Approved / pending / cancelled counts per stage, previous report vs this one. */
function StatusCounts({ m }: { m: Movement }) {
  const hasPrev = !!m.previous;
  return (
    <div className="card p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <ListChecks size={15} className="text-navy" /> Change management status
      </h3>
      <p className="mb-2 text-xs text-muted">How many changes have reached each stage, and their outcome{hasPrev ? ` (${m.previous!.label} → this report)` : ""}.</p>
      <div className="overflow-x-auto">
        <table className="data w-full">
          <thead>
            <tr>
              <th>Stage</th>
              <th className="text-right">Total</th>
              <th className="text-right">Approved</th>
              <th className="text-right">Pending</th>
              <th className="text-right">Cancelled</th>
            </tr>
          </thead>
          <tbody>
            {m.statusCounts.map((s) => (
              <tr key={s.stage}>
                <td className="font-medium">{s.stage}</td>
                <td className="text-right"><Pair prev={s.total.prev} now={s.total.now} hasPrev={hasPrev} /></td>
                <td className="text-right"><Pair prev={s.approved.prev} now={s.approved.now} hasPrev={hasPrev} /></td>
                <td className="text-right"><Pair prev={s.pending.prev} now={s.pending.now} hasPrev={hasPrev} /></td>
                <td className="text-right"><Pair prev={s.cancelled.prev} now={s.cancelled.now} hasPrev={hasPrev} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Pending DVOs by how long they have been waiting at the cut-off date. */
function DvoAgeing({ m }: { m: Movement }) {
  const hasPrev = !!m.previous;
  const total = m.dvoAgeing.reduce((t, b) => t + b.now, 0);
  const tones: Record<string, string> = { green: "border-emerald-200 bg-emerald-50", amber: "border-amber-200 bg-amber-50", red: "border-red-200 bg-red-50", grey: "border-line bg-slate-50" };
  return (
    <div className="card p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Hourglass size={15} className="text-navy" /> DVO ageing
      </h3>
      <p className="mb-2 text-xs text-muted">{total} determined variation order(s) still pending, by days since the DVO was raised{hasPrev ? ` (${m.previous!.label} → this report)` : ""}.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {m.dvoAgeing.map((b) => (
          <div key={b.bucket} className={`rounded-xl border p-3 text-center ${tones[b.tone]}`}>
            <div className="text-lg font-semibold tnum text-ink">
              {hasPrev && <span className="mr-1 text-sm font-normal text-muted">{b.prev} →</span>}
              {b.now}
            </div>
            <div className="text-[11px] text-muted">{b.bucket}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
