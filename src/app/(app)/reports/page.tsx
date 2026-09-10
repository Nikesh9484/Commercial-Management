import Link from "next/link";
import { AlertTriangle, FileDown, FileSpreadsheet, BookOpen, Lock, Unlock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { listPeriods } from "@/lib/snapshots";
import { REPORT_SCHEDULES } from "@/lib/report/schedules";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";

export const metadata = { title: "Reports & downloads" };

/** Every report the dashboard produces, for one reporting period, as PDF and Excel. The only page a "Reports only" user sees. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  const { period: q } = await searchParams;
  const periods = listPeriods();
  const period = periods.find((p) => String(p.id) === q) ?? periods.find((p) => p.id === ctx.period?.id) ?? periods[0] ?? null;
  const pid = period ? `&period=${period.id}` : "";
  const item = (section: string, title: string, note: string) => ({ section, title, note });
  const groups: { heading: string; items: { section: string; title: string; note: string }[] }[] = [
    {
      heading: "Summaries",
      items: [
        item("exec", "Executive Summary", "Headline figures, open items, payment tracker, key issues and actions"),
        item("movement", "Movement since the previous report", "Cost report movement, key period movements, status counts, register changes"),
        item("claims_report", "Claims Status Report", "Executive claims report with narrative"),
        item("fa_report", "Final Account Status Report", "Executive final account report with narrative"),
        item("minutes", "Minutes of Meeting", "Meetings and actions of the period"),
      ],
    },
    {
      heading: "Schedules",
      items: REPORT_SCHEDULES.map((s) => item(s.letter, `Schedule ${s.letter} – ${s.title}`, s.special === "cost_l1" ? "Asset × category summary" : s.special === "cost_l2" ? "Line by line cost report" : s.special === "cashflow" ? "Monthly forecast vs actual" : "Register as printed in the monthly report")),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${ctx.programme?.code ?? ""}${ctx.asset ? ` · ${ctx.asset.code}` : ""}`}
        title="Reports & downloads"
        subtitle={user.role === "reporter" ? "Choose the month, then download any report as a print-ready PDF or a formatted Excel file." : "Every report for one month in one place, as PDF or Excel."}
      />
      {!ctx.programme || !period ? (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> {ctx.programme ? "No reporting period exists yet." : "No programme has been set up yet."}
        </div>
      ) : (
        <>
          <div className="card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">Reporting period</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {periods.map((p) => (
                <Link key={p.id} href={`/reports?period=${p.id}`} className={`btn btn-sm ${p.id === period.id ? "btn-primary" : "btn-secondary"}`}>
                  {p.status === "Locked" ? <Lock size={12} /> : <Unlock size={12} />} {p.label}
                </Link>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted">
              <Chip tone={period.status === "Locked" ? "green" : "amber"}>{period.status === "Locked" ? "Issued (locked)" : "Draft – live data"}</Chip> cut-off {formatDate(period.period_end)}
            </div>
          </div>

          <div className="card overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-gradient-to-r from-navy to-[#1f4f8f] px-5 py-3 text-white">
              <h2 className="text-sm font-semibold">Full monthly report – {period.label}</h2>
              <span className="inline-flex gap-1.5">
                <a className="btn btn-sm btn-pdf" href={`/api/report?format=pdf&period=${period.id}`}>
                  <FileDown size={14} /> PDF
                </a>
                <a className="btn btn-sm btn-excel" href={`/api/report?format=xlsx&period=${period.id}`}>
                  <FileSpreadsheet size={14} /> Excel
                </a>
              </span>
            </div>
            <p className="px-5 py-3 text-xs text-muted">Cover, index, minutes, executive summary, movement and Schedules A to J in one file.</p>
          </div>

          {groups.map((g) => (
            <div key={g.heading} className="card overflow-hidden p-0">
              <div className="border-b border-line bg-slate-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.heading}</div>
              <ul className="divide-y divide-line">
                {g.items.map((it) => (
                  <li key={it.section} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">{it.title}</div>
                      <div className="text-xs text-muted">{it.note}</div>
                    </div>
                    <span className="inline-flex gap-1.5">
                      <a className="btn btn-sm btn-pdf" href={`/api/export?section=${encodeURIComponent(it.section)}&format=pdf${pid}`}>
                        <FileDown size={14} /> PDF
                      </a>
                      <a className="btn btn-sm btn-excel" href={`/api/export?section=${encodeURIComponent(it.section)}&format=xlsx${pid}`}>
                        <FileSpreadsheet size={14} /> Excel
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <a href="/user-guide.pdf" target="_blank" rel="noopener" className="card flex items-center gap-3 p-4 text-sm text-ink hover:border-accent">
            <BookOpen size={18} className="text-navy" /> User guide (PDF)
          </a>
        </>
      )}
    </div>
  );
}
