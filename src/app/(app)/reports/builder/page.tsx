import { AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { isEditorRole } from "@/lib/registers/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReportBuilder } from "@/components/report-builder/ReportBuilder";

export const metadata = { title: "Customise my reports" };

export default async function BuilderPage() {
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Customise my reports"
        subtitle="Build the report you want: pick the records, filter on any field, choose the columns, group and total them, and take it away as a PDF, an Excel workbook or a written Word summary."
      />
      {ctx.programme ? (
        <ReportBuilder canSave={isEditorRole(user.role)} />
      ) : (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a project in the top bar first.
        </div>
      )}
    </div>
  );
}
