import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readWorkbookValues } from "../workbook/read";

/**
 * Turns any uploaded document into text the assessment engine can read.
 * PDF, Word, Excel, text-like files (txt, csv, md, xml, json, XER, eml …) are read; images are kept
 * for the report as evidence and described by name; anything else (zip, dwg, msg …) is stored but
 * noted as not readable so the Commercial Manager knows what the engine could not see.
 */
export interface Extracted {
  kind: "pdf" | "word" | "excel" | "text" | "image" | "other";
  text: string;
  note: string | null;
}

/** Text kept per document (about 150 pages) – the engine budget is applied again across the whole case. */
const MAX_CHARS = 600_000;

const TEXT_EXT = new Set(["txt", "csv", "tsv", "md", "rtf", "xml", "json", "xer", "xml", "eml", "log", "htm", "html", "mpx", "ics", "ini", "yaml", "yml"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic"]);

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

function clip(s: string): string {
  const t = s.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) + "\n\n[… document truncated for the engine …]" : t;
}

export async function extractText(name: string, bytes: Buffer, mime = ""): Promise<Extracted> {
  const ext = extOf(name);
  try {
    if (ext === "pdf" || mime === "application/pdf" || (bytes.length > 4 && bytes.subarray(0, 4).toString() === "%PDF")) return await fromPdf(bytes);
    if (ext === "docx" || ext === "docm" || ext === "dotx") return await fromWord(bytes);
    if (ext === "xlsx" || ext === "xlsm" || ext === "xltx") return await fromExcel(name, bytes);
    if (ext === "doc" || ext === "xls" || ext === "ppt" || ext === "pptx" || ext === "msg" || ext === "zip" || ext === "rar" || ext === "7z" || ext === "dwg" || ext === "dxf" || ext === "mpp")
      return { kind: "other", text: "", note: `${ext.toUpperCase()} files are stored with the case but their content cannot be read by the engine. Save as PDF or DOCX/XLSX to have it assessed.` };
    if (IMAGE_EXT.has(ext) || mime.startsWith("image/")) return { kind: "image", text: "", note: "Image – kept as evidence; the engine sees its file name and the folder it sits in." };
    if (TEXT_EXT.has(ext) || mime.startsWith("text/") || looksLikeText(bytes)) {
      const text = bytes.toString("utf8");
      return { kind: "text", text: clip(ext === "xer" ? summariseXer(text) : ext === "html" || ext === "htm" ? stripHtml(text) : text), note: ext === "xer" ? "Primavera XER: activities, calendars and relationships were summarised for the engine." : null };
    }
    return { kind: "other", text: "", note: "Binary file – stored with the case but not readable by the engine." };
  } catch (e) {
    return { kind: ext === "pdf" ? "pdf" : ext.startsWith("doc") ? "word" : ext.startsWith("xl") ? "excel" : "other", text: "", note: `Could not read the content: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function looksLikeText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 4000);
  if (!sample.length) return false;
  let bad = 0;
  for (const b of sample) if (b === 0 || (b < 7 && b !== 0) || (b > 13 && b < 32)) bad++;
  return bad / sample.length < 0.02;
}

function stripHtml(s: string): string {
  return s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/h\d>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function fromPdf(bytes: Buffer): Promise<Extracted> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    const r = await parser.getText();
    const text = clip(r.text ?? "");
    const pages = r.total ?? 0;
    if (text.replace(/\s/g, "").length < 40 * Math.max(1, pages) * 0.2) {
      return { kind: "pdf", text, note: `Scanned PDF (${pages} page${pages === 1 ? "" : "s"}) – little or no selectable text. Run OCR in Adobe Acrobat (Scan & OCR → Recognize Text) and upload again so the engine can read it.` };
    }
    return { kind: "pdf", text, note: null };
  } finally {
    await parser.destroy?.();
  }
}

async function fromWord(bytes: Buffer): Promise<Extracted> {
  const mammoth = await import("mammoth");
  const r = await mammoth.convertToHtml({ buffer: bytes });
  return { kind: "word", text: clip(wordLines(r.value).join("\n")), note: null };
}

const decode = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

/**
 * One line per paragraph, heading or list item, and one line per table row with the cells joined by
 * " | " – the same shape the EAR writer uses, so a previous report lines up for tracked changes.
 */
export function wordLines(html: string): string[] {
  const out: string[] = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>|<(p|h[1-6]|li)[^>]*>([\s\S]*?)<\/\2>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) {
      const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => decode(c[1]));
      if (cells.some((c) => c)) out.push(cells.join(" | "));
    } else {
      const t = decode(m[3]);
      if (t) out.push(t);
    }
  }
  return out;
}

async function fromExcel(name: string, bytes: Buffer): Promise<Extracted> {
  const tmp = path.join(os.tmpdir(), `ear-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.xlsx`);
  fs.writeFileSync(tmp, bytes);
  try {
    const sheets = await readWorkbookValues(tmp);
    const out: string[] = [];
    for (const s of sheets) {
      out.push(`## Sheet: ${s.name}`);
      const rows = [...s.rows.entries()].sort((a, b) => a[0] - b[0]);
      for (const [, cells] of rows) {
        const line = cells
          .slice(1)
          .map((c) => (c == null ? "" : typeof c === "object" && c instanceof Date ? c.toISOString().slice(0, 10) : String(c).replace(/\s+/g, " ")))
          .join(" | ")
          .replace(/(\s*\|\s*)+$/g, "");
        if (line.trim()) out.push(line);
      }
      if (s.truncated) out.push("[… more rows not read …]");
      out.push("");
    }
    return { kind: "excel", text: clip(out.join("\n")), note: null };
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(`${tmp}.values.json`, { force: true });
  }
}

/** Primavera XER: keep the project header, calendars, WBS, activities (dates) and logic – dropped the resource/cost noise. */
function summariseXer(text: string): string {
  const lines = text.split(/\r?\n/);
  const keep = new Set(["PROJECT", "CALENDAR", "PROJWBS", "TASK", "TASKPRED", "SCHEDOPTIONS", "ACTVCODE", "TASKACTV"]);
  const out: string[] = [];
  let table = "";
  let cols: string[] = [];
  let count = 0;
  for (const line of lines) {
    if (line.startsWith("ERMHDR")) {
      out.push(`XER header: ${line.split("\t").slice(1, 6).join(" ")}`);
      continue;
    }
    if (line.startsWith("%T")) {
      table = line.slice(2).trim();
      count = 0;
      if (keep.has(table)) out.push(`\n## ${table}`);
      continue;
    }
    if (!keep.has(table)) continue;
    if (line.startsWith("%F")) {
      cols = line.slice(2).trim().split("\t");
      continue;
    }
    if (line.startsWith("%R")) {
      if (++count > 4000) continue;
      const vals = line.slice(2).trim().split("\t");
      const wanted =
        table === "TASK"
          ? ["task_code", "task_name", "task_type", "status_code", "target_start_date", "target_end_date", "act_start_date", "act_end_date", "early_start_date", "early_end_date", "late_start_date", "late_end_date", "total_float_hr_cnt", "remain_drtn_hr_cnt", "target_drtn_hr_cnt", "wbs_id", "clndr_id"]
          : table === "TASKPRED"
            ? ["task_id", "pred_task_id", "pred_type", "lag_hr_cnt"]
            : table === "PROJWBS"
              ? ["wbs_id", "wbs_short_name", "wbs_name", "parent_wbs_id"]
              : table === "PROJECT"
                ? ["proj_short_name", "plan_start_date", "plan_end_date", "scd_end_date", "last_recalc_date", "sum_data_date"]
                : cols;
      out.push(wanted.map((c) => `${c}=${vals[cols.indexOf(c)] ?? ""}`).join("; "));
    }
  }
  return out.join("\n");
}
