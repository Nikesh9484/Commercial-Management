"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2, FolderOpen, Trash2, ArrowRight, Sparkles } from "lucide-react";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";
import type { ChipTone } from "@/lib/registers/types";

export interface CaseRow {
  id: number;
  title: string;
  contractor: string;
  claim_ref: string;
  revised: number;
  revision_no: number;
  status: string;
  output_name: string | null;
  generated_at: string | null;
  updated_at: string;
  updated_by: string;
  files: number;
  bytes: number;
}

const TONE: Record<string, ChipTone> = { Draft: "grey", Generating: "amber", Generated: "green", Failed: "red" };
export const fmtBytes = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function EarCaseList({ cases, isAdmin }: { cases: CaseRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [contractor, setContractor] = useState("");
  const [claimRef, setClaimRef] = useState("");
  const [revised, setRevised] = useState(false);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const r = await fetch("/api/ear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, contractor, claim_ref: claimRef, revised, revision_no: revised ? 1 : 0 }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(j.error ?? "Could not create the case.", "error");
    router.push(`/automation/claim-ear/${j.case.id}`);
  }

  async function remove(c: CaseRow) {
    if (!confirm(`Delete "${c.title}" with all its uploaded documents and the report? This cannot be undone.`)) return;
    const r = await fetch(`/api/ear/${c.id}`, { method: "DELETE" });
    if (!r.ok) return toast("Could not delete the case.", "error");
    toast("Case deleted.");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <FilePlus2 size={16} /> Start a new assessment
        </h2>
        <p className="mb-3 text-xs text-muted">One case per contractor claim. Give it a name, then upload the claim folder, your EAR template and the contract folder on the next screen.</p>
        <div className="grid gap-3 sm:grid-cols-[2fr_1.4fr_1fr_auto_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Case title
            <input className="input" placeholder="e.g. EOT Claim No 3 – Quay wall drawings" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Contractor
            <input className="input" value={contractor} onChange={(e) => setContractor(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Claim ref
            <input className="input" value={claimRef} onChange={(e) => setClaimRef(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs text-muted">
            <input type="checkbox" checked={revised} onChange={(e) => setRevised(e.target.checked)} /> Revised submission
          </label>
          <button className="btn btn-primary" onClick={create} disabled={busy || !title.trim()}>
            <Sparkles size={16} /> Create case
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="data w-full text-sm">
          <thead>
            <tr>
              <th>Case</th>
              <th>Contractor</th>
              <th>Claim ref</th>
              <th>Submission</th>
              <th>Documents</th>
              <th>Status</th>
              <th>Report</th>
              <th>Last change</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted">
                  No assessment cases yet. Create the first one above.
                </td>
              </tr>
            )}
            {cases.map((c) => (
              <tr key={c.id}>
                <td className="font-medium text-ink">
                  <Link href={`/automation/claim-ear/${c.id}`} className="hover:underline">
                    {c.title}
                  </Link>
                </td>
                <td>{c.contractor || "–"}</td>
                <td>{c.claim_ref || "–"}</td>
                <td>{c.revised ? <Chip tone="blue">Revision {c.revision_no}</Chip> : <Chip tone="grey">Original</Chip>}</td>
                <td>
                  {c.files} file{c.files === 1 ? "" : "s"} · {fmtBytes(c.bytes)}
                </td>
                <td>
                  <Chip tone={TONE[c.status] ?? "grey"}>{c.status}</Chip>
                </td>
                <td>
                  {c.output_name ? (
                    <a href={`/api/ear/${c.id}/download`} className="text-accent hover:underline">
                      Word
                    </a>
                  ) : (
                    "–"
                  )}
                </td>
                <td className="whitespace-nowrap text-xs text-muted">
                  {c.updated_at.slice(0, 10)} · {c.updated_by}
                </td>
                <td className="whitespace-nowrap text-right">
                  <Link href={`/automation/claim-ear/${c.id}`} className="btn btn-secondary btn-sm">
                    <FolderOpen size={14} /> Open <ArrowRight size={14} />
                  </Link>
                  {isAdmin && (
                    <button className="btn btn-ghost btn-sm ml-1 text-red-600" onClick={() => remove(c)} title="Delete case">
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
