export function FieldWrap({ label, required, help, error, children, htmlFor }: { label: string; required?: boolean; help?: string; error?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : help ? <p className="text-xs text-muted">{help}</p> : null}
    </div>
  );
}
