import { getDb } from "../db";
import { nowIso } from "../format";
import type { UserInfo } from "../registers/types";
import { buildDocx, fillTemplate } from "./word";
import { buildCompiledPack, renderFormPdf, safeFileName, type FormMeta } from "./pdf";
import { caseValues, getTemplate, listDocs, readDocBytes, readTemplateBytes, type PackCase } from "./store";
import { defaultPackFileName, packType } from "./shared";

/** The three outputs of a pack: the Word form, the PDF form and the compiled PDF pack. */
export type OutputFormat = "docx" | "pdf" | "pack";

export function outputMeta(c: PackCase, user: UserInfo): FormMeta {
  const p = getDb().prepare("SELECT code, name FROM programmes WHERE id = ?").get(c.programme_id) as { code: string; name: string } | undefined;
  return { programme: { code: p?.code ?? "", name: p?.name ?? "" }, ref: c.ref, title: c.title, revision: c.revision, status: c.status, preparedBy: user.name, generatedAt: nowIso() };
}

export function outputFileBase(c: PackCase): string {
  const t = packType(c.pack_type)!;
  return c.file_name.trim() || defaultPackFileName(t, caseValues(c), c.ref, c.title);
}

export async function renderOutput(c: PackCase, format: OutputFormat, user: UserInfo): Promise<{ bytes: Buffer; fileName: string; mime: string; note: string }> {
  const t = packType(c.pack_type)!;
  const values = caseValues(c);
  const meta = outputMeta(c, user);
  const base = outputFileBase(c);
  if (format === "docx") {
    const tpl = getTemplate(c.pack_type);
    const bytes = tpl ? readTemplateBytes(tpl) : null;
    if (tpl && bytes) return { bytes: await fillTemplate(bytes, t, values), fileName: safeFileName(base, "docx"), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", note: `written into the RSG template ${tpl.name}` };
    return { bytes: await buildDocx(t, values, meta), fileName: safeFileName(base, "docx"), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", note: "built-in layout (no template uploaded for this category)" };
  }
  const form = await renderFormPdf(t, values, meta);
  if (format === "pdf") return { bytes: form, fileName: safeFileName(base, "pdf"), mime: "application/pdf", note: "form drawn by the dashboard" };
  const docs = listDocs(c.id).map((doc) => ({ doc, bytes: readDocBytes(doc) }));
  const bytes = await buildCompiledPack({ type: t, values, meta, fileName: base, form, docs });
  return { bytes, fileName: safeFileName(`${base} - Pack`, "pdf"), mime: "application/pdf", note: `${docs.length} supporting documents` };
}
