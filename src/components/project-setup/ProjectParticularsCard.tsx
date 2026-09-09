"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Building2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FieldWrap } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import type { LookupOption } from "@/lib/registers/types";

export interface Particulars {
  programme: { id: number; code: string; name: string; client_id: number | null; location_id: number | null; description: string | null } | null;
  asset: { id: number; code: string; name: string; description: string | null } | null;
  clientName: string;
  locationName: string;
  clients: LookupOption[];
  locations: LookupOption[];
}

export function ProjectParticularsCard({ data, canEdit }: { data: Particulars; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    programme_code: data.programme?.code ?? "",
    programme_name: data.programme?.name ?? "",
    client_id: data.programme?.client_id ?? null,
    location_id: data.programme?.location_id ?? null,
    asset_code: data.asset?.code ?? "",
    asset_name: data.asset?.name ?? "",
  });

  async function save() {
    if (!data.programme) return;
    setSaving(true);
    setErrors({});
    const p = await fetch(`/api/registers/programmes/${data.programme.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: form.programme_code, name: form.programme_name, client_id: form.client_id, location_id: form.location_id }),
    });
    const pj = await p.json().catch(() => ({}));
    if (!p.ok) {
      setSaving(false);
      setErrors(prefix(pj.fieldErrors ?? {}, "programme_"));
      toast(pj.error ?? "Could not save programme.", "error");
      return;
    }
    if (data.asset) {
      const a = await fetch(`/api/registers/assets/${data.asset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: form.asset_code, name: form.asset_name }),
      });
      const aj = await a.json().catch(() => ({}));
      if (!a.ok) {
        setSaving(false);
        setErrors(prefix(aj.fieldErrors ?? {}, "asset_"));
        toast(aj.error ?? "Could not save asset.", "error");
        return;
      }
    }
    setSaving(false);
    setOpen(false);
    toast("Project particulars saved.");
    router.refresh();
  }

  const rows: [string, string][] = [
    ["Programme name", data.programme?.name ?? "—"],
    ["Programme code", data.programme?.code ?? "—"],
    ["Asset name", data.asset?.name ?? "—"],
    ["Asset code", data.asset?.code ?? "—"],
    ["Client", data.clientName || "—"],
    ["Location", data.locationName || "—"],
  ];

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <Building2 size={18} className="text-navy" /> Project particulars
        </h2>
        {canEdit && data.programme && (
          <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
            <Pencil size={14} /> Edit
          </button>
        )}
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col border-b border-line pb-2 last:border-0 sm:border-0 sm:pb-0">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="text-sm font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted">Shown for the Programme and Asset selected in the top bar. Other programmes / assets are managed under Settings.</p>

      <Modal
        open={open}
        title="Edit project particulars"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldWrap label="Programme code" required error={errors.programme_code}>
            <input className="input" value={form.programme_code} onChange={(e) => setForm({ ...form, programme_code: e.target.value })} />
          </FieldWrap>
          <FieldWrap label="Programme name" required error={errors.programme_name}>
            <input className="input" value={form.programme_name} onChange={(e) => setForm({ ...form, programme_name: e.target.value })} />
          </FieldWrap>
          <FieldWrap label="Client" error={errors.programme_client_id} help="Add more clients under Settings → Clients.">
            <select className="input" value={form.client_id ?? ""} onChange={(e) => setForm({ ...form, client_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— Select —</option>
              {data.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </FieldWrap>
          <FieldWrap label="Location" error={errors.programme_location_id} help="Add more locations under Settings → Locations.">
            <select className="input" value={form.location_id ?? ""} onChange={(e) => setForm({ ...form, location_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— Select —</option>
              {data.locations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </FieldWrap>
          {data.asset && (
            <>
              <FieldWrap label="Asset code" required error={errors.asset_code}>
                <input className="input" value={form.asset_code} onChange={(e) => setForm({ ...form, asset_code: e.target.value })} />
              </FieldWrap>
              <FieldWrap label="Asset name" required error={errors.asset_name}>
                <input className="input" value={form.asset_name} onChange={(e) => setForm({ ...form, asset_name: e.target.value })} />
              </FieldWrap>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

function prefix(errors: Record<string, string>, p: string) {
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [p + k, v]));
}
