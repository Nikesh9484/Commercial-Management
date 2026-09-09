import { Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getModule } from "@/lib/modules";
import { getChecklist, ensureDefaultTeam } from "@/lib/checklist";
import { lookupOptions } from "@/lib/registers/engine";
import { PageHeader } from "@/components/ui/PageHeader";
import { RegisterPage } from "@/components/register/RegisterPage";
import { ProjectParticularsCard, type Particulars } from "@/components/project-setup/ProjectParticularsCard";
import { ReportControlCard, type PeriodControl } from "@/components/project-setup/ReportControlCard";
import { ChecklistCard } from "@/components/project-setup/ChecklistCard";

export const metadata = { title: "Project Setup & Report Control" };

export default async function ProjectSetupPage() {
  const user = (await getCurrentUser())!;
  const mod = getModule("project-setup")!;
  const ctx = getAppContext();
  const db = getDb();

  const programme = ctx.programme
    ? (db.prepare("SELECT id, code, name, client_id, location_id, description FROM programmes WHERE id = ?").get(ctx.programme.id) as Particulars["programme"])
    : null;
  const asset = ctx.asset ? (db.prepare("SELECT id, code, name, description FROM assets WHERE id = ?").get(ctx.asset.id) as Particulars["asset"]) : null;
  const clients = lookupOptions(db, "clients", true);
  const locations = lookupOptions(db, "locations", true);
  const particulars: Particulars = {
    programme,
    asset,
    clientName: clients.find((c) => c.id === programme?.client_id)?.label ?? "",
    locationName: locations.find((c) => c.id === programme?.location_id)?.label ?? "",
    clients,
    locations,
  };

  const period = ctx.period ? (db.prepare("SELECT * FROM reporting_periods WHERE id = ?").get(ctx.period.id) as PeriodControl) : null;
  const checklist = period ? getChecklist(period.id) : [];
  if (programme) ensureDefaultTeam(programme.id);

  const canEdit = user.role !== "viewer";
  const isAdmin = user.role === "admin";

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={`Module ${mod.no}`} title={mod.title} subtitle="The cover, index and data-input sheet of the monthly report: who, what and which period." />

      <div className="grid gap-5 lg:grid-cols-2">
        <ProjectParticularsCard data={particulars} canEdit={isAdmin} />
        <ReportControlCard period={period} canEdit={canEdit} isAdmin={isAdmin} />
      </div>

      {period ? (
        <ChecklistCard items={checklist} canEdit={canEdit} periodLabel={period.label} />
      ) : (
        <div className="card p-5 text-sm text-muted">Add a reporting period to start the report checklist.</div>
      )}

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-ink">
          <Users size={18} className="text-navy" /> Distribution &amp; project team
        </h2>
        <p className="mb-3 text-xs text-muted">
          One list per programme{programme ? ` (${programme.code})` : ""}. Standard roles are pre-filled; add the names, change the order, or add extra recipients.
        </p>
        {programme ? <RegisterPage registerKey="project_team" isAdmin={isAdmin} /> : <div className="card p-5 text-sm text-muted">Select a programme in the top bar first.</div>}
      </section>
    </div>
  );
}
