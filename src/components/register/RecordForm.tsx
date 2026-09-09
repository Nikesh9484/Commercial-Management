"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FieldWrap } from "@/components/ui/Field";
import type { FieldDef, LookupOption, RegisterDef } from "@/lib/registers/types";

export type FormValues = Record<string, string | number | boolean | null>;

export function RecordForm({
  def,
  values,
  lookups,
  errors,
  onChange,
  isNew,
}: {
  def: RegisterDef;
  values: FormValues;
  lookups: Record<string, LookupOption[]>;
  errors: Record<string, string>;
  onChange: (key: string, value: string | number | boolean | null) => void;
  isNew: boolean;
}) {
  const fields = def.fields.filter((f) => !f.hideInForm && !f.virtual);
  const sections: { name: string | null; fields: FieldDef[] }[] = [];
  for (const f of fields) {
    const name = f.section ?? null;
    const last = sections[sections.length - 1];
    if (last && last.name === name) last.fields.push(f);
    else sections.push({ name, fields: [f] });
  }
  const grouped = sections.length > 1;
  return (
    <div className="space-y-5">
      {sections.map((sec, i) => (
        <FormSection key={sec.name ?? i} name={grouped ? sec.name : null} defaultOpen={i === 0 || sec.fields.some((f) => filled(values[f.key]))} errorCount={sec.fields.filter((f) => errors[f.key]).length}>
          <div className="grid gap-4 sm:grid-cols-2">
            {sec.fields.map((f) => (
              <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
                <FieldWrap label={f.label} required={f.required && f.type !== "password"} help={helpFor(f, isNew)} error={errors[f.key]} htmlFor={`f_${f.key}`}>
                  <Input field={f} value={values[f.key]} options={lookups[f.key]} onChange={(v) => onChange(f.key, v)} />
                </FieldWrap>
              </div>
            ))}
          </div>
        </FormSection>
      ))}
    </div>
  );
}

function filled(v: unknown) {
  return v !== null && v !== undefined && v !== "" && v !== false;
}

function FormSection({ name, defaultOpen, errorCount, children }: { name: string | null; defaultOpen: boolean; errorCount: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!name) return <>{children}</>;
  const show = open || errorCount > 0;
  return (
    <section className="rounded-lg border border-line">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-navy hover:bg-page" onClick={() => setOpen((o) => !o)}>
        {show ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {name}
        {errorCount > 0 && <span className="ml-auto rounded-full bg-red-50 px-2 text-xs text-red-700">{errorCount} to fix</span>}
      </button>
      {show && <div className="border-t border-line p-3">{children}</div>}
    </section>
  );
}

function helpFor(f: FieldDef, isNew: boolean) {
  if (f.type === "password" && !isNew) return "Leave blank to keep the current password.";
  if (f.type === "money") return f.help ?? "SAR, numbers only (e.g. 1250000.50)";
  if (f.readonly) return f.help ?? "Set automatically by the system.";
  return f.help;
}

function Input({ field: f, value, options, onChange }: { field: FieldDef; value: FormValues[string]; options?: LookupOption[]; onChange: (v: string | number | boolean | null) => void }) {
  const id = `f_${f.key}`;
  const invalid = undefined;
  const disabled = f.readonly;
  const str = value === null || value === undefined ? "" : String(value);

  switch (f.type) {
    case "textarea":
      return <textarea id={id} className="input min-h-24" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} />;
    case "number":
    case "money":
    case "percent":
      return (
        <input
          id={id}
          className="input tnum text-right"
          type="number"
          step={f.type === "number" ? "any" : "0.01"}
          inputMode="decimal"
          value={str}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        />
      );
    case "date":
      return <input id={id} className="input" type="date" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} />;
    case "boolean":
      return (
        <label className="flex h-[38px] items-center gap-2 text-sm">
          <input id={id} type="checkbox" className="h-4 w-4 accent-navy" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
          <span className="text-muted">{value === true ? "Yes" : "No"}</span>
        </label>
      );
    case "select":
      return (
        <select id={id} className="input" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">— Select —</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "lookup":
      return (
        <select id={id} className="input" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— Select —</option>
          {(options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "password":
      return <input id={id} className="input" type="password" autoComplete="new-password" value={str} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input id={id} className="input" type="text" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  }
}
