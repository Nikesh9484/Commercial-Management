import Link from "next/link";
import { AlertTriangle, ShieldCheck, Umbrella, Layers } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getRegisterDef } from "@/lib/registers";
import { recordsForView } from "@/lib/view-mode";
import { PageHeader } from "@/components/ui/PageHeader";
import { BondsWorkspace } from "@/components/bonds/BondsWorkspace";
import { findBondDuplicates } from "@/lib/bonds/duplicates";

export const metadata = { title: "Bonds & Insurance" };

/** One page, three views: everything, the bonds (guarantees) only, the insurance policies only – each its own button. */
const VIEWS = [
  { key: "", label: "Bonds & Insurance", category: "all", Icon: Layers, subtitle: "Every bond and insurance policy: what the contract requires, what has been provided, and when it expires." },
  { key: "bonds", label: "Bonds", category: "bond", Icon: ShieldCheck, subtitle: "Bonds and bank guarantees – performance, advance payment, retention: what the contract requires, what has been provided, and when it expires." },
  { key: "insurance", label: "Insurance", category: "insurance", Icon: Umbrella, subtitle: "Insurance policies – CAR, liability, professional indemnity, workmen's compensation and the rest: what the contract requires, what has been provided, and when it expires." },
] as const;

export default async function BondsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const view = VIEWS.find((v) => v.key === (type ?? "")) ?? VIEWS[0];
  const user = (await getCurrentUser())!;
  const mod = getModule("bonds-insurance")!;
  const ctx = getAppContext();
  const bondRows = ctx.programme ? recordsForView(getRegisterDef("bonds")!) : [];
  const duplicates = ctx.programme ? findBondDuplicates(ctx.programme.id) : [];

  return (
    <div className="space-y-5">
      {/* the downloads live in the filter card below, so every one of them follows the filter on screen */}
      <PageHeader
        eyebrow={`Module ${mod.no}`}
        title={view.key ? view.label : mod.title}
        subtitle={view.subtitle}
      />
      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link key={v.key} href={v.key ? `/modules/bonds-insurance?type=${v.key}` : "/modules/bonds-insurance"} className={`btn ${v.key === view.key ? "btn-primary" : "btn-secondary"}`}>
            <v.Icon size={15} /> {v.label}
          </Link>
        ))}
      </div>
      {ctx.programme ? (
        <BondsWorkspace key={view.key} initialCategory={view.category} rows={bondRows} isAdmin={user.role === "admin"} hasPeriod={!!ctx.period} canUpload={["admin", "editor", "contributor", "reporter"].includes(user.role)} duplicates={duplicates} canMerge={user.role === "admin" || user.role === "editor"} />
      ) : (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      )}
    </div>
  );
}
