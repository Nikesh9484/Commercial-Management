import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { packRefLabel, packType } from "@/lib/packs/shared";
import { canManagePacks, caseValues, getCase, getTemplate, listDocs } from "@/lib/packs/store";
import { outputFileBase } from "@/lib/packs/output";
import { PageHeader } from "@/components/ui/PageHeader";
import { PackEditor } from "@/components/packs/PackEditor";

export const metadata = { title: "Document pack" };

/** One pack: its fields, its supporting documents in the numbered slots, and the three outputs. */
export default async function PackCasePage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const t = packType(type);
  const c = getCase(Number(id));
  if (!t || !c || c.pack_type !== t.key) notFound();
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  const programme = ctx.programmes.find((p) => p.id === c.programme_id) ?? null;
  const template = getTemplate(t.key);
  const docs = listDocs(c.id);
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`Document Packs · ${t.label}${programme ? ` · ${programme.code}` : ""}`}
        title={`${c.ref ? packRefLabel(t.short, c.ref) : `${t.short} #${c.id}`}${c.revision ? ` · Rev. ${c.revision}` : ""}`}
        subtitle={c.title}
        actions={
          <Link href={`/packs/${t.key}`} className="btn btn-sm btn-secondary">
            <ArrowLeft size={14} /> All {t.short} packs
          </Link>
        }
      />
      {programme && ctx.programme && programme.id !== ctx.programme.id && <div className="card border-l-4 border-l-amber-500 p-3 text-xs text-muted">This pack belongs to {programme.name}; the top bar is on {ctx.programme.name}.</div>}
      <PackEditor
        type={{ key: t.key, label: t.label, short: t.short, formRef: t.formRef, groups: t.groups, fields: t.fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, group: f.group, auto: !!f.auto, hint: f.hint ?? "" })), slots: t.slots }}
        initial={{ id: c.id, ref: c.ref, title: c.title, revision: c.revision, status: c.status, fileName: c.file_name, values: caseValues(c), sourceId: c.source_id, defaultFileName: outputFileBase({ ...c, file_name: "" }) }}
        docs={docs}
        canManage={canManagePacks(user)}
        templateName={template?.name ?? null}
      />
    </div>
  );
}
