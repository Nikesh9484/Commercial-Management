import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, HelpCircle, Lock, Unlock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { listPeriods } from "@/lib/snapshots";
import { getReportData } from "@/lib/report/data";
import { buildCrossAssetReport, type CrossAssetItem, type LeftOut } from "@/lib/report/cross-asset";
import { defaultRulesFor } from "@/lib/report/cross-asset-rules";
import { isEditorRole } from "@/lib/registers/types";
import { MoveTo, RulesPanel, AddEntry } from "@/components/report/CrossAssetControls";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExportButtons } from "@/components/ui/ExportButtons";
import { Chip } from "@/components/ui/Chip";

export const metadata = { title: "Cross-Asset Budget Transfers" };

/**
 * The change entries of one report that move budget between this project and another asset – two separate lists:
 * budget going out of this project to other assets, and budget coming into this project from other assets – with
 * the entries whose funding source is only questioned listed apart, to confirm. Each entry shows the words in the
 * change register that place it there, its value at its furthest stage and whether the transfer is done.
 */
export default async function CrossAssetPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const user = await getCurrentUser();
  const canEdit = !!user && isEditorRole(user.role);
  const ctx = getAppContext();
  const { period: q } = await searchParams;
  const periods = listPeriods();
  const period = periods.find((p) => String(p.id) === q) ?? periods.find((p) => p.id === ctx.period?.id) ?? periods[0] ?? null;
  if (!ctx.programme || !period) {
    return (
      <div className="card flex items-center gap-2 p-5 text-sm text-muted">
        <AlertTriangle size={16} /> {ctx.programme ? "No reporting period exists yet." : "Select a project in the top bar first."}
      </div>
    );
  }
  const r = buildCrossAssetReport(getReportData(ctx.programme.id, period.id));
  const own = r.own.short;
  const assetNames = r.assets.map((a) => a.name);
  const lists = { programmeCode: r.own.code, canEdit, assets: assetNames };
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${ctx.programme.code} · ${period.label}`}
        title="Cross-Asset Budget Transfers"
        subtitle={`Change management entries of this report that need budget moved between ${own} and other assets – budget out of ${own} to other assets, and budget into ${own} from other assets – read from the report's change register, with the words in each entry that place it there.`}
        actions={<ExportButtons section="cross_asset" params={`period=${period.id}`} title="Cross-Asset Budget Transfers" />}
      />

      <div className="card p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Report</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {periods.map((p) => (
            <Link key={p.id} href={`/reports/cross-asset?period=${p.id}`} className={`btn btn-sm ${p.id === period.id ? "btn-primary" : "btn-secondary"}`}>
              {p.status === "Locked" ? <Lock size={12} /> : <Unlock size={12} />} {p.label}
            </Link>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Chip tone={period.status === "Locked" ? "green" : "amber"}>{period.status === "Locked" ? "Issued (locked)" : "Draft – live data"}</Chip> cut-off {formatDate(period.period_end)} · {r.out.length} out · {r.into.length} in · {r.confirm.length} to confirm
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile icon={<ArrowUpRight size={16} />} label={`Budget out of ${own} – to other assets`} value={r.totals.out} count={r.out.length} tone="text-red-700" />
        <Tile icon={<ArrowDownLeft size={16} />} label={`Budget into ${own} – from other assets`} value={r.totals.into} count={r.into.length} tone="text-emerald-700" />
        <Tile icon={<HelpCircle size={16} />} label="To confirm – funding source questioned" value={r.totals.confirm} count={r.confirm.length} tone="text-amber-700" />
      </div>

      {r.byAsset.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <div className="border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">By asset</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-muted">
                <th className="px-3 py-2">Other asset</th>
                <th className="px-3 py-2 text-right">Entries</th>
                <th className="px-3 py-2 text-right">Out of {own}</th>
                <th className="px-3 py-2 text-right">Into {own}</th>
                <th className="px-3 py-2 text-right">Net ({own} gives − receives)</th>
              </tr>
            </thead>
            <tbody>
              {r.byAsset.map((a) => (
                <tr key={a.asset} className="border-t border-line">
                  <td className="px-3 py-1.5">{a.asset}</td>
                  <td className="px-3 py-1.5 text-right tnum">{a.items}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tnum">{money(a.out)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tnum">{money(a.into)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tnum font-semibold">{money(Math.round((a.out - a.into) * 100) / 100)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-navy bg-slate-50 font-semibold text-ink">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tnum">{r.out.length + r.into.length}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tnum">{money(r.totals.out)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tnum">{money(r.totals.into)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tnum">{money(Math.round((r.totals.out - r.totals.into) * 100) / 100)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <RulesPanel programmeCode={r.own.code} projectName={r.own.name} rules={r.rules} defaults={defaultRulesFor(r.own.code)} assets={r.assets} canEdit={canEdit} />
      {canEdit && (
        <div className="card px-4 py-3">
          <AddEntry programmeCode={r.own.code} assets={assetNames} />
        </div>
      )}

      <List {...lists} title={`1. Budget out of ${own} – to other assets`} note={`${own}'s budget goes to another asset: the entry names a transfer from ${own}, or the change sits on another asset's contract code (that asset's contractor works for ${own}).`} items={r.out} total={r.totals.out} empty={`No change entry on this report moves budget out of ${own}.`} />
      <List {...lists} title={`2. Budget into ${own} – from other assets`} note={`Another asset's budget comes to ${own}: the entry names a transfer from another asset, budget to come back, or a transfer back to ${own} for works done for another asset.`} items={r.into} total={r.totals.into} empty={`No change entry on this report moves budget into ${own}.`} />
      <List {...lists} title="3. To confirm – funding source questioned in the entry" note={`The entry questions where the funding comes from, or covers works for another asset under ${own}'s contract with no transfer named. Confirm the direction before a BTR is raised.`} items={r.confirm} total={r.totals.confirm} empty="Nothing to confirm on this report." />
      <LeftOutList items={r.leftOut} {...lists} />
    </div>
  );
}

const money = (v: number | null) => (v === null || Math.abs(v) < 0.005 ? <span className="text-muted">–</span> : formatMoney(v));

function Tile({ icon, label, value, count, tone }: { icon: React.ReactNode; label: string; value: number; count: number; tone: string }) {
  return (
    <div className="card p-4">
      <div className={`flex items-center gap-2 text-xs font-medium ${tone}`}>
        {icon} {label}
      </div>
      <div className="mt-1 text-xl font-semibold tnum text-ink">{formatMoney(value)}</div>
      <div className="text-xs text-muted">
        {count} entr{count === 1 ? "y" : "ies"}
      </div>
    </div>
  );
}

const TRANSFER_TONE: Record<CrossAssetItem["transfer"], "green" | "amber" | "grey" | "red"> = {
  Transferred: "green",
  "BTR raised": "amber",
  "To be transferred": "red",
  "Not stated": "grey",
};

function List({ title, note, items, total, empty, programmeCode, canEdit, assets }: { title: string; note: string; items: CrossAssetItem[]; total: number; empty: string; programmeCode: string; canEdit: boolean; assets: string[] }) {
  return (
    <div className="card overflow-x-auto p-0">
      <div className="border-b border-line bg-slate-50 px-4 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
        <div className="mt-0.5 text-xs text-muted">{note}</div>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">{empty}</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-muted">
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Other asset</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Cost line</th>
              <th className="px-3 py-2">Contractor</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Transfer</th>
              <th className="px-3 py-2">BTR ref</th>
              <th className="px-3 py-2">Rule</th>
              <th className="px-3 py-2">Why it is listed (from the entry)</th>
              {canEdit && <th className="px-3 py-2">Place by hand</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap px-3 py-1.5">
                  <Link href={`/modules/change-management?q=${encodeURIComponent(x.itemNo)}`} className="text-accent hover:underline" title="Open in the change register">
                    {x.itemNo}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 font-medium">{x.otherAsset}</td>
                <td className="min-w-[18rem] max-w-[28rem] px-3 py-1.5">{x.description}</td>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px]">{x.costLine}</td>
                <td className="max-w-[12rem] truncate px-3 py-1.5 text-muted" title={x.contractor}>{x.contractor}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{x.status}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{x.stage}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tnum">{money(x.amount)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <Chip tone={TRANSFER_TONE[x.transfer]}>{x.transfer}</Chip>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">{x.btrRef}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-[11px]">{x.rule}</td>
                <td className="min-w-[16rem] max-w-[24rem] px-3 py-1.5 text-muted">
                  {x.evidence && <span className="italic">“{x.evidence}”</span>} {x.evidence && "– "}
                  {x.basis}
                </td>
                {canEdit && (
                  <td className="px-3 py-1.5">
                    <MoveTo programmeCode={programmeCode} itemNo={x.itemNo} placed={x.rule === "Placed by hand"} asset={x.otherAsset} assets={assets} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-navy bg-slate-50 font-semibold text-ink">
              <td className="px-3 py-2" colSpan={7}>
                Total ({items.length} entr{items.length === 1 ? "y" : "ies"})
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tnum">{money(total)}</td>
              <td className="px-3 py-2" colSpan={canEdit ? 5 : 4} />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

function LeftOutList({ items, programmeCode, canEdit, assets }: { items: LeftOut[]; programmeCode: string; canEdit: boolean; assets: string[] }) {
  if (!items.length) return null;
  const where = { out: "Budget out", into: "Budget in", confirm: "To confirm", none: "–" };
  return (
    <details className="card overflow-x-auto p-0">
      <summary className="cursor-pointer border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
        4. Left out – {items.length} entr{items.length === 1 ? "y" : "ies"} the rules found but did not list (click to see why)
      </summary>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[11px] text-muted">
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Other asset</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2">The rules would place it</th>
            <th className="px-3 py-2">Why it is left out</th>
            {canEdit && <th className="px-3 py-2">Place by hand</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((x) => (
            <tr key={x.id} className="border-t border-line align-top">
              <td className="whitespace-nowrap px-3 py-1.5">
                <Link href={`/modules/change-management?q=${encodeURIComponent(x.itemNo)}`} className="text-accent hover:underline">
                  {x.itemNo}
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">{x.otherAsset}</td>
              <td className="min-w-[18rem] max-w-[28rem] px-3 py-1.5">{x.description}</td>
              <td className="whitespace-nowrap px-3 py-1.5">{x.status}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right tnum">{money(x.amount)}</td>
              <td className="whitespace-nowrap px-3 py-1.5">{where[x.auto]}</td>
              <td className="min-w-[16rem] max-w-[28rem] px-3 py-1.5 text-muted">{x.reason}</td>
              {canEdit && (
                <td className="px-3 py-1.5">
                  <MoveTo programmeCode={programmeCode} itemNo={x.itemNo} placed={x.reason.startsWith("Left out by hand")} asset={x.otherAsset} assets={assets} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
