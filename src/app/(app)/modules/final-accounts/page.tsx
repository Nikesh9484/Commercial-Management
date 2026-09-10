import { AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getRegisterDef } from "@/lib/registers";
import { listRecords } from "@/lib/registers/engine";
import { formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { RegisterPage } from "@/components/register/RegisterPage";

export const metadata = { title: "Final Account Status" };

export default async function FinalAccountsPage() {
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  const rows = ctx.programme ? listRecords(getRegisterDef("final_accounts")!) : [];
  const by = (status: string) => rows.filter((r) => r.status === status);
  const sum = (list: typeof rows) => list.reduce((t, r) => t + Number(r.afa ?? 0), 0);
  const open = by("Open");
  const closed = by("Closed");
  const notReq = rows.filter((r) => r.status === "Not Required" || r.status === "Direct Payment – No FA");
  const overdue = open.filter((r) => typeof r.days_remaining === "number" && (r.days_remaining as number) < 0).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Module 8"
        title="Final Account Status"
        subtitle="One row per contract: is the final account statement open, signed or not required, and when is closure expected. Committed cost and the anticipated final account are read from the cost report line, so the totals tie to Schedule B."
      />
      {ctx.programme ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Open" value={String(open.length)} sub={`${formatMoney(sum(open))} anticipated final account · ${overdue} past forecast date`} tone={overdue ? "red" : open.length ? "amber" : "green"} />
            <Stat label="Closed (FAS signed)" value={String(closed.length)} sub={`${formatMoney(sum(closed))} anticipated final account`} tone="green" />
            <Stat label="Not required / direct payment" value={String(notReq.length)} sub={`${formatMoney(sum(notReq))} anticipated final account`} />
            <Stat label="Total packages" value={String(rows.length)} sub={`${formatMoney(sum(rows))} total anticipated final account`} />
          </div>
          <p className="text-xs text-muted">Days remaining turn amber within 60 days of the forecast closure date and red once it has passed (open final accounts only). Link each row to its cost report line so the values stay in step with Schedule B.</p>
          <RegisterPage registerKey="final_accounts" isAdmin={user.role === "admin"} />
        </>
      ) : (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "red" | "amber" | "green" }) {
  const cls = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-ink";
  return (
    <div className="card min-w-0 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 truncate text-lg font-semibold tnum ${cls}`} title={value}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
