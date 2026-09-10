import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { settingsRegisters } from "@/lib/registers";
import { canViewRegister, canEditRegister } from "@/lib/registers/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { getDb } from "@/lib/db";
import { backupStatus } from "@/lib/cloud-backup";
import { BackupCard } from "@/components/settings/BackupCard";
import { StartOverCard } from "@/components/settings/StartOverCard";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = (await getCurrentUser())!;
  const db = getDb();
  const groups = new Map<string, typeof settingsRegisters>();
  for (const def of settingsRegisters) {
    if (!canViewRegister(def, user.role)) continue;
    const g = def.group ?? "Other";
    groups.set(g, [...(groups.get(g) ?? []), def]);
  }
  return (
    <div>
      <PageHeader
        title={user.role === "admin" ? "Settings" : "Reference data"}
        subtitle={
          user.role === "admin"
            ? "Dropdown lists, project structure, reporting periods and users. Every list supports add / edit / delete, search, Excel import & export and change history."
            : "The dropdown lists used across the modules. Only an Admin can change them."
        }
      />
      <div className="space-y-6">
        {user.role === "admin" && <BackupCard status={backupStatus()} />}
        {[...groups.entries()].map(([group, defs]) => (
          <section key={group}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{group}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {defs.map((def) => {
                const n = (db.prepare(`SELECT COUNT(*) AS n FROM "${def.table}"`).get() as { n: number }).n;
                return (
                  <Link key={def.key} href={`/settings/${def.key}`} className="card group flex items-start gap-3 p-4 transition hover:border-accent">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-ink">{def.title}</span>
                        <Chip tone="grey">{n}</Chip>
                        {!canEditRegister(def, user.role) && <Chip tone="blue">view only</Chip>}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">{def.description}</span>
                    </span>
                    <ArrowRight size={16} className="mt-1 shrink-0 text-muted transition group-hover:text-accent" />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
        {user.role === "admin" && <StartOverCard />}
      </div>
    </div>
  );
}
