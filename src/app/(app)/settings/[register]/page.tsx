import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getRegisterDef, settingsRegisters } from "@/lib/registers";
import { canViewRegister } from "@/lib/registers/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { RegisterPage } from "@/components/register/RegisterPage";

export async function generateMetadata({ params }: { params: Promise<{ register: string }> }) {
  const { register } = await params;
  return { title: getRegisterDef(register)?.title ?? "Settings" };
}

export default async function SettingsRegisterPage({ params }: { params: Promise<{ register: string }> }) {
  const { register } = await params;
  const def = settingsRegisters.find((d) => d.key === register);
  if (!def) notFound();
  const user = (await getCurrentUser())!;
  if (!canViewRegister(def, user.role)) redirect("/settings");
  return (
    <div>
      <Link href="/settings" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={16} /> Settings
      </Link>
      <PageHeader eyebrow={def.group} title={def.title} subtitle={def.description} />
      {def.key === "reporting_periods" && (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <strong>Month-end:</strong> press <em>Lock</em> on a period to freeze it. The app stores a copy (snapshot) of every module register at that moment so later
          reports can show <em>This Period</em> vs <em>Previous Period</em>. Unlock only if you need to correct something.
        </div>
      )}
      <RegisterPage registerKey={def.key} isAdmin={user.role === "admin"} />
    </div>
  );
}
