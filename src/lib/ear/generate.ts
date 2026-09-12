import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "../db";
import { logAudit } from "../audit";
import type { UserInfo } from "../registers/types";
import { EAR_SCHEMA, normaliseEar, para, note, bullets, table, type EarDocument } from "./model";
import { renderEarDocx, paragraphsFromText } from "./docx";
import { inspectTemplate, renderIntoTemplate, type TemplateInfo } from "./template-docx";
import { getCase, listFiles, fileText, filePath, outputPath, setGeneration, type EarCase, type EarFile, type EarBucket } from "./store";
import { extOf } from "./extract";

/**
 * Creates the Employer's Assessment Report for a case:
 *   1. gathers the text of every document (submission, template, contract, previous EAR / submission)
 *   2. asks the drafting engine (Claude) for the report as structured content, following the template
 *   3. writes it to Word – with tracked changes against the previous EAR for a revised submission.
 * Without an API key the report is still produced as a skeleton from the template, ready to fill in.
 */
export const EAR_MODEL = process.env.EAR_MODEL || "claude-opus-5";

/** Characters of document text sent to the engine, per group (about 4 characters per token). */
const BUDGET: Record<EarBucket, number> = { template: 60_000, submission: 330_000, contract: 130_000, prev_ear: 70_000, prev_submission: 60_000 };
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function engineConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
}

interface Pack {
  text: string;
  used: number;
  files: number;
  unreadable: string[];
}

/** Fits a group's documents into its character budget: every file keeps a share, longest files are cut proportionally. */
function pack(files: EarFile[], bucket: EarBucket): Pack {
  const list = files.filter((f) => f.bucket === bucket);
  const budget = BUDGET[bucket];
  const texts = list.map((f) => ({ f, text: fileText(f.id) }));
  const total = texts.reduce((a, t) => a + t.text.length, 0);
  const unreadable: string[] = [];
  const parts: string[] = [];
  let used = 0;
  for (const { f, text } of texts) {
    const head = `### File: ${f.rel_path} (${f.kind}${f.note ? `; ${f.note}` : ""})`;
    if (!text.trim()) {
      unreadable.push(`${f.rel_path}${f.note ? ` – ${f.note}` : ""}`);
      parts.push(head);
      continue;
    }
    const share = total > budget ? Math.max(2000, Math.floor((budget * text.length) / total)) : text.length;
    const body = text.length > share ? `${text.slice(0, Math.floor(share * 0.8))}\n[… ${text.length - share} characters omitted …]\n${text.slice(-Math.floor(share * 0.2))}` : text;
    used += body.length;
    parts.push(`${head}\n${body}`);
  }
  return { text: parts.join("\n\n"), used, files: list.length, unreadable };
}

function images(caseId: number, files: EarFile[]): Anthropic.ImageBlockParam[] {
  const out: Anthropic.ImageBlockParam[] = [];
  for (const f of files) {
    if (f.bucket !== "submission" || f.kind !== "image" || f.size > MAX_IMAGE_BYTES) continue;
    const ext = extOf(f.rel_path);
    const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : null;
    if (!type) continue;
    try {
      out.push({ type: "image", source: { type: "base64", media_type: type, data: fs.readFileSync(filePath(caseId, f)).toString("base64") } });
    } catch {
      /* skip unreadable image */
    }
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

function caseFacts(c: EarCase, programme: string): string {
  return [
    `Programme / project: ${programme || "(see documents)"}`,
    `Case title: ${c.title}`,
    c.contractor && `Contractor: ${c.contractor}`,
    c.contract_no && `Contract No: ${c.contract_no}`,
    c.claim_ref && `Claim reference: ${c.claim_ref}`,
    c.submission_ref && `Contractor's submission reference: ${c.submission_ref}`,
    c.submission_date && `Submission date: ${c.submission_date}`,
    c.revised ? `This is a REVISED submission (revision ${c.revision_no}); a previous Employer's Assessment Report exists.` : "This is the contractor's first (original) submission.",
    `Report date: ${new Date().toISOString().slice(0, 10)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const SYSTEM = `You are the Employer's Commercial Manager on a major marina construction programme in Saudi Arabia (currency SAR). You write the Employer's Assessment Report (EAR) that responds to a contractor's claim for extension of time and/or additional payment.

How to work:
- Read the contractor's submission and its supporting documents in full. Read the contract documents for the clauses, notice requirements, time bars, programme obligations and entitlement tests that apply. Use the EAR template for the structure, headings, order and house wording of the report; where the template has placeholders, fill them from the documents.
- Assess entitlement (contractual basis and notice compliance), causation and the critical-path effect (delay analysis: method, data date, concurrency, float ownership, mitigation), quantum (rates, time-related preliminaries, substantiation of actual cost, duplication with variations), and record the Employer's position: accepted, partially accepted or rejected, with reasons and the days / SAR assessed.
- Cite the evidence: contract clause numbers, and the document that supports each finding by its file name (e.g. "Letter ref ... dated ..., file 03 Correspondence/xyz.pdf"). Quote the contractor's own figures accurately.
- Never invent facts. Where the submission does not evidence something, say so ("The Contractor has not demonstrated …") and list it under information gaps with the specific document or data the Employer requests.
- Write in formal, precise, plain English in the Employer's voice, third person ("the Contractor", "the Employer", "the Engineer"). Numbers as figures; dates as DD Month YYYY; currency as SAR with thousands separators.
- The report must be complete and print-ready: every template section written out in full, with tables where numbers are compared (claimed vs assessed), and a clear conclusion and recommendation. Aim for a thorough professional report (typically 2,500–6,000 words for a substantial claim).
- Output only the JSON document requested. Use level 1 for the main template headings and level 2/3 for their sub-headings; use "table" blocks for comparisons and delay-event registers; "note" blocks only for short caveats.`;

export const REVISION_RULES = `Revised submission rules:
- The previous Employer's Assessment Report is supplied. Start from it: keep its structure, findings and wording wherever they remain correct, and change only what the revised submission justifies (new evidence, corrected figures, new events). This lets the reviewer read the differences as tracked changes.
- Add a section "Changes in the revised submission" early in the report that lists exactly what the Contractor changed compared with the previous submission (scope, days, amounts, evidence) and whether each change alters the Employer's assessment.
- Update the revision number, dates and references in the cover block.`;

interface Bundle {
  content: Anthropic.ContentBlockParam[];
  stats: { chars: number; files: number; unreadable: string[]; imageCount: number };
}

/** The Word template, when there is one: its bytes and its heading outline. */
async function wordTemplate(caseId: number, files: EarFile[]): Promise<{ bytes: Buffer; info: TemplateInfo } | null> {
  const f = files.find((x) => x.bucket === "template" && /\.(docx|docm|dotx)$/i.test(x.rel_path));
  if (!f) return null;
  try {
    const bytes = fs.readFileSync(filePath(caseId, f));
    const info = await inspectTemplate(bytes);
    if (!info.usable) console.error("[ear] template not usable as-is:", f.rel_path, bytes.length, "bytes");
    return info.usable ? { bytes, info } : null;
  } catch (e) {
    console.error("[ear] template read failed:", e);
    return null;
  }
}

function outlineText(info: TemplateInfo): string {
  return info.outline.map((h) => `${"  ".repeat(h.level - 1)}- (level ${h.level}) ${h.heading}`).join("\n");
}

function bundle(c: EarCase, files: EarFile[], programme: string, tpl: TemplateInfo | null): Bundle {
  const groups: [EarBucket, string][] = [
    ["template", "EAR TEMPLATE (structure and wording to follow)"],
    ["submission", "CONTRACTOR'S CLAIM SUBMISSION AND SUPPORTING DOCUMENTS"],
    ["contract", "CONTRACT DOCUMENTS"],
  ];
  if (c.revised) groups.push(["prev_ear", "PREVIOUS EMPLOYER'S ASSESSMENT REPORT (the report this revision is written on top of)"], ["prev_submission", "CONTRACTOR'S PREVIOUS SUBMISSION (before the revision)"]);
  const parts: string[] = [`# CASE\n${caseFacts(c, programme)}`];
  let chars = 0;
  let nFiles = 0;
  const unreadable: string[] = [];
  for (const [bucket, label] of groups) {
    const p = pack(files, bucket);
    nFiles += p.files;
    chars += p.used;
    unreadable.push(...p.unreadable);
    parts.push(`# ${label}\n${p.files ? p.text : "(no documents uploaded in this group)"}`);
  }
  const imgs = images(c.id, files);
  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: parts.join("\n\n") }];
  if (imgs.length) content.push({ type: "text", text: `# PHOTOGRAPHS / IMAGES FROM THE SUBMISSION (${imgs.length})` }, ...imgs);
  const outline = tpl && tpl.outline.length ? `\n\nREQUIRED OUTLINE – the Word template's own headings. Use exactly these headings, in this order, with these levels (you may add level 2 or level 3 sub-headings under them where the assessment needs them, e.g. one per delay event). Do NOT put numbers in headings or at the start of paragraphs: the numbering (1.0, 1.1, 1.1.1, Table n) is applied automatically in the template's style. Do not repeat the heading text inside the paragraphs.\n${outlineText(tpl)}` : "";
  content.push({
    type: "text",
    text: `Now write the complete Employer's Assessment Report for this case as JSON in the required format.${c.revised ? `\n\n${REVISION_RULES}` : ""}\nThe "meta" cover block must include: Project, Employer, Contractor, Contract No, Contract title (the works, as named in the contract), Claim reference, Submission reference and date, Report revision, Report date, Prepared by ("Commercial Manager").${outline}`,
  });
  return { content, stats: { chars, files: nFiles, unreadable, imageCount: imgs.length } };
}

async function callEngine(b: Bundle): Promise<{ doc: EarDocument; usage: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY, maxRetries: 2, timeout: 20 * 60 * 1000 });
  const stream = client.messages.stream({
    model: EAR_MODEL,
    max_tokens: 40_000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [{ role: "user", content: b.content }],
    output_config: { format: { type: "json_schema", schema: EAR_SCHEMA as unknown as Record<string, unknown> } },
  });
  const msg = await stream.finalMessage();
  const text = msg.content.filter((x): x is Anthropic.TextBlock => x.type === "text").map((x) => x.text).join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) throw new Error("The drafting engine did not return a readable report. Please try again.");
    parsed = JSON.parse(m[0]);
  }
  return { doc: normaliseEar(parsed), usage: `${msg.usage.input_tokens.toLocaleString()} tokens read, ${msg.usage.output_tokens.toLocaleString()} written` };
}

/** Template headings, so the skeleton follows the user's template even without the engine. */
function templateHeadings(files: EarFile[]): string[] {
  const t = files.find((f) => f.bucket === "template");
  if (!t) return ["Introduction", "Contractor's submission", "Contractual basis and notices", "Assessment of delay", "Assessment of cost", "Conclusion and recommendation"];
  const lines = fileText(t.id)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && l.length < 90 && !/[.;:]$/.test(l) && /^(\d+(\.\d+)*\.?\s+|[A-Z][A-Z\s&'/-]{4,}$|[A-Z])/.test(l) && !/^(page|table|figure)\b/i.test(l));
  const out: string[] = [];
  for (const l of lines) if (!out.includes(l) && /^\d|^[A-Z][A-Z\s&'/-]{4,}$/.test(l)) out.push(l);
  return out.length >= 3 ? out.slice(0, 40) : ["Introduction", "Contractor's submission", "Contractual basis and notices", "Assessment of delay", "Assessment of cost", "Conclusion and recommendation"];
}

function skeleton(c: EarCase, files: EarFile[], programme: string, b: Bundle, tpl: TemplateInfo | null): EarDocument {
  const heads = tpl && tpl.outline.length ? tpl.outline.map((h) => ({ text: h.heading, level: h.level })) : templateHeadings(files).map((h) => ({ text: h.replace(/^\d+(\.\d+)*\.?\s+/, ""), level: /^\d+\.\d+/.test(h) ? 2 : 1 }));
  const list = (bucket: EarBucket) => files.filter((f) => f.bucket === bucket).map((f) => `${f.rel_path} (${f.kind}${f.note ? ` – ${f.note}` : ""})`);
  return {
    title: "Employer's Assessment Report",
    subtitle: c.title,
    meta: [
      { label: "Project", value: programme },
      { label: "Contractor", value: c.contractor },
      { label: "Contract No", value: c.contract_no },
      { label: "Claim reference", value: c.claim_ref },
      { label: "Submission reference / date", value: [c.submission_ref, c.submission_date].filter(Boolean).join(" / ") },
      { label: "Report revision", value: c.revised ? `Revision ${c.revision_no}` : "Original" },
      { label: "Report date", value: new Date().toISOString().slice(0, 10) },
      { label: "Prepared by", value: "Commercial Manager" },
    ],
    summary: { eot_claimed_days: 0, eot_assessed_days: 0, cost_claimed_sar: 0, cost_assessed_sar: 0, recommendation: "To be completed" },
    sections: [
      {
        heading: "Note on this draft",
        level: 1,
        blocks: [
          note("The automated drafting engine is not configured on this server (no ANTHROPIC_API_KEY), so this file is a skeleton laid out from your template with the documents received. Ask the administrator to add the key in the hosting settings, then press Create EAR again to have the full report written."),
          table("Documents received", ["Group", "Files"], [
            ["Contractor's submission", String(list("submission").length)],
            ["Template", String(list("template").length)],
            ["Contract documents", String(list("contract").length)],
            ...(c.revised ? [["Previous EAR", String(list("prev_ear").length)], ["Previous submission", String(list("prev_submission").length)]] : []),
          ]),
        ],
      },
      // a placeholder paragraph only under headings that have no sub-headings of their own
      ...heads.map((h, k) => ({ heading: h.text, level: h.level, blocks: heads[k + 1] && heads[k + 1].level > h.level ? [] : [para("[To be written]")] })),
      { heading: "Contractor's submission – document list", level: 1, blocks: [bullets(list("submission").length ? list("submission") : ["(none uploaded)"])] },
    ],
    documents_relied_on: [...list("template"), ...list("contract")],
    information_gaps: b.stats.unreadable.length ? b.stats.unreadable.map((u) => `Not readable by the engine: ${u}`) : [],
  };
}

export async function generateEar(caseId: number, user: UserInfo, programmeName: string): Promise<{ case: EarCase; note: string }> {
  const c = getCase(caseId);
  if (!c) throw new Error("Case not found.");
  const files = listFiles(caseId);
  if (!files.some((f) => f.bucket === "submission")) throw new Error("Upload the contractor's claim submission first.");
  if (c.revised && !files.some((f) => f.bucket === "prev_ear")) throw new Error("This is a revised submission: upload the previous EAR so the report can be written with tracked changes.");
  setGeneration(caseId, { status: "Generating", note: null }, user);
  try {
    const tpl = await wordTemplate(caseId, files);
    const b = bundle(c, files, programmeName, tpl?.info ?? null);
    let doc: EarDocument;
    let how: string;
    if (engineConfigured()) {
      const r = await callEngine(b);
      doc = r.doc;
      how = `Written by the drafting engine (${EAR_MODEL}; ${r.usage}) from ${b.stats.files} documents (${Math.round(b.stats.chars / 1000)}k characters read${b.stats.imageCount ? `, ${b.stats.imageCount} images` : ""}).`;
    } else {
      doc = skeleton(c, files, programmeName, b, tpl?.info ?? null);
      how = `Skeleton only – the drafting engine is not configured (add ANTHROPIC_API_KEY on the server). ${b.stats.files} documents received.`;
    }
    if (b.stats.unreadable.length) how += ` Not readable: ${b.stats.unreadable.length} file${b.stats.unreadable.length === 1 ? "" : "s"}.`;
    // previous EAR paragraphs → tracked changes
    let previousLines: string[] | null = null;
    if (c.revised) {
      const prev = files.find((f) => f.bucket === "prev_ear");
      if (prev) previousLines = paragraphsFromText(fileText(prev.id), prev.kind);
      if (!previousLines?.length) how += " The previous EAR had no readable text, so the file has no tracked changes.";
    }
    let buf: Buffer | null = null;
    if (tpl) {
      const metaValue = (re: RegExp) => doc.meta.find((m) => re.test(m.label))?.value ?? "";
      const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
      buf = await renderIntoTemplate(tpl.bytes, doc, {
        previousLines,
        revised: !!c.revised,
        revisionNo: c.revision_no,
        cover: { contractNo: c.contract_no || metaValue(/contract\s*no/i), contractor: c.contractor || metaValue(/^contractor/i), claimRef: c.claim_ref || metaValue(/claim/i), date: today, title: metaValue(/contract title/i) || metaValue(/^project/i) },
      });
      how += buf ? " Written into your Word template (its fonts, styles, cover, header and footer are unchanged; numbering regenerated)." : " The Word template could not be used as-is, so the report was laid out in the standard style.";
    }
    if (!buf) buf = await renderEarDocx(doc, { previousLines, revised: !!c.revised, revisionNo: c.revision_no, reference: c.claim_ref || c.contract_no || undefined });
    fs.writeFileSync(outputPath(caseId), buf);
    const clean = c.title.replace(/[^\w\- ]+/g, " ").replace(/\s+/g, " ").replace(/\s*-?\s*rev(ision)?\s*\d+\s*$/i, "").trim().slice(0, 60);
    const name = `EAR - ${clean}${c.revised ? ` - Rev ${c.revision_no}` : ""}.docx`;
    setGeneration(caseId, { status: "Generated", output_name: name, output_json: JSON.stringify(doc), note: how }, user);
    logAudit(getDb(), { registerKey: "ear_cases", recordId: caseId, action: "update", user, summary: `EAR created: ${name}` });
    return { case: getCase(caseId)!, note: how };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setGeneration(caseId, { status: "Failed", note: msg }, user);
    throw e;
  }
}
