import Link from "next/link";
import { AlertTriangle, FileSignature } from "lucide-react";
import { getAppContext } from "@/lib/context";
import { countCases, listTemplates } from "@/lib/packs/store";
import { PACK_TYPES } from "@/lib/packs/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";

export const metadata = { title: "Document Packs" };

/** The eight categories of RSG document packs, with how many are on file for the current project. */
export default async function PacksOverviewPage() {
  const ctx = getAppContext();
  if (!ctx.programme) {
    return (
      <div className="card flex items-center gap-2 p-5 text-sm text-muted">
        <AlertTriangle size={16} /> Select a project in the top bar first.
      </div>
    );
  }
  const counts = countCases(ctx.programme.id);
  const templates = listTemplates();
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={`${ctx.programme.code} · ${ctx.programme.name}`} title="Document Packs" subtitle="One category per RSG document. Each pack is filled from the registers and the details you type, written into the RSG Word template, drawn as a PDF, and compiled with its supporting documents into one PDF pack with a cover and dividers. No AI is involved – the templates and the registers do the work." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PACK_TYPES.map((t) => {
          const tpl = templates.get(t.key);
          return (
            <Link key={t.key} href={`/packs/${t.key}`} className="card block p-4 transition hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-700 text-white">
                  <FileSignature size={17} />
                </div>
                <span className="text-2xl font-semibold tnum text-ink">{counts.get(t.key) ?? 0}</span>
              </div>
              <div className="mt-3 text-sm font-semibold text-ink">{t.label}</div>
              <div className="mt-1 line-clamp-3 text-xs text-muted">{t.description}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Chip tone={tpl ? "green" : "amber"}>{tpl ? "RSG template set" : "Built-in layout – upload the RSG template"}</Chip>
                <Chip tone="grey">{t.slots.length} upload slots</Chip>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
