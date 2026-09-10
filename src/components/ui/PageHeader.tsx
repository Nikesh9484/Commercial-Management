import { ExportButtons } from "@/components/ui/ExportButtons";

export function PageHeader({ title, subtitle, actions, eyebrow, exportSection }: { title: string; subtitle?: string; actions?: React.ReactNode; eyebrow?: string; exportSection?: string }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="text-xs font-semibold uppercase tracking-wide text-muted">{eyebrow}</div>}
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {(actions || exportSection) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {exportSection && <ExportButtons section={exportSection} />}
        </div>
      )}
    </div>
  );
}
