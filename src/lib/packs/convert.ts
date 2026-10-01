/**
 * Files that are not PDFs, turned into PDF pages so they go into the compiled pack rather than being
 * listed: pictures (JPEG in all its spellings, PNG), e-mails (.eml and .msg – headers and text),
 * Word (.docx – the text), Excel (.xlsx – every sheet as a table), PowerPoint (.pptx – every slide's
 * text with its pictures) and plain text. Nothing is sent anywhere; the conversion runs here.
 */
import PDFDocument from "pdfkit";
import JSZip from "jszip";

type Doc = InstanceType<typeof PDFDocument>;
const W = 595.28;
const H = 841.89;
const M = 42;
const TW = W - M * 2;

const ext = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
export const isJpeg = (name: string, mime = "") => /^(jpe?g|jfif|jpe|jif)$/.test(ext(name)) || (!ext(name) && /image\/jpe?g/i.test(mime));
export const isPng = (name: string, mime = "") => ext(name) === "png" || (!ext(name) && /image\/png/i.test(mime));
/** what the pack can turn into pages by itself */
export const convertible = (name: string) => ["eml", "msg", "docx", "dotx", "docm", "xlsx", "xlsm", "pptx", "txt", "csv", "md", "log", "json", "rtf"].includes(ext(name));

function newDoc(title: string, landscape = false): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({ size: "A4", layout: landscape ? "landscape" : "portrait", margin: M, bufferPages: true, info: { Title: title } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  return { doc, done };
}
const clean = (t: string) => String(t ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/[^\x09\x0A\x20-\x7E -ɏ‐-‧€]/g, "").replace(/\n{3,}/g, "\n\n");

function heading(doc: Doc) {
  doc.y = M;
  doc.fillColor("#26292E");
}
function finish(doc: Doc) {
  doc.end();
}

/* ------------------------------------------------------------------ */
/* e-mail                                                              */

function decodeQuoted(s: string): string {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}
function decodeHeader(s: string): string {
  return s.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_m, _cs, enc, text) => (enc.toUpperCase() === "B" ? Buffer.from(text, "base64").toString("utf8") : decodeQuoted(text.replace(/_/g, " "))));
}
function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n[ \t]+/g, "\n");
}
/** the headers and the readable body of an .eml file (the plain-text part, else the HTML part as text) */
export function parseEml(bytes: Buffer): { headers: [string, string][]; body: string; attachments: string[] } {
  const raw = bytes.toString("utf8");
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  const headerLines = head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  const get = (k: string) => decodeHeader(headerLines.find((l) => l.toLowerCase().startsWith(`${k.toLowerCase()}:`))?.slice(k.length + 1).trim() ?? "");
  const headers: [string, string][] = [["From", get("From")], ["To", get("To")], ["Cc", get("Cc")], ["Date", get("Date")], ["Subject", get("Subject")]].filter(([, v]) => v) as [string, string][];
  const bodyRaw = rest.join("\n\n");
  const ctype = get("Content-Type");
  const boundary = ctype.match(/boundary="?([^";]+)"?/i)?.[1];
  const parts: { type: string; enc: string; body: string; name?: string }[] = [];
  const split = (text: string, b: string) => {
    for (const piece of text.split(new RegExp(`--${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\r?\\n`)).slice(1)) {
      const [ph, ...pb] = piece.split(/\r?\n\r?\n/);
      const h = ph.replace(/\r?\n[ \t]+/g, " ");
      const type = h.match(/content-type:\s*([^;\r\n]+)/i)?.[1]?.trim().toLowerCase() ?? "";
      const inner = h.match(/boundary="?([^";\r\n]+)"?/i)?.[1];
      if (inner) {
        split(pb.join("\n\n"), inner);
        continue;
      }
      const enc = h.match(/content-transfer-encoding:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() ?? "";
      const name = h.match(/(?:file)?name="?([^";\r\n]+)"?/i)?.[1];
      parts.push({ type, enc, body: pb.join("\n\n"), name });
    }
  };
  if (boundary) split(bodyRaw, boundary);
  else parts.push({ type: ctype.split(";")[0].toLowerCase() || "text/plain", enc: get("Content-Transfer-Encoding").toLowerCase(), body: bodyRaw });
  const decode = (p: { enc: string; body: string }) => (p.enc === "base64" ? Buffer.from(p.body.replace(/\s+/g, ""), "base64").toString("utf8") : p.enc === "quoted-printable" ? decodeQuoted(p.body) : p.body);
  const text = parts.find((p) => p.type === "text/plain" && !p.name);
  const html = parts.find((p) => p.type === "text/html" && !p.name);
  const body = text ? decode(text) : html ? stripHtml(decode(html)) : "";
  const attachments = parts.filter((p) => p.name).map((p) => p.name!);
  return { headers, body: body.trim(), attachments };
}

/** an Outlook .msg: the readable strings of its subject, sender and body streams */
function parseMsg(bytes: Buffer): { headers: [string, string][]; body: string } {
  // the properties sit in named streams; without a full OLE reader the unicode body is found by its tag
  const utf16 = (tag: string) => {
    const key = Buffer.from(`__substg1.0_${tag}001F`, "utf16le");
    const at = bytes.indexOf(key);
    if (at < 0) return "";
    return "";
  };
  void utf16;
  const text = bytes.toString("latin1");
  const unicodeRuns = (bytes.toString("utf16le").match(/[\x20-\x7E -ɏ\n\r]{40,}/g) ?? []).map((s) => s.trim());
  const subject = (text.match(/Subject:\s*([^\r\n]{3,120})/) ?? [])[1] ?? "";
  const body = unicodeRuns.sort((a, b) => b.length - a.length)[0] ?? "";
  return { headers: subject ? [["Subject", subject]] : [], body: body.replace(/\r/g, "\n") };
}

async function emailPdf(bytes: Buffer, name: string): Promise<Buffer> {
  const parsed = ext(name) === "msg" ? { ...parseMsg(bytes), attachments: [] as string[] } : parseEml(bytes);
  const { doc, done } = newDoc(name);
  heading(doc);
  doc.font("Helvetica-Bold").fontSize(12).text(clean(parsed.headers.find(([k]) => k === "Subject")?.[1] ?? name), M, doc.y, { width: TW });
  doc.y += 8;
  const row = (k: string, v: string) => {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(9).text(`${k}:`, M, y, { width: 70, lineBreak: false });
    doc.font("Helvetica").fontSize(9).text(clean(v), M + 74, y, { width: TW - 74 });
    doc.y = Math.max(doc.y, y + 12);
  };
  for (const [k, v] of parsed.headers) if (k !== "Subject") row(k, v);
  if (parsed.attachments.length) row("Attachments", parsed.attachments.join(", "));
  doc.y += 6;
  doc.moveTo(M, doc.y).lineTo(W - M, doc.y).lineWidth(0.5).stroke("#C9CBCE");
  doc.y += 10;
  doc.font("Helvetica").fontSize(9.5).text(clean(parsed.body) || "(no readable text in this message)", M, doc.y, { width: TW, lineGap: 1.5 });
  finish(doc);
  return done;
}

/* ------------------------------------------------------------------ */
/* text, Word, Excel, PowerPoint                                       */

async function textPdf(text: string, name: string): Promise<Buffer> {
  const { doc, done } = newDoc(name);
  heading(doc);
  doc.font("Helvetica").fontSize(9.5).text(clean(text) || "(empty)", M, doc.y, { width: TW, lineGap: 1.5 });
  finish(doc);
  return done;
}

async function docxPdf(bytes: Buffer, name: string): Promise<Buffer> {
  const mammoth = (await import("mammoth")) as unknown as { extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }> };
  const { value } = await mammoth.extractRawText({ buffer: bytes });
  return textPdf(value, name);
}

async function xlsxPdf(bytes: Buffer, name: string): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const { doc, done } = newDoc(name, true);
  const PW = H;
  const PTW = PW - M * 2;
  let first = true;
  for (const ws of wb.worksheets) {
    if (ws.state === "hidden" || ws.state === "veryHidden") continue;
    if (!first) doc.addPage();
    first = false;
    doc.fillColor("#6B6F75").font("Helvetica").fontSize(7.5).text(`Excel workbook · ${name} · sheet ${ws.name}`, M, 22, { width: PTW, lineBreak: false });
    doc.moveTo(M, 34).lineTo(PW - M, 34).lineWidth(0.5).stroke("#C9CBCE");
    doc.y = 48;
    doc.fillColor("#26292E");
    const rows: string[][] = [];
    let maxCols = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const v = cell.value;
        const text = v === null || v === undefined ? "" : typeof v === "object" && "result" in (v as object) ? String((v as { result?: unknown }).result ?? "") : typeof v === "object" && "richText" in (v as object) ? (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("") : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
        cells[col - 1] = text;
      });
      if (cells.some((c) => c && c.trim())) {
        rows.push(cells.map((c) => c ?? ""));
        maxCols = Math.max(maxCols, cells.length);
      }
    });
    const cols = Math.min(maxCols, 14);
    const colW = PTW / Math.max(1, cols);
    const size = cols > 10 ? 6 : cols > 7 ? 7 : 8;
    for (const r of rows.slice(0, 2000)) {
      const cellLines = r.slice(0, cols).map((c) => doc.heightOfString(clean(c) || " ", { width: colW - 4 }) || 10);
      const hRow = Math.min(60, Math.max(11, ...cellLines.map((h) => h + 3)));
      if (doc.y + hRow > H - 40) {
        doc.addPage();
        doc.y = 48;
      }
      for (let i = 0; i < cols; i++) {
        doc.rect(M + i * colW, doc.y, colW, hRow).lineWidth(0.3).stroke("#C9CBCE");
        doc.fontSize(size).text(clean(r[i] ?? ""), M + i * colW + 2, doc.y + 2, { width: colW - 4, height: hRow - 3, ellipsis: true });
      }
      doc.y += hRow;
    }
  }
  finish(doc);
  return done;
}

async function pptxPdf(bytes: Buffer, name: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const { doc, done } = newDoc(name, true);
  const PW = H;
  const PH = W;
  const PTW = PW - M * 2;
  let first = true;
  for (const sn of slideNames) {
    const xml = await zip.file(sn)!.async("string");
    // the slide's paragraphs, each <a:p> on its own line
    const paras = (xml.match(/<a:p>[\s\S]*?<\/a:p>|<a:p [^>]*>[\s\S]*?<\/a:p>/g) ?? []).map((p) => (p.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? []).map((t) => t.replace(/^<a:t>|<\/a:t>$/g, "")).join("")).map((t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim()).filter(Boolean);
    // the pictures: the relationships of the slide name the media files
    const rels = (await zip.file(sn.replace("slides/", "slides/_rels/").replace(/\.xml$/, ".xml.rels"))?.async("string")) ?? "";
    const media = [...rels.matchAll(/Target="\.\.\/media\/([^"]+)"/g)].map((m) => `ppt/media/${m[1]}`).filter((m) => /\.(png|jpe?g|jfif)$/i.test(m));
    if (!first) doc.addPage();
    first = false;
    doc.y = M;
    doc.fillColor("#26292E");
    if (paras.length) {
      doc.font("Helvetica-Bold").fontSize(13).text(clean(paras[0]), M, doc.y, { width: PTW });
      doc.y += 6;
      doc.font("Helvetica").fontSize(10);
      for (const p of paras.slice(1, 40)) {
        if (doc.y > PH - 60) break;
        doc.text(clean(p), M, doc.y, { width: PTW, lineGap: 1.5, height: PH - 40 - doc.y, ellipsis: true });
        doc.y += 3;
      }
    }
    // pictures beneath the text, as large as the room allows
    let y = doc.y + 8;
    for (const m of media.slice(0, 4)) {
      const img = await zip.file(m)?.async("nodebuffer");
      if (!img) continue;
      const room = PH - 40 - y;
      if (room < 80) break;
      try {
        doc.image(img, M, y, { fit: [PTW, room], align: "center" });
        y += Math.min(room, PTW * 0.5625) + 8;
      } catch {
        /* a picture pdfkit cannot place is left out */
      }
    }
  }
  if (first) {
    heading(doc);
    doc.font("Helvetica").fontSize(9.5).text("(no slides found)", M, doc.y);
  }
  finish(doc);
  return done;
}

/** The file as PDF pages, or null when it is a kind nothing here can turn into pages. */
export async function convertToPdf(bytes: Buffer, name: string): Promise<{ pdf: Buffer; kind: string } | null> {
  const e = ext(name);
  try {
    if (e === "eml" || e === "msg") return { pdf: await emailPdf(bytes, name), kind: "e-mail" };
    if (["docx", "dotx", "docm"].includes(e)) return { pdf: await docxPdf(bytes, name), kind: "Word document" };
    if (["xlsx", "xlsm"].includes(e)) return { pdf: await xlsxPdf(bytes, name), kind: "Excel workbook" };
    if (e === "pptx") return { pdf: await pptxPdf(bytes, name), kind: "presentation" };
    if (["txt", "csv", "md", "log", "json", "rtf"].includes(e)) return { pdf: await textPdf(bytes.toString("utf8").replace(/\\[a-z]+\d* ?|[{}]/g, e === "rtf" ? "" : "$&"), name), kind: "text" };
  } catch (err) {
    console.error("pack: could not convert", name, err instanceof Error ? err.message : err);
    return null;
  }
  return null;
}
