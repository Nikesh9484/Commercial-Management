import { AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { listCases, canUseEar } from "@/lib/ear/store";
import { engineConfigured } from "@/lib/ear/generate";
import { PageHeader } from "@/components/ui/PageHeader";
import { EarCaseList } from "@/components/ear/EarCaseList";

export const metadata = { title: "Claim EAR – Employer's Assessment Report" };

export default async function ClaimEarPage() {
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  const allowed = canUseEar(user);
  const cases = allowed ? listCases(ctx.programme?.id ?? null) : [];
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Automation"
        title="Claim EAR – Employer's Assessment Report"
        subtitle="Upload the contractor's claim folder, your EAR template and the contract documents; the dashboard writes the Employer's Assessment Report as a print-ready Word file. For a revised submission it also takes the previous EAR and previous submission, and writes the new report with tracked changes."
      />
      {!allowed ? (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Only Editors and Admins can use the Claim EAR automation.
        </div>
      ) : (
        <>
          {!engineConfigured() && (
            <div className="card border-l-4 border-l-amber-500 p-4 text-sm">
              <b>Drafting engine not configured.</b> Add <code>ANTHROPIC_API_KEY</code> in the hosting settings (Render → Environment) to have the full report written; until then Create EAR produces a skeleton laid out from your template.
            </div>
          )}
          <EarCaseList cases={cases.map((c) => ({ ...c, output_json: null }))} isAdmin={user.role === "admin"} />
        </>
      )}
    </div>
  );
}
