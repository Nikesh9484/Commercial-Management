"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, Save } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export function KeyIssues({ periodId, periodLabel, initial, canEdit }: { periodId: number | null; periodLabel: string; initial: string; canEdit: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = text !== initial;

  async function save() {
    if (!periodId) return;
    setSaving(true);
    const res = await fetch(`/api/periods/${periodId}/control`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key_issues: text.trim() || null }) });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return toast(j.error ?? "Could not save.", "error");
    toast("Key issues saved.");
    router.refresh();
  }

  return (
    <div className="card flex h-full flex-col p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <MessageSquareText size={18} className="text-navy" /> Key issues this period
        </h2>
        <span className="text-xs text-muted">{periodLabel}</span>
      </div>
      {canEdit && periodId ? (
        <>
          <textarea className="input min-h-40 flex-1 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Headline commercial issues for directors: what changed, what needs a decision, what is at risk…" />
          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>Saved with the reporting period, so each month keeps its own commentary.</span>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || saving}>
              <Save size={14} /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-ink">{initial || <span className="text-muted">No key issues recorded for this period.</span>}</p>
      )}
    </div>
  );
}
