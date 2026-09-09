import Link from "next/link";
import { ArrowRight, Lock, Unlock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { modules } from "@/lib/modules";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { getDb } from "@/lib/db";

export default async function HomePage() {
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  const db = getDb();
  const counts = {
    packages: (db.prepare("SELECT COUNT(*) AS n FROM packages WHERE active = 1").get() as { n: number }).n,
    contractors: (db.prepare("SELECT COUNT(*) AS n FROM contractors WHERE active = 1").get() as { n: number }).n,
    users: (db.prepare("SELECT COUNT(*) AS n FROM users WHERE active = 1").get() as { n: number }).n,
  };

  return (
    <div>
      <PageHeader
        eyebrow={ctx.programme ? `${ctx.programme.code} · ${ctx.asset?.code ?? ""}` : undefined}
        title={`Welcome, ${user.name.split(" ")[0]}`}
        subtitle="Your monthly commercial report, one module at a time."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Programme" value={ctx.programme?.name ?? "Not set"} sub={ctx.programme?.code} />
        <Stat label="Asset" value={ctx.asset?.name ?? "Not set"} sub={ctx.asset?.code} />
        <Stat
          label="Reporting period"
          value={ctx.period?.label ?? "Not set"}
          sub={ctx.period ? `Cut-off ${formatDate(ctx.period.period_end)}` : undefined}
          chip={
            ctx.period ? (
              <Chip tone={ctx.period.status === "Locked" ? "green" : "amber"}>
                {ctx.period.status === "Locked" ? <Lock size={11} className="mr-1" /> : <Unlock size={11} className="mr-1" />}
                {ctx.period.status}
              </Chip>
            ) : undefined
          }
        />
        <Stat label="Reference data" value={`${counts.packages} packages · ${counts.contractors} contractors`} sub={`${counts.users} active user(s)`} />
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Modules</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {modules.map((m) => (
          <Link key={m.slug} href={`/modules/${m.slug}`} className="card group flex items-start gap-3 p-4 transition hover:border-accent">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-navy/5 text-sm font-semibold text-navy">{m.no}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-ink">{m.title}</span>
              <span className="mt-0.5 block text-xs text-muted">{m.description}</span>
            </span>
            <ArrowRight size={16} className="mt-1 shrink-0 text-muted transition group-hover:text-accent" />
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, chip }: { label: string; value: string; sub?: string; chip?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
        {chip}
      </div>
      <div className="mt-1 truncate text-base font-semibold text-ink" title={value}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
