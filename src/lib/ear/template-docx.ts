import JSZip from "jszip";
import { diffWords } from "diff";
import { align, type Aligned } from "./docx";
import type { EarDocument, EarBlock } from "./model";

/**
 * Writes the Employer's Assessment Report INTO the user's own Word template.
 *
 * Nothing about the template's look is touched: styles.xml, numbering, theme, fonts, header and
 * footer, page set-up, the cover page and the revision-history block are carried over as they are.
 * The body is rebuilt from prototypes found in the template – its first Heading 1, Heading 2,
 * numbered body paragraph, table, caption, list item – so every new paragraph has exactly the
 * paragraph properties and run properties the template author used. Only the numbering
 * (1.0 / 1.1 / 1.1.1, Table n) is generated afresh.
 *
 * For a revised submission every difference against the previous EAR is a tracked change by
 * "Commercial Manager" and Track Changes is switched on in the file.
 */
export const REVISION_AUTHOR = "Commercial Manager";

interface El {
  kind: "p" | "tbl" | "sdt" | "other";
  xml: string;
}

interface Proto {
  h1: string;
  h2: string;
  h3: string;
  body: string;
  sub: string | null;
  quote: string | null;
  caption: string | null;
  table: string | null;
  bullet: string | null;
  numbered: string | null;
  /** headings / body carry their own number text (1.0, 1.1.1) followed by a tab */
  manualNumbers: boolean;
}

/* ------------------------------------------------------------------ */
/* Small XML helpers (string based – the parts we touch are simple)     */
/* ------------------------------------------------------------------ */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const t = (s: string) => `<w:t xml:space="preserve">${esc(s)}</w:t>`;

/** Accepts every tracked change so a template that was saved with revisions is read as its final text. */
export function acceptAll(xml: string): string {
  return xml
    // (self-closing <w:del .../> is a paragraph / row mark, not a container – handled below)
    .replace(/<w:del\b[^>]*?(?<!\/)>[\s\S]*?<\/w:del>/g, "")
    .replace(/<w:moveFrom\b[^>]*?(?<!\/)>[\s\S]*?<\/w:moveFrom>/g, "")
    .replace(/<\/?w:ins\b[^>]*>/g, "")
    .replace(/<\/?w:moveTo\b[^>]*>/g, "")
    .replace(/<w:(pPrChange|rPrChange|tblPrChange|trPrChange|tcPrChange|sectPrChange|tblGridChange|numberingChange)\b[^>]*>[\s\S]*?<\/w:\1>/g, "")
    .replace(/<w:(pPrChange|rPrChange|tblPrChange|trPrChange|tcPrChange|del|ins|moveFromRangeStart|moveFromRangeEnd|moveToRangeStart|moveToRangeEnd)\b[^>]*\/>/g, "")
    .replace(/<w:commentRangeStart\b[^>]*\/>|<w:commentRangeEnd\b[^>]*\/>|<w:r>\s*<w:rPr>\s*<w:rStyle w:val="CommentReference"\/>\s*<\/w:rPr>\s*<w:commentReference\b[^>]*\/>\s*<\/w:r>/g, "");
}

/** The top-level children of <w:body>: paragraphs, tables, content controls and whatever else. */
export function topLevel(body: string): El[] {
  const out: El[] = [];
  const re = /<w:(p|tbl|sdt)\b[^>]*?(\/?)>|<\/w:(p|tbl|sdt)>/g;
  let depth = 0;
  let start = 0;
  let last = 0;
  let kind: El["kind"] = "p";
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[3]) {
      // closing tag
      depth--;
      if (depth === 0) {
        out.push({ kind, xml: body.slice(start, re.lastIndex) });
        last = re.lastIndex;
      }
      continue;
    }
    if (m[2] === "/") {
      if (depth === 0) {
        if (m.index > last) out.push({ kind: "other", xml: body.slice(last, m.index) });
        out.push({ kind: m[1] as El["kind"], xml: m[0] });
        last = re.lastIndex;
      }
      continue;
    }
    if (depth === 0) {
      if (m.index > last) out.push({ kind: "other", xml: body.slice(last, m.index) });
      start = m.index;
      kind = m[1] as El["kind"];
    }
    depth++;
  }
  if (last < body.length) out.push({ kind: "other", xml: body.slice(last) });
  return out.filter((e) => e.kind !== "other" || e.xml.trim());
}

const pPrOf = (p: string) => (/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p) ?? /<w:pPr\/>/.exec(p))?.[0] ?? "";
const styleOf = (p: string) => /<w:pStyle w:val="([^"]+)"/.exec(pPrOf(p))?.[1] ?? "";
const outlineOf = (p: string) => /<w:outlineLvl w:val="(\d)"/.exec(pPrOf(p))?.[1];
const hasNumPr = (p: string) => /<w:numPr>/.test(pPrOf(p));
/** The first run's properties – the look of ordinary text in this paragraph. */
function rPrOf(p: string): string {
  const body = p.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, "");
  const runs = [...body.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)];
  // prefer a run that carries visible text
  const withText = runs.find((r) => /<w:t\b/.test(r[1]) && !/^\s*<w:rPr>[\s\S]*<\/w:rPr>\s*<w:t[^>]*>\s*\d+(\.\d+)*\s*<\/w:t>/.test(r[1]));
  const r = withText ?? runs[0];
  if (!r) return "";
  return /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(r[1])?.[0] ?? "";
}
export function textOf(p: string): string {
  return p
    .replace(/<w:pPr>[\s\S]*?<\/w:pPr>/g, "")
    .replace(/<w:tab\/>/g, " ")
    .replace(/<w:br\b[^>]*\/>/g, " ")
    .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
const NUM_RE = /^\d+(\.\d+)*\.?\s/;
const boldIn = (rpr: string) => /<w:b\b/.test(rpr);
const italicIn = (rpr: string) => /<w:i\b/.test(rpr);

function headingLevel(p: string): number {
  const st = styleOf(p);
  const m = /^Heading(\d)$/.exec(st) ?? /^heading(\d)$/i.exec(st);
  if (m) return Number(m[1]);
  const o = outlineOf(p);
  if (o !== undefined) return Number(o) + 1;
  return 0;
}

/** Paragraph properties for a fresh paragraph: the template's, minus page breaks and bookmarks. */
function cleanPPr(ppr: string, extraRPr?: string): string {
  let s = ppr.replace(/<w:pageBreakBefore\/>/g, "").replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, "");
  if (!s) s = "<w:pPr></w:pPr>";
  if (s === "<w:pPr/>") s = "<w:pPr></w:pPr>";
  if (extraRPr) {
    // the paragraph-mark revision goes last inside pPr (before sectPr/pPrChange, which we never carry)
    s = s.replace(/<\/w:pPr>$/, `${extraRPr}</w:pPr>`);
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Template analysis                                                   */
/* ------------------------------------------------------------------ */

export interface TemplateInfo {
  outline: { heading: string; level: number }[];
  /** true when the template is a Word file with a recognisable report body */
  usable: boolean;
}

interface Analysis {
  els: El[];
  firstH1: number;
  proto: Proto;
  bulletNumId: string | null;
  decimalNumId: string | null;
}

function analyse(bodyInner: string, numberingXml: string): Analysis | null {
  const els = topLevel(bodyInner);
  const firstH1 = els.findIndex((e) => e.kind === "p" && headingLevel(e.xml) === 1 && textOf(e.xml).length > 0);
  if (firstH1 < 0) return null;
  const after = els.slice(firstH1);
  const p = (pred: (xml: string) => boolean) => after.find((e) => e.kind === "p" && pred(e.xml))?.xml ?? null;
  const h1 = els[firstH1].xml;
  const h2 = p((x) => headingLevel(x) === 2 && textOf(x).length > 0) ?? h1;
  const h3 = p((x) => headingLevel(x) === 3 && textOf(x).length > 0) ?? h2;
  const bodyP = p((x) => headingLevel(x) === 0 && !hasNumPr(x) && textOf(x).length > 60 && !boldIn(rPrOf(x)) && !italicIn(rPrOf(x)));
  if (!bodyP) return null;
  const sub = p((x) => headingLevel(x) === 0 && !hasNumPr(x) && boldIn(rPrOf(x)) && textOf(x).length > 3 && textOf(x).length < 90 && !NUM_RE.test(textOf(x)) && !/^(table|figure)\s+\d/i.test(textOf(x)));
  const quote = p((x) => headingLevel(x) === 0 && !hasNumPr(x) && italicIn(rPrOf(x)) && !boldIn(rPrOf(x)) && textOf(x).length > 40);
  const caption = p((x) => headingLevel(x) === 0 && /^table\s+\d+\s*[:.–-]/i.test(textOf(x)));
  const table = after.find((e) => e.kind === "tbl" && (e.xml.match(/<w:tr\b/g) ?? []).length >= 2)?.xml ?? null;
  // list prototypes: paragraphs with numbering whose abstract definition is a bullet / decimal
  const abstracts = new Map<string, string>();
  for (const m of numberingXml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const fmt = /<w:lvl\b[^>]*w:ilvl="0"[^>]*>[\s\S]*?<w:numFmt w:val="([^"]+)"/.exec(m[2])?.[1] ?? "";
    abstracts.set(m[1], fmt);
  }
  const nums = new Map<string, string>();
  for (const m of numberingXml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g)) nums.set(m[1], abstracts.get(m[2]) ?? "");
  const numIdOf = (x: string) => /<w:numId w:val="(\d+)"/.exec(pPrOf(x))?.[1] ?? "";
  const bullet = p((x) => hasNumPr(x) && nums.get(numIdOf(x)) === "bullet");
  const numbered = p((x) => hasNumPr(x) && ["decimal", "lowerLetter", "lowerRoman"].includes(nums.get(numIdOf(x)) ?? ""));
  let bulletNumId = bullet ? numIdOf(bullet) : null;
  if (!bulletNumId) for (const [id, fmt] of nums) if (fmt === "bullet") bulletNumId = id;
  let decimalNumId = numbered ? numIdOf(numbered) : null;
  if (!decimalNumId) for (const [id, fmt] of nums) if (fmt === "decimal") decimalNumId = id;
  const manualNumbers = NUM_RE.test(textOf(h1)) && !hasNumPr(h1);
  return { els, firstH1, proto: { h1, h2, h3, body: bodyP, sub, quote, caption, table, bullet, numbered, manualNumbers }, bulletNumId, decimalNumId };
}

async function openTemplate(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes);
  const docFile = zip.file("word/document.xml");
  if (!docFile) return null;
  const xml = acceptAll(await docFile.async("string"));
  const bodyStart = xml.indexOf("<w:body>");
  const bodyEnd = xml.lastIndexOf("</w:body>");
  if (bodyStart < 0 || bodyEnd < 0) return null;
  let inner = xml.slice(bodyStart + 8, bodyEnd);
  // the body's own section properties are the last <w:sectPr> and sit outside any paragraph
  // (a section break inside a paragraph's pPr, e.g. after the cover, must stay where it is)
  const sectIdx = inner.lastIndexOf("<w:sectPr");
  let sectPr = "";
  if (sectIdx >= 0 && !inner.slice(sectIdx).includes("</w:pPr>") && !inner.slice(sectIdx).includes("</w:p>")) {
    sectPr = inner.slice(sectIdx);
    inner = inner.slice(0, sectIdx);
  }
  const numbering = zip.file("word/numbering.xml") ? await zip.file("word/numbering.xml")!.async("string") : "";
  return { zip, head: xml.slice(0, bodyStart + 8), inner, sectPr, tail: xml.slice(bodyEnd), numbering };
}

/** What the engine and the skeleton need to know about a Word template: its headings in order. */
export async function inspectTemplate(bytes: Buffer): Promise<TemplateInfo> {
  try {
    const tpl = await openTemplate(bytes);
    if (!tpl) return { outline: [], usable: false };
    const an = analyse(tpl.inner, tpl.numbering);
    if (!an) return { outline: [], usable: false };
    const outline: TemplateInfo["outline"] = [];
    for (const e of an.els.slice(an.firstH1)) {
      if (e.kind !== "p") continue;
      const lvl = headingLevel(e.xml);
      if (lvl < 1 || lvl > 3) continue;
      // a heading that is only a number (e.g. a stray "5.9" left by an accepted change) is skipped
      const text = textOf(e.xml).replace(/^\d+(\.\d+)*\.?(\s+|$)/, "").trim();
      if (text) outline.push({ heading: text, level: lvl });
    }
    return { outline, usable: outline.length >= 2 };
  } catch (e) {
    console.error("[ear] template could not be read:", e);
    return { outline: [], usable: false };
  }
}

/* ------------------------------------------------------------------ */
/* Building the new body                                               */
/* ------------------------------------------------------------------ */

type Mode = "same" | "inserted" | "changed" | "deleted";

interface Line {
  kind: "h1" | "h2" | "h3" | "sub" | "para" | "note" | "bullet" | "numbered" | "caption" | "thead" | "trow";
  /** as it reads (number included) – the unit of comparison */
  text: string;
  /** number text for manual numbering ("1.1.1"), empty when none */
  num: string;
  body: string;
  cells?: string[];
  table?: number;
  list?: number;
}

const splitRow = (s: string) => s.split(/\s*\|\s*/);

/**
 * The previous report's cover, revision history and table of contents are the template's own and
 * are not compared: the old lines start at the first level-1 heading (the last line that reads like
 * "1.0 Executive Summary" – the contents entries carry a page number after the text).
 */
export function trimCover(prev: string[], firstHeading: string): string[] {
  const key = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase().replace(/^(\d+(?:\.\d+)*)\s+/, "$1");
  let idx = -1;
  const want = key(firstHeading);
  for (let i = 0; i < prev.length; i++) if (key(prev[i]) === want) idx = i;
  if (idx < 0) for (let i = 0; i < prev.length; i++) if (/^1(\.0)?\s+[A-Za-z][^|]*[^\d\s]$/.test(prev[i].trim())) idx = i;
  return idx > 0 ? prev.slice(idx) : prev;
}

export interface TemplateRenderOptions {
  previousLines?: string[] | null;
  revised: boolean;
  revisionNo: number;
  cover: { contractNo: string; contractor: string; claimRef: string; date: string; title: string };
}

export async function renderIntoTemplate(templateBytes: Buffer, doc: EarDocument, opts: TemplateRenderOptions): Promise<Buffer | null> {
  const tpl = await openTemplate(templateBytes);
  if (!tpl) return null;
  const an = analyse(tpl.inner, tpl.numbering);
  if (!an) return null;
  const { proto } = an;
  const track = !!(opts.previousLines && opts.previousLines.length);
  let revId = 5000;
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const rev = (tag: "ins" | "del") => `<w:${tag} w:id="${revId++}" w:author="${REVISION_AUTHOR}" w:date="${stamp}"`;

  /* ---- runs with optional tracked changes ---- */
  const run = (text: string, rpr: string, tab = false) => `<w:r>${rpr}${tab ? "<w:tab/>" : ""}${t(text)}</w:r>`;
  const delRun = (text: string, rpr: string, tab = false) => `${rev("del")}><w:r>${rpr}${tab ? "<w:tab/>" : ""}<w:delText xml:space="preserve">${esc(text)}</w:delText></w:r></w:del>`;
  const insRun = (text: string, rpr: string, tab = false) => `${rev("ins")}>${run(text, rpr, tab)}</w:ins>`;
  /** Text runs for one paragraph / cell. `num` is written as its own run followed by a tab (template style). */
  function runs(text: string, rpr: string, mode: Mode, old: string | undefined, num = ""): string {
    const pieces: string[] = [];
    const numRun = (m: Mode, n: string) => (m === "deleted" ? delRun(n, rpr) : m === "inserted" ? insRun(n, rpr) : run(n, rpr));
    if (!track || mode === "same") {
      if (num) pieces.push(run(num, rpr), run(text, rpr, true));
      else pieces.push(run(text, rpr));
      return pieces.join("");
    }
    if (mode === "inserted" || mode === "deleted") {
      const f = mode === "inserted" ? insRun : delRun;
      if (num) pieces.push(numRun(mode, num), f(text, rpr, true));
      else pieces.push(f(text, rpr));
      return pieces.join("");
    }
    // changed: number first (old number vs new number), then the words
    let oldText = old ?? "";
    let oldNum = "";
    const m = NUM_RE.exec(oldText + " ");
    if (num && m) {
      oldNum = m[0].trim();
      oldText = oldText.slice(m[0].length).trim();
    }
    if (num) {
      if (oldNum === num) pieces.push(run(num, rpr));
      else {
        if (oldNum) pieces.push(delRun(oldNum, rpr));
        pieces.push(insRun(num, rpr));
      }
    }
    let first = true;
    for (const p of diffWords(oldText, text)) {
      const tab = first && !!num;
      first = false;
      if (p.removed) pieces.push(delRun(p.value, rpr, tab));
      else if (p.added) pieces.push(insRun(p.value, rpr, tab));
      else pieces.push(run(p.value, rpr, tab));
    }
    if (first && num) pieces.push(run("", rpr, true));
    return pieces.join("");
  }
  const markFor = (mode: Mode) => (!track || mode === "same" || mode === "changed" ? "" : `<w:rPr>${rev(mode === "inserted" ? "ins" : "del")}/></w:rPr>`);

  /* ---- paragraph factories from the prototypes ---- */
  const para = (protoXml: string, text: string, mode: Mode, old: string | undefined, num = "", forceRPr?: string) => {
    const ppr = cleanPPr(pPrOf(protoXml), markFor(mode));
    const rpr = forceRPr ?? rPrOf(protoXml);
    return `<w:p>${ppr}${runs(text, rpr, mode, old, num)}</w:p>`;
  };
  let bookmarkId = 900;
  const heading = (protoXml: string, text: string, mode: Mode, old: string | undefined, num: string) => {
    const ppr = cleanPPr(pPrOf(protoXml), markFor(mode));
    const rpr = rPrOf(protoXml);
    const id = bookmarkId++;
    return { xml: `<w:p>${ppr}<w:bookmarkStart w:id="${id}" w:name="_TocEar${id}"/>${runs(text, rpr, mode, old, num)}<w:bookmarkEnd w:id="${id}"/></w:p>`, anchor: `_TocEar${id}` };
  };

  /* ---- flatten the document into lines (same order as they are written) ---- */
  const lines: Line[] = [];
  let tableNo = 0;
  let listNo = 0;
  const n = { h1: 0, h2: 0, h3: 0, p: 0 };
  const manual = proto.manualNumbers;
  const push = (l: Line) => lines.push(l);
  const bodyNum = () => {
    n.p++;
    if (!manual) return "";
    return n.h2 ? `${n.h1}.${n.h2}.${n.p}` : `${n.h1}.0.${n.p}`;
  };
  const addTable = (b: EarBlock, captionFallback?: string) => {
    tableNo++;
    const width = Math.max(b.header.length, ...b.rows.map((r) => r.length), 1);
    const id = tableNo;
    const pad = (c: string[]) => Array.from({ length: width }, (_, i) => c[i] ?? "");
    if (b.header.length) push({ kind: "thead", text: pad(b.header).join(" | "), num: "", body: "", cells: pad(b.header), table: id });
    for (const r of b.rows) push({ kind: "trow", text: pad(r).join(" | "), num: "", body: "", cells: pad(r), table: id });
    const cap = b.caption || captionFallback;
    if (cap) push({ kind: "caption", text: `Table ${id}: ${cap}`, num: "", body: "" });
  };
  const glance = (): EarBlock => {
    const s = doc.summary;
    const money = (v: number) => (v ? `SAR ${Math.round(v).toLocaleString("en-US")}` : "–");
    const days = (v: number) => (v ? `${Math.round(v)} days` : "–");
    const rows = [
      ["Extension of time", days(s.eot_claimed_days), days(s.eot_assessed_days)],
      ["Additional payment", money(s.cost_claimed_sar), money(s.cost_assessed_sar)],
    ];
    if (s.recommendation) rows.push(["Employer's position", s.recommendation, ""]);
    return { type: "table", text: "", items: [], caption: "Assessment at a glance", header: ["Item", "Claimed by the Contractor", "Assessed by the Employer"], rows };
  };
  const sections = [...doc.sections];
  if (doc.documents_relied_on.length) sections.push({ heading: "Documents Relied Upon", level: 1, blocks: [{ type: "bullets", text: "", items: doc.documents_relied_on, caption: "", header: [], rows: [] }] });
  if (doc.information_gaps.length) sections.push({ heading: "Information Gaps and Requests to the Contractor", level: 1, blocks: [{ type: "bullets", text: "", items: doc.information_gaps, caption: "", header: [], rows: [] }] });
  let glanceDone = false;
  for (const sec of sections) {
    const text = sec.heading.replace(NUM_RE, "").trim();
    if (sec.level <= 1) {
      n.h1++;
      n.h2 = 0;
      n.h3 = 0;
      n.p = 0;
      const num = manual ? `${n.h1}.0` : "";
      push({ kind: "h1", text: num ? `${num} ${text}` : text, num, body: "" });
      if (!glanceDone && (doc.summary.eot_claimed_days || doc.summary.cost_claimed_sar || doc.summary.recommendation)) {
        glanceDone = true;
        addTable(glance());
      }
    } else if (sec.level === 2) {
      if (!n.h1) n.h1 = 1;
      n.h2++;
      n.p = 0;
      const num = manual ? `${n.h1}.${n.h2}` : "";
      push({ kind: "h2", text: num ? `${num} ${text}` : text, num, body: "" });
    } else {
      push({ kind: proto.sub ? "sub" : "h3", text, num: "", body: "" });
    }
    for (const b of sec.blocks) {
      if (b.type === "paragraph") {
        const num = bodyNum();
        push({ kind: "para", text: num ? `${num} ${b.text}` : b.text, num, body: b.text });
      } else if (b.type === "note") push({ kind: "note", text: b.text, num: "", body: b.text });
      else if (b.type === "bullets") for (const i of b.items) push({ kind: "bullet", text: i, num: "", body: i });
      else if (b.type === "numbered") {
        listNo++;
        b.items.forEach((i, k) => push({ kind: "numbered", text: `${k + 1}. ${i}`, num: "", body: i, list: listNo }));
      } else addTable(b);
    }
  }

  const al: Aligned = track ? align(trimCover(opts.previousLines!, lines[0]?.text ?? ""), lines) : { mode: lines.map(() => "same"), old: lines.map(() => undefined), deletedBefore: new Map() };

  /* ---- write the body ---- */
  const out: string[] = [];
  const toc: { num: string; text: string; anchor: string }[] = [];
  const deletedPara = (text: string) => `<w:p>${cleanPPr(pPrOf(proto.body), `<w:rPr>${rev("del")}/></w:rPr>`)}${runs(text, rPrOf(proto.body), "deleted", undefined)}</w:p>`;
  const flushDeleted = (i: number) => {
    for (const d of al.deletedBefore.get(i) ?? []) out.push(deletedPara(d));
  };
  const bulletPPr = proto.bullet
    ? cleanPPr(pPrOf(proto.bullet))
    : an.bulletNumId && proto.numbered
      ? cleanPPr(pPrOf(proto.numbered)).replace(/<w:numId w:val="\d+"\/>/, `<w:numId w:val="${an.bulletNumId}"/>`)
      : an.bulletNumId
        ? cleanPPr(pPrOf(proto.body)).replace(/<w:ind\b[^>]*\/>/, "").replace(/<w:pPr>/, `<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${an.bulletNumId}"/></w:numPr>`).replace(/<\/w:pPr>$/, '<w:ind w:left="1701" w:hanging="425"/></w:pPr>')
        : null;
  const bulletRPr = proto.bullet ? rPrOf(proto.bullet) : proto.numbered ? rPrOf(proto.numbered) : rPrOf(proto.body);
  const numberedPPr = proto.numbered ? cleanPPr(pPrOf(proto.numbered)) : null;
  const listInstance = new Map<number, string>();
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    flushDeleted(i);
    const mode = al.mode[i];
    const old = al.old[i];
    if (ln.kind === "h1" || ln.kind === "h2" || ln.kind === "h3") {
      const h = heading(ln.kind === "h1" ? proto.h1 : ln.kind === "h2" ? proto.h2 : proto.h3, ln.text.replace(NUM_RE, "").trim(), mode, old, ln.num);
      out.push(h.xml);
      if (ln.kind === "h1") toc.push({ num: ln.num, text: ln.text.replace(NUM_RE, "").trim(), anchor: h.anchor });
    } else if (ln.kind === "sub") out.push(para(proto.sub!, ln.text, mode, old));
    else if (ln.kind === "para") out.push(para(proto.body, ln.body, mode, old, ln.num));
    else if (ln.kind === "note") out.push(para(proto.quote ?? proto.body, ln.text, mode, old, "", proto.quote ? undefined : rPrOf(proto.body).replace(/<w:rPr>/, "<w:rPr><w:i/><w:iCs/>") || "<w:rPr><w:i/><w:iCs/></w:rPr>"));
    else if (ln.kind === "caption") out.push(proto.caption ? para(proto.caption, ln.text, mode, old) : para(proto.body, ln.text, mode, old, "", "<w:rPr><w:b/><w:bCs/><w:sz w:val=\"18\"/><w:szCs w:val=\"18\"/></w:rPr>"));
    else if (ln.kind === "bullet") {
      if (bulletPPr) out.push(`<w:p>${bulletPPr.replace(/<\/w:pPr>$/, `${markFor(mode)}</w:pPr>`)}${runs(ln.text, bulletRPr, mode, old)}</w:p>`);
      else out.push(para(proto.body, ln.text, mode, old, "•"));
    } else if (ln.kind === "numbered") {
      if (numberedPPr && an.decimalNumId) {
        // each list restarts: its own <w:num> would be needed; the template's numbering continues, so number by text instead
        out.push(`<w:p>${numberedPPr.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/, "").replace(/<\/w:pPr>$/, `${markFor(mode)}</w:pPr>`)}${runs(ln.text, rPrOf(proto.numbered!), mode, old)}</w:p>`);
      } else out.push(para(proto.body, ln.body, mode, old, ln.text.split(" ")[0]));
      listInstance.set(ln.list!, "");
    } else {
      // a table: all consecutive lines of the same table id
      const id = ln.table!;
      const rowsXml: string[] = [];
      const width = ln.cells!.length;
      const tableProto = proto.table;
      const headerRow = tableProto ? /<w:tr\b[\s\S]*?<\/w:tr>/.exec(tableProto)?.[0] ?? "" : "";
      const bodyRow = tableProto ? ([...tableProto.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)][1]?.[0] ?? headerRow) : "";
      const cellProps = (rowXml: string) => {
        const tc = /<w:tc>([\s\S]*?)<\/w:tc>/.exec(rowXml)?.[1] ?? "";
        const tcPr = /<w:tcPr>[\s\S]*?<\/w:tcPr>/.exec(tc)?.[0] ?? "<w:tcPr></w:tcPr>";
        const p = /<w:p\b[\s\S]*?<\/w:p>/.exec(tc)?.[0] ?? "<w:p></w:p>";
        return { tcPr: tcPr.replace(/<w:tcW\b[^>]*\/>/, "").replace(/<w:gridSpan\b[^>]*\/>/, "").replace(/<w:vMerge\b[^>]*\/>/, ""), pPr: cleanPPr(pPrOf(p)), rPr: rPrOf(p) };
      };
      const hp = cellProps(headerRow);
      const bp = cellProps(bodyRow);
      const trPrHead = /<w:trPr>[\s\S]*?<\/w:trPr>/.exec(headerRow)?.[0] ?? "<w:trPr><w:tblHeader/></w:trPr>";
      const trPrBody = /<w:trPr>[\s\S]*?<\/w:trPr>/.exec(bodyRow)?.[0] ?? "";
      const tblPr = tableProto ? /<w:tblPr>[\s\S]*?<\/w:tblPr>/.exec(tableProto)?.[0] ?? "" : "";
      const total = Number(/<w:tblW w:w="(\d+)"/.exec(tblPr)?.[1] ?? 9000) || 9000;
      // column widths from the longest text in each column
      const all = lines.filter((l) => l.table === id);
      const weights = Array.from({ length: width }, (_, k) => Math.min(60, Math.max(6, ...all.map((l) => (l.cells![k] ?? "").length))));
      const sum = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => Math.round((total * w) / sum));
      widths[width - 1] += total - widths.reduce((a, b) => a + b, 0);
      const cellXml = (text: string, k: number, props: typeof hp, mode: Mode, oldText: string | undefined) =>
        `<w:tc>${props.tcPr.replace(/<w:tcPr>/, `<w:tcPr><w:tcW w:w="${widths[k]}" w:type="dxa"/>`)}<w:p>${props.pPr}${runs(text, props.rPr, mode, oldText)}</w:p></w:tc>`;
      const rowMark = (mode: Mode) => (!track || mode === "same" || mode === "changed" ? "" : `${rev(mode === "inserted" ? "ins" : "del")}/>`);
      const withMark = (trPr: string, mode: Mode) => {
        const mark = rowMark(mode);
        if (!mark) return trPr;
        return trPr ? trPr.replace(/<\/w:trPr>/, `${mark}</w:trPr>`) : `<w:trPr>${mark}</w:trPr>`;
      };
      while (i < lines.length && lines[i].table === id && (lines[i].kind === "thead" || lines[i].kind === "trow")) {
        for (const d of al.deletedBefore.get(i) ?? []) {
          const cells = splitRow(d);
          rowsXml.push(`<w:tr>${withMark(trPrBody, "deleted")}${Array.from({ length: width }, (_, k) => cellXml(cells[k] ?? "", k, bp, "deleted", undefined)).join("")}</w:tr>`);
        }
        const row = lines[i];
        const m = al.mode[i];
        const oldCells = al.old[i] ? splitRow(al.old[i]!) : undefined;
        const head = row.kind === "thead";
        const props = head ? hp : bp;
        rowsXml.push(
          `<w:tr>${withMark(head ? trPrHead : trPrBody, m)}${row
            .cells!.map((c, k) => {
              const cm: Mode = m === "changed" ? (oldCells && oldCells[k] === c ? "same" : oldCells && oldCells[k] !== undefined ? "changed" : "inserted") : m;
              return cellXml(c, k, props, cm, oldCells?.[k]);
            })
            .join("")}</w:tr>`,
        );
        i++;
      }
      const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
      out.push(`<w:tbl>${tblPr || `<w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders></w:tblPr>`}${grid}${rowsXml.join("")}</w:tbl>`);
      continue;
    }
    i++;
  }
  flushDeleted(lines.length);

  /* ---- cover: the template's own elements with the case values substituted ---- */
  const cover = an.els.slice(0, an.firstH1).map((e) => e.xml);
  const replaceText = (pxml: string, text: string) => {
    // keep the first run's look, drop the rest
    const ppr = pPrOf(pxml);
    return `<w:p>${ppr}${run(text, rPrOf(pxml))}</w:p>`;
  };
  // cover table rows "Label: | value"
  const coverTableIdx = cover.findIndex((x, k) => an.els[k].kind === "tbl" && /contract|contractor|date/i.test(textOf(x)));
  if (coverTableIdx >= 0) {
    cover[coverTableIdx] = cover[coverTableIdx].replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (row) => {
      const cells = [...row.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
      if (cells.length < 2) return row;
      const label = textOf(cells[0]).toLowerCase();
      let value: string | null = null;
      if (/^contract\s*no/.test(label)) value = [opts.cover.contractNo, opts.cover.title].filter(Boolean).join(" - ");
      else if (/^contractor/.test(label)) value = opts.cover.contractor;
      else if (/^date/.test(label)) value = opts.cover.date;
      else if (/^revision/.test(label)) value = opts.revised ? String(opts.revisionNo).padStart(2, "0") : "00";
      else if (/^claim|^reference|^ref/.test(label)) value = opts.cover.claimRef;
      if (!value) return row;
      const p = /<w:p\b[\s\S]*?<\/w:p>/.exec(cells[1])?.[0];
      if (!p) return row;
      const newCell = cells[1].replace(/<w:p\b[\s\S]*<\/w:p>/, replaceText(p, value));
      return row.replace(cells[1], newCell);
    });
  }
  // table of contents: the template's TOC block, refilled with the new level-1 headings
  const tocIdx = cover.findIndex((x) => /TOC\s*\\/.test(x));
  if (tocIdx >= 0) {
    const first = /<w:p\b[\s\S]*?<\/w:p>/.exec(cover[tocIdx])?.[0] ?? "";
    const ppr = cleanPPr(pPrOf(first)) || '<w:pPr><w:pStyle w:val="TOC1"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9060"/></w:tabs></w:pPr>';
    const instr = /<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/.exec(cover[tocIdx])?.[1] ?? 'TOC \\h \\o "1-1"';
    const entries = toc.map(
      (e, k) =>
        `<w:p>${ppr}${k === 0 ? `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` : ""}<w:hyperlink w:anchor="${e.anchor}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/><w:noProof/></w:rPr>${t(e.num)}</w:r><w:r><w:rPr><w:noProof/></w:rPr><w:tab/></w:r><w:r><w:rPr><w:rStyle w:val="Hyperlink"/><w:noProof/></w:rPr>${t(e.text)}</w:r><w:r><w:rPr><w:noProof/></w:rPr><w:tab/></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF ${e.anchor} \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:noProof/></w:rPr>${t("0")}</w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink>${k === toc.length - 1 ? `<w:r><w:fldChar w:fldCharType="end"/></w:r>` : ""}</w:p>`,
    );
    const isSdt = an.els[tocIdx].kind === "sdt";
    cover[tocIdx] = isSdt ? cover[tocIdx].replace(/<w:sdtContent>[\s\S]*<\/w:sdtContent>/, `<w:sdtContent>${entries.join("")}</w:sdtContent>`) : entries.join("");
    // any further paragraphs that were part of the old TOC field (cached entries) are dropped
    for (let k = tocIdx + 1; k < cover.length; k++) {
      if (an.els[k].kind === "p" && /w:val="TOC\d"/.test(cover[k])) cover[k] = "";
    }
  }

  const coverTitleIdx: number[] = [];
  cover.forEach((x, k) => {
    if (an.els[k].kind === "p" && /<w:sz w:val="(4\d|5\d|6\d|7\d)"/.test(x) && textOf(x)) coverTitleIdx.push(k);
  });
  // second big line "for EOT-02" → the claim reference; a "Revision …" line → this revision or removed
  const forIdx = coverTitleIdx.find((k) => /^for\b/i.test(textOf(cover[k])));
  if (forIdx !== undefined && opts.cover.claimRef) cover[forIdx] = replaceText(cover[forIdx], `for ${opts.cover.claimRef}`);
  const revIdx = cover.findIndex((x, k) => an.els[k].kind === "p" && /^revision\s*\d/i.test(textOf(x)));
  const revText = `Revision ${String(opts.revisionNo).padStart(2, "0")} – Revised assessment following the Contractor's revised submission`;
  if (opts.revised) {
    if (revIdx >= 0) cover[revIdx] = replaceText(cover[revIdx], revText);
    else if (forIdx !== undefined) cover.splice(forIdx + 1, 0, replaceText(cover[forIdx], revText).replace(/<w:sz w:val="\d+"\/>/g, '<w:sz w:val="28"/>').replace(/<w:szCs w:val="\d+"\/>/g, '<w:szCs w:val="28"/>'));
  } else if (revIdx >= 0) cover.splice(revIdx, 1);
  const bodyXml = `${cover.join("")}${out.join("")}${tpl.sectPr}`;
  const documentXml = `${tpl.head}${bodyXml}${tpl.tail}`;
  tpl.zip.file("word/document.xml", documentXml);

  /* ---- header / footer: swap the template's contract number and contractor for ours ---- */
  const oldContract = coverTableIdx >= 0 ? (textOf(/<w:tr\b[\s\S]*?<\/w:tr>/.exec(an.els[coverTableIdx].xml)?.[0] ?? "").split("|")[1] ?? "").trim() : "";
  for (const name of Object.keys(tpl.zip.files)) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue;
    let xml = acceptAll(await tpl.zip.file(name)!.async("string"));
    const oldNo = /^(\S+)/.exec(oldContract)?.[1] ?? "";
    if (oldNo && opts.cover.contractNo && oldNo !== opts.cover.contractNo) xml = xml.split(esc(oldNo)).join(esc(opts.cover.contractNo));
    const oldContractor = coverTableIdx >= 0 ? (textOf([...an.els[coverTableIdx].xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((m) => m[0]).find((r) => /^contractor/i.test(textOf(r))) ?? "").split("|")[1] ?? "").trim() : "";
    if (oldContractor && opts.cover.contractor && oldContractor !== opts.cover.contractor) xml = xml.split(esc(oldContractor)).join(esc(opts.cover.contractor));
    tpl.zip.file(name, xml);
  }

  /* ---- footnotes / endnotes of the template body are gone with it: keep only the separators ---- */
  for (const [name, tag] of [
    ["word/footnotes.xml", "footnote"],
    ["word/endnotes.xml", "endnote"],
  ] as const) {
    const f = tpl.zip.file(name);
    if (!f) continue;
    const xml = await f.async("string");
    tpl.zip.file(name, xml.replace(new RegExp(`<w:${tag}\\b(?![^>]*w:type=)[^>]*>[\\s\\S]*?<\\/w:${tag}>`, "g"), ""));
  }

  /* ---- settings: Track Changes on for a revision; fields (TOC page numbers) refresh on opening ---- */
  const sf = tpl.zip.file("word/settings.xml");
  if (sf) {
    let s = await sf.async("string");
    if (track && !/<w:trackRevisions\b/.test(s)) {
      s = /<w:defaultTabStop\b/.test(s) ? s.replace(/<w:defaultTabStop\b/, "<w:trackRevisions/><w:defaultTabStop") : s.replace(/(<w:settings\b[^>]*>)/, "$1<w:trackRevisions/>");
    }
    if (!track) s = s.replace(/<w:trackRevisions\b[^>]*\/>/g, "");
    if (!/<w:updateFields\b/.test(s)) {
      const anchor = /<w:(hdrShapeDefaults|footnotePr|endnotePr|compat)\b/.exec(s);
      s = anchor ? s.slice(0, anchor.index) + '<w:updateFields w:val="true"/>' + s.slice(anchor.index) : s.replace(/<\/w:settings>/, '<w:updateFields w:val="true"/></w:settings>');
    }
    tpl.zip.file("word/settings.xml", s);
  }
  return Buffer.from(await tpl.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
