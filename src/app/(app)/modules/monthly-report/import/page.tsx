import Link from "next/link";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { listPeriods } from "@/lib/snapshots";
import { getRegisterDef } from "@/lib/registers";
import { IMPORTABLE } from "@/lib/workbook/analyze";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorkbookImporter } from "@/components/workbook/WorkbookImporter";

export const metadata = { title: "Import monthly workbook" };

export default async function ImportWorkbookPage() {
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  const periods = listPeriods().map((p) => ({ id: p.id, label: p.label, status: p.status, report_no: p.report_no }));
  const registers = IMPORTABLE.map((i) => {
    const def = getRegisterDef(i.key)!;
    return { key: i.key, label: i.label, fields: def.fields.filter((f) => !f.virtual && !f.readonly && f.type !== "password" && f.key !== "programme_id").map((f) => {
      // Give generic labels their section so "Date" reads "RFC – Request for Change · Date"
      const generic = /^(date|ref|status|cost \(sar\)|eot \(days\)|compensable days|amount|value|reference no|reference)$/i.test(f.label.trim()) || f.label.length <= 5;
      const section = f.section && f.section !== def.fields[0]?.section && !/details$/i.test(f.section) ? f.section : null;
      return { key: f.key, label: section && generic ? `${section} · ${f.label}` : f.label, required: f.required };
    }) };
  });
  const nextNo = (periods[0]?.report_no ?? 0) + 1;
  return (
    <div className="space-y-4">
      <Link href="/modules/monthly-report" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={16} /> Monthly Report
      </Link>
      <PageHeader eyebrow="Module 12" title="Import monthly workbook" subtitle="Upload one of your Excel monthly reports and the app records it against a reporting period. Import past months in date order, locking each one, to build the history; then each new month shows its movement against the last." />
      {!ctx.programme ? (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      ) : user.role === "viewer" ? (
        <div className="card p-5 text-sm text-muted">Only Editors and Admins can import.</div>
      ) : (
        <WorkbookImporter registers={registers} periods={periods} isAdmin={user.role === "admin"} defaultReportNo={nextNo} />
      )}
    </div>
  );
}
