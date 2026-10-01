import Link from "next/link";
import { packDocuments } from "@/lib/packs/documents";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { packRefLabel, packType } from "@/lib/packs/shared";
import { canManagePacks, caseValues, docOnDisk, getCase, getTemplate, listDocs } from "@/lib/packs/store";
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
  // a file the server's disk lost before files were backed up is flagged, so the row says so instead of "not in the files yet"
  const docs = listDocs(c.id).map((d) => ({ ...d, missing: !docOnDisk(d) }));
  const values = caseValues(c);
  let sources: Record<string, string> = {};
  try {
    sources = JSON.parse(values.__sources || "{}") as Record<string, string>;
  } catch {
    sources = {};
  }
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
        type={{ key: t.key, label: t.label, short: t.short, formRef: t.formRef, groups: t.groups, fields: t.fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, group: f.group })), slots: t.slots, otherSlots: t.otherSlots, packOrder: t.packOrder }}
        initial={{ id: c.id, ref: c.ref, title: c.title, revision: c.revision, status: c.status, fileName: c.file_name, values, sources, defaultFileName: outputFileBase({ ...c, file_name: "" }), extraSlots: Number(c.extra_slots ?? 0) }}
        docs={docs}
        canManage={canManagePacks(user)}
        templateName={template?.name ?? null}
        documents={packDocuments(t)}
      />
    </div>
  );
}
