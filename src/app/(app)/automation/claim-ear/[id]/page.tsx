import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getCase, listFiles, canUseEar } from "@/lib/ear/store";
import { engineConfigured } from "@/lib/ear/generate";
import { PageHeader } from "@/components/ui/PageHeader";
import { EarWorkspace } from "@/components/ear/EarWorkspace";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: getCase(Number(id))?.title ?? "Claim EAR" };
}

export default async function ClaimEarCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = (await getCurrentUser())!;
  if (!canUseEar(user)) notFound();
  const c = getCase(Number(id));
  if (!c) notFound();
  const { output_json: _j, ...info } = c;
  void _j;
  const files = listFiles(c.id).map((f) => ({ id: f.id, bucket: f.bucket, rel_path: f.rel_path, size: f.size, kind: f.kind, text_chars: f.text_chars, note: f.note }));
  return (
    <div className="space-y-4">
      <Link href="/automation/claim-ear" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={16} /> Claim EAR cases
      </Link>
      <PageHeader eyebrow="Automation · Claim EAR" title={c.title} subtitle={[c.contractor, c.contract_no && `Contract ${c.contract_no}`, c.claim_ref && `Claim ${c.claim_ref}`].filter(Boolean).join(" · ") || "Employer's Assessment Report case"} />
      <EarWorkspace initial={info} files={files} engine={engineConfigured()} canEdit={canUseEar(user)} />
    </div>
  );
}
