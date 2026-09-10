import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { listReportLibrary } from "@/lib/periods";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReportLibrary } from "@/components/report/ReportLibrary";

export const metadata = { title: "All reports (library)" };

export default async function ReportLibraryPage() {
  const user = (await getCurrentUser())!;
  const rows = listReportLibrary();
  return (
    <div className="space-y-4">
      <Link href="/modules/monthly-report" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={16} /> Monthly Report
      </Link>
      <PageHeader eyebrow="Module 12" title="All reports (library)" subtitle="Every monthly report the dashboard holds: where it came from, whether it is issued, and the tools to open, change, re-upload, lock, unlock or delete it." />
      <ReportLibrary rows={rows} isAdmin={user.role === "admin"} canEdit={user.role === "admin" || user.role === "editor"} />
    </div>
  );
}
