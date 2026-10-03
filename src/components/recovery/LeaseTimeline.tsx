import Link from "next/link";
import { FileText } from "lucide-react";
import type { RecordRow } from "@/lib/registers/types";
import { formatDate, formatMoney } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";

const money = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : formatMoney(Number(v)));
const date = (v: unknown) => (v ? formatDate(String(v)) : "–");
const doc = (id: unknown) => (id ? `/api/library/contract/${Number(id)}/download` : null);

/**
 * Every lease agreement with its amendments beneath it, in the order they were made: the original
 * terms, then each amendment and what it changed, then the position today. One block per contract,
 * so the story of a lease reads top to bottom instead of across two separate tables.
 */
export function LeaseTimeline({ agreements, amendments }: { agreements: RecordRow[]; amendments: RecordRow[] }) {
  if (!agreements.length) return null;
  const byAgreement = new Map<number, RecordRow[]>();
  for (const a of amendments) {
    const id = Number(a.agreement_id);
    byAgreement.set(id, [...(byAgreement.get(id) ?? []), a]);
  }
  const th = "px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted";
  const td = "px-3 py-1.5 align-top";
  return (
    <div className="space-y-3">
      {agreements.map((a) => {
        const list = [...(byAgreement.get(Number(a.id)) ?? [])].sort((x, y) => Number(x.amendment_no ?? 0) - Number(y.amendment_no ?? 0) || String(x.amendment_date ?? "").localeCompare(String(y.amendment_date ?? "")));
        const tone = a.alerts__tone === "red" ? "border-l-red-400" : a.alerts__tone === "amber" ? "border-l-amber-400" : "border-l-emerald-400";
        return (
          <div key={String(a.id)} className={`card overflow-hidden border-l-4 ${tone}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-slate-50 px-4 py-2">
              <span className="text-sm font-semibold text-ink">{String(a.contractor_id__label ?? "Tenant not matched")}</span>
              <span className="text-xs text-muted">
                works contract {String(a.contract_code ?? "–")} · agreement <span className="font-mono">{String(a.agreement_no ?? "")}</span>
                {a.works_description ? ` · ${String(a.works_description)}` : ""}
              </span>
              <span className="ml-auto inline-flex items-center gap-2">
                {a.lease_status ? <Chip tone={a.lease_status__tone === "red" ? "red" : a.lease_status__tone === "amber" ? "amber" : "green"}>{String(a.lease_status)}</Chip> : null}
                <Chip>{String(a.status ?? "")}</Chip>
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Document</th>
                  <th className={th}>Date</th>
                  <th className={`${th} text-right`}>Term (months)</th>
                  <th className={`${th} text-right`}>Lease fee (SAR)</th>
                  <th className={th}>Expiry</th>
                  <th className={th}>Terms / what changed</th>
                  <th className={th}>File</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line">
                  <td className={`${td} font-medium text-ink`}>Original agreement</td>
                  <td className={td}>{date(a.agreement_date)}</td>
                  <td className={`${td} text-right tnum`}>{String(a.term_months ?? "–")}</td>
                  <td className={`${td} text-right tnum`}>{money(a.lease_fee)}</td>
                  <td className={td}>{date(a.expiry_date)}</td>
                  <td className={`${td} text-xs text-muted`}>
                    Commencement {date(a.commencement_date)}
                    {a.security_deposit ? ` · security deposit ${money(a.security_deposit)}${a.deposit_received ? " (received)" : " (not recorded as received)"}` : ""}
                    {a.rate_worker || a.rate_junior || a.rate_senior || a.rate_executive ? ` · rates: ${[a.rate_worker && `worker ${money(a.rate_worker)}`, a.rate_junior && `junior ${money(a.rate_junior)}`, a.rate_senior && `senior ${money(a.rate_senior)}`, a.rate_executive && `executive ${money(a.rate_executive)}`].filter(Boolean).join(", ")}` : ""}
                    {a.person_nights ? ` · ${String(a.person_nights)} person-nights` : ""}
                  </td>
                  <td className={td}>
                    {doc(a.library_doc_id) ? (
                      <a className="inline-flex items-center gap-1 text-accent hover:underline" href={doc(a.library_doc_id)!} target="_blank" rel="noreferrer">
                        <FileText size={13} /> Agreement
                      </a>
                    ) : (
                      <span className="text-xs text-muted">–</span>
                    )}
                  </td>
                </tr>
                {list.map((m) => (
                  <tr key={String(m.id)} className="border-t border-line bg-sky-50/40">
                    <td className={`${td} pl-6 font-medium text-ink`}>↳ Amendment No {String(m.amendment_no ?? "?")}</td>
                    <td className={td}>{date(m.amendment_date)}</td>
                    <td className={`${td} text-right tnum`}>{m.new_term_months !== null && m.new_term_months !== undefined && m.new_term_months !== "" ? String(m.new_term_months) : <span className="text-muted">unchanged</span>}</td>
                    <td className={`${td} text-right tnum`}>{m.new_fee !== null && m.new_fee !== undefined && m.new_fee !== "" ? money(m.new_fee) : <span className="text-muted">unchanged</span>}</td>
                    <td className={td}>{m.new_expiry ? date(m.new_expiry) : <span className="text-muted">unchanged</span>}</td>
                    <td className={`${td} whitespace-pre-line text-xs text-muted`}>{String(m.changes ?? "")}</td>
                    <td className={td}>
                      {doc(m.library_doc_id) ? (
                        <a className="inline-flex items-center gap-1 text-accent hover:underline" href={doc(m.library_doc_id)!} target="_blank" rel="noreferrer">
                          <FileText size={13} /> Amendment
                        </a>
                      ) : (
                        <span className="text-xs text-muted">–</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line bg-slate-50 font-semibold">
                  <td className={td}>Position today</td>
                  <td className={td}>{list.length ? `${list.length} amendment${list.length === 1 ? "" : "s"}` : "no amendment"}</td>
                  <td className={`${td} text-right tnum`}>{String(a.term_months ?? "–")}</td>
                  <td className={`${td} text-right tnum`}>{money(a.current_fee)}</td>
                  <td className={td}>
                    {date(a.current_expiry)}
                    {a.days_to_expiry !== null && a.days_to_expiry !== undefined ? <span className={`ml-1 text-xs font-normal ${Number(a.days_to_expiry) < 0 ? "text-red-700" : Number(a.days_to_expiry) <= 60 ? "text-amber-700" : "text-muted"}`}>({Number(a.days_to_expiry) < 0 ? `${-Number(a.days_to_expiry)} days ago` : `${String(a.days_to_expiry)} days`})</span> : null}
                  </td>
                  <td className={`${td} text-xs font-normal ${a.alerts__tone === "red" ? "text-red-700" : a.alerts__tone === "amber" ? "text-amber-700" : "text-muted"}`}>
                    {a.alerts ? String(a.alerts) : `Invoiced ${money(a.invoiced_to_date)} · outstanding ${money(a.outstanding)}`}
                    {a.alerts ? ` · invoiced ${money(a.invoiced_to_date)}, outstanding ${money(a.outstanding)}` : ""}
                  </td>
                  <td className={`${td} text-xs font-normal`}>
                    <Link href="/library/contract" className="text-accent hover:underline">
                      Contract Library
                    </Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
