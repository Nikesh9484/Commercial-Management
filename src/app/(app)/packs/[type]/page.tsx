import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, FileDown, FileText, Paperclip } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { listSources } from "@/lib/packs/data";
import { packRefLabel, packType, PACK_TYPES, slotsFor, type TemplateInspection } from "@/lib/packs/shared";
import { canManagePacks, countDocs, getTemplate, listCases } from "@/lib/packs/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { PackTemplateCard } from "@/components/packs/PackTemplateCard";
import { NewPackForm } from "@/components/packs/NewPackForm";

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const t = packType(type);
  return { title: t ? `${t.label} – Document Packs` : "Document Packs" };
}

/** One category of document pack: its RSG template, the packs on file for the project, and where a new one starts. */
export default async function PackCategoryPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const t = packType(type);
  if (!t) notFound();
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  if (!ctx.programme) {
    return (
      <div className="card flex items-center gap-2 p-5 text-sm text-muted">
        <AlertTriangle size={16} /> Select a project in the top bar first.
      </div>
    );
  }
  const canManage = canManagePacks(user);
  const template = getTemplate(t.key);
  let inspection: TemplateInspection | null = null;
  if (template) {
    try {
      inspection = JSON.parse(template.fields_json || "{}") as TemplateInspection;
    } catch {
      inspection = null;
    }
  }
  const cases = listCases(ctx.programme.id, t.key);
  const docCounts = countDocs(cases.map((c) => c.id));
  const sources = canManage ? listSources(t.key, ctx.programme.id) : [];
  const statusTone = (s: string) => (s === "Issued" ? "green" : s === "For approval" ? "amber" : s === "Superseded" ? "grey" : "blue");
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={`Document Packs · ${ctx.programme.code}`} title={t.label} subtitle={t.description} />
      <div className="flex flex-wrap gap-1.5">
        {PACK_TYPES.map((p) => (
          <Link key={p.key} href={`/packs/${p.key}`} className={`btn btn-sm ${p.key === t.key ? "btn-primary" : "btn-secondary"}`}>
            {p.short}
          </Link>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <PackTemplateCard type={{ key: t.key, label: t.label, short: t.short, formRef: t.formRef, fields: t.fields.map((f) => ({ key: f.key, label: f.label, group: f.group, auto: !!f.auto })) }} template={template ? { id: template.id, name: template.name, size: template.size, created_at: template.created_at, created_by: template.created_by } : null} inspection={inspection} canManage={canManage} />
        <div className="card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Start a new {t.short}</div>
          {canManage ? (
            <NewPackForm type={t.key} short={t.short} sourceLabel={t.sourceLabel} sources={sources} />
          ) : (
            <p className="mt-2 text-xs text-muted">A viewer account can only look at the packs.</p>
          )}
          <div className="mt-3 text-xs text-muted">
            Upload entries for a {t.short} pack:
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              {slotsFor(t).map((s) => (
                <li key={s.key}>
                  <b className="text-ink">{s.label}</b> – {s.hint}
                </li>
              ))}
            </ol>
            <div className="mt-2">More attachment slots can be added on the pack itself.</div>
            <div className="mt-2">The compiled PDF is made of:</div>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              {t.packOrder.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 className="text-sm font-semibold text-ink">
            {t.short} packs on file · {cases.length}
          </h2>
        </div>
        {cases.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">No {t.short} pack has been started for {ctx.programme.name} yet.</div>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-4 py-2">Reference</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Rev.</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2 text-right">Files</th>
                <th className="px-3 py-2 text-right">Outputs</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-t border-line hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2 font-medium text-ink">
                    <Link href={`/packs/${t.key}/${c.id}`} className="hover:underline">
                      {c.ref ? packRefLabel(t.short, c.ref) : `${t.short} #${c.id}`}
                    </Link>
                  </td>
                  <td className="max-w-[28rem] px-3 py-2">
                    <Link href={`/packs/${t.key}/${c.id}`} className="line-clamp-2 hover:underline" title={c.title}>
                      {c.title || "–"}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Chip tone={statusTone(c.status)}>{c.status}</Chip>
                  </td>
                  <td className="px-3 py-2 text-xs">{c.revision || "–"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">
                    {formatDateTime(c.updated_at)} · {c.updated_by}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Paperclip size={12} /> {docCounts.get(c.id) ?? 0}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <a className="btn btn-xs btn-secondary" href={`/api/packs/output?case=${c.id}&format=docx`} title="The form as a Word file (written into the RSG template when one is uploaded)">
                      <FileText size={12} /> Word
                    </a>{" "}
                    <a className="btn btn-xs btn-pdf" href={`/api/packs/output?case=${c.id}&format=pdf`} title="The form as a PDF">
                      <FileDown size={12} /> PDF
                    </a>{" "}
                    <a className="btn btn-xs btn-primary" href={`/api/packs/output?case=${c.id}&format=pack`} title="Cover, the form, a divider per part and every supporting document in one PDF">
                      <FileDown size={12} /> Pack
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
