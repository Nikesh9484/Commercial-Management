import { notFound } from "next/navigation";
import { Construction } from "lucide-react";
import { getModule, modules } from "@/lib/modules";
import { PageHeader } from "@/components/ui/PageHeader";

export function generateStaticParams() {
  return modules.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: getModule(slug)?.title ?? "Module" };
}

export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mod = getModule(slug);
  if (!mod) notFound();
  return (
    <div>
      <PageHeader eyebrow={`Module ${mod.no} of ${modules.length}`} title={mod.title} subtitle={mod.description} />
      <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-amber-600">
          <Construction size={22} />
        </span>
        <h2 className="text-base font-semibold text-ink">This module has not been built yet</h2>
        <p className="max-w-md text-sm text-muted">
          It will be set up in prompt {mod.no}. The login, menu, reference data lists and the shared register features (add / edit / delete, search, Excel
          import &amp; export, change history and month-end snapshots) are already in place and will be reused here.
        </p>
      </div>
    </div>
  );
}
