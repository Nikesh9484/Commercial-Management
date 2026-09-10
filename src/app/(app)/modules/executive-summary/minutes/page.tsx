import Link from "next/link";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { PageHeader } from "@/components/ui/PageHeader";
import { RegisterPage } from "@/components/register/RegisterPage";

export const metadata = { title: "Minutes of Meeting" };

export default async function MinutesListPage() {
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  return (
    <div className="space-y-4">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={16} /> Executive Summary
      </Link>
      <PageHeader exportSection="minutes" eyebrow="Module 11" title="Minutes of Meeting" subtitle="One row per meeting. Open the minutes to record items and actions; anything still open is carried forward to the next meeting automatically." />
      {ctx.programme ? (
        <RegisterPage registerKey="meetings" isAdmin={user.role === "admin"} />
      ) : (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      )}
    </div>
  );
}
