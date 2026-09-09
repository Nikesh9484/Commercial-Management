export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: string; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="text-xs font-semibold uppercase tracking-wide text-muted">{eyebrow}</div>}
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
