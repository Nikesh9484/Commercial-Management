import Link from "next/link";
import { ArrowRight, TrendingUp, PlusCircle, MinusCircle, RefreshCw } from "lucide-react";
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
      <div className="card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <TrendingUp size={16} className="text-navy" /> Movement since the last issued report
        </h2>
        <p className="mt-1 text-sm text-muted">No earlier locked report yet. Import or enter the previous months in date order and lock each one; this panel then shows every change, month on month.</p>
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
