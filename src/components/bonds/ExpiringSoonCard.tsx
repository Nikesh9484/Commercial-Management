import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { ExpiringItem } from "@/lib/bonds/summary";
import { formatDate } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";

/** Alert card listing bonds / insurances expiring within 60 days (used on the Executive Summary). */
export function ExpiringSoonCard({ items, expired, released = 0, superseded = 0 }: { items: ExpiringItem[]; expired: number; released?: number; superseded?: number }) {
  const red = items.filter((i) => i.tone === "red").length;
  const tone = red > 0 ? "red" : items.length > 0 ? "amber" : "green";
  const border = tone === "red" ? "border-red-200" : tone === "amber" ? "border-amber-200" : "border-emerald-200";
  return (
    <div className={`card min-w-0 border p-5 ${border}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {tone === "green" ? <ShieldCheck size={18} className="text-emerald-600" /> : <ShieldAlert size={18} className={tone === "red" ? "text-red-600" : "text-amber-600"} />}
          Bonds &amp; insurance expiring soon
        </h2>
        <Chip tone={tone}>{items.length === 0 ? "None within 60 days" : `${items.length} within 60 days`}</Chip>
      </div>
      {expired > 0 && <p className="mb-2 text-xs font-medium text-red-700">{expired} already expired on live contracts.</p>}
      {(released > 0 || superseded > 0) && <p className="mb-2 text-xs text-muted">Not counted: {released} released (contract closed), {superseded} superseded by a newer policy.</p>}
      {items.length === 0 ? (
        <p className="text-sm text-muted">No bond or insurance policy expires in the next 60 days.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {items.slice(0, 8).map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-1.5">
              <Chip tone={i.tone}>{i.days < 0 ? `expired ${-i.days}d` : `${i.days}d`}</Chip>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-ink">{i.ref}</span> · {i.type} · {i.contractor}
              </span>
              <span className="tnum shrink-0 text-xs text-muted">{formatDate(i.expiry_date)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/modules/bonds-insurance" className="mt-3 inline-block text-xs text-accent hover:underline">
        Open the Bonds &amp; Insurance log →
      </Link>
    </div>
  );
}
