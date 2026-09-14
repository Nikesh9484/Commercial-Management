"use client";

import { ShieldAlert, ShieldCheck, Clock } from "lucide-react";
import type { RecordRow } from "@/lib/registers/types";
import { filterBonds, type BondsExpiry } from "@/lib/bonds/filter";
import { formatDate, formatMoney } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";
import { ExportButtons } from "@/components/ui/ExportButtons";

/**
 * The two lists the team chases every month, each with its own downloads: what has already expired,
 * and what runs out within the next 30 days. Both are grouped by contractor, because the chase is one
 * conversation per contractor rather than one per policy, and both leave out bonds whose contract is
 * closed or that a newer policy has replaced – the same rule the rest of the page follows.
 */
export function BondsAlertSummaries({ rows, hasPeriod }: { rows: RecordRow[]; hasPeriod: boolean }) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Summary
        rows={rows}
        hasPeriod={hasPeriod}
        bucket="expired"
        title="Expired bonds & insurance"
        blurb="Past the expiry date with the contract still live. Chase a replacement or confirm the contract is closed."
        empty="Nothing has expired on a live contract."
        tone="red"
      />
      <Summary
        rows={rows}
        hasPeriod={hasPeriod}
        bucket="d30"
        title="Expiring within 30 days"
        blurb="Still in force, but runs out inside the next 30 days. Renewals are usually asked for now."
        empty="Nothing expires in the next 30 days."
        tone="amber"
      />
    </div>
  );
}

interface Group {
  contractor: string;
  items: RecordRow[];
}

function Summary({
  rows,
  hasPeriod,
  bucket,
  title,
  blurb,
  empty,
  tone,
}: {
  rows: RecordRow[];
  hasPeriod: boolean;
  bucket: Extract<BondsExpiry, "expired" | "d30">;
  title: string;
  blurb: string;
  empty: string;
  tone: "red" | "amber";
}) {
  const items = filterBonds(rows, { expiry: bucket, category: "all" }).sort((a, b) => Number(a.days_to_expiry ?? 0) - Number(b.days_to_expiry ?? 0));

  const groups: Group[] = [];
  for (const r of items) {
    const name = String(r.contractor_id__label ?? "(no contractor)");
    const g = groups.find((x) => x.contractor === name);
    if (g) g.items.push(r);
    else groups.push({ contractor: name, items: [r] });
  }
  groups.sort((a, b) => b.items.length - a.items.length || a.contractor.localeCompare(b.contractor));

  const provided = items.reduce((t, r) => t + Number(r.amount_provided ?? 0), 0);
  const none = items.length === 0;
  const border = none ? "border-emerald-200" : tone === "red" ? "border-red-200" : "border-amber-200";

  return (
    <div className={`card min-w-0 border p-5 ${border}`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {none ? <ShieldCheck size={18} className="text-emerald-600" /> : tone === "red" ? <ShieldAlert size={18} className="text-red-600" /> : <Clock size={18} className="text-amber-600" />}
          {title}
          <Chip tone={none ? "green" : tone}>{items.length}</Chip>
        </h2>
        {hasPeriod && <ExportButtons section="bonds_report" params={`bondsExpiry=${bucket}`} title={title} />}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted">{blurb}</p>

      {none ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">
            {items.length} item(s) across {groups.length} contractor(s) · {formatMoney(provided)} of cover
          </p>
          <div className="max-h-96 overflow-y-auto pr-1">
            {groups.map((g) => (
              <div key={g.contractor} className="mb-2 last:mb-0">
                <div className="flex items-baseline justify-between gap-2 border-b border-line pb-0.5">
                  <span className="min-w-0 truncate text-xs font-semibold text-ink">{g.contractor}</span>
                  <span className="shrink-0 text-[11px] text-muted">{g.items.length}</span>
                </div>
                <ul className="divide-y divide-line/70 text-sm">
                  {g.items.map((r) => {
                    const days = Number(r.days_to_expiry ?? 0);
                    return (
                      <li key={String(r.id)} className="flex items-center gap-2 py-1">
                        <Chip tone={tone}>{days < 0 ? `expired ${-days}d` : `${days}d`}</Chip>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium text-ink">{String(r.ref ?? "")}</span> · {String(r.type_id__label ?? "")}
                        </span>
                        <span className="tnum shrink-0 text-xs text-muted">{formatDate(String(r.expiry_date ?? ""))}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
