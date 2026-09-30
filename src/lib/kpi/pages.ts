/**
 * Which pages of a supporting document belong in the KPI pack. The head office wants the few pages
 * that prove the entry – the Aconex workflow transmittal with its approvals, the top page of the DVO
 * or PVO form, the VO letter and the VO form, the instruction – not the drawings, BOQs and
 * attachments behind them. Each page is read and typed from its own wording; the pack takes the key
 * ones, and the selection can be changed by hand on the KPI Report page.
 */

export type PageKind = "transmittal" | "approvals" | "dvo_form" | "pvo_form" | "vo_form" | "ei_form" | "letter" | "mail" | "acknowledgement" | "cover" | "boq" | "blank" | "other";

export const PAGE_KIND_LABEL: Record<PageKind, string> = {
  transmittal: "Workflow transmittal (internal approval)",
  approvals: "Approval history",
  dvo_form: "DVO form",
  pvo_form: "PVO form",
  vo_form: "VO form",
  ei_form: "EI form",
  letter: "Letter",
  mail: "Aconex mail (issued)",
  acknowledgement: "Acknowledgement / distribution",
  cover: "Change decision pack cover",
  boq: "BOQ / pricing",
  blank: "No readable text (drawing, scan or attachment)",
  other: "Other",
};

export function classifyPage(raw: string): PageKind {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  const t = text.toLowerCase();
  const letters = (t.match(/[a-z]/g) ?? []).length;
  if (text.replace(/\s/g, "").length < 40 || letters / Math.max(1, text.replace(/\s/g, "").length) < 0.45) return "blank";
  if (/mail type\s*workflow transmittal|workﬂow transmittal/.test(t)) return "transmittal";
  if (/mail type\s*(variation order|employers? instruction|transmittal|general correspondence|letter)/.test(t)) return "mail";
  if (/mail type\s*acknowledgement/.test(t)) return "acknowledgement";
  if (/determination of variation order|rsg-cm-frm-0014|rsg-cm-frm-0027|rgs-cm-frm-0014/.test(t)) return "dvo_form";
  if (/proposed variation order \(pvo\)|emergency variation order assessment|rsg-cm-frm-0013.*page \d of \d.*variation/.test(t)) return "pvo_form";
  if (/variation order form/.test(t)) return "vo_form";
  if (/employer'?s? instruction \(ei\)|employer instruction \(ei\)|rsg-cm-frm-0007|rsg-cm-frm-0003/.test(t)) return "ei_form";
  if (/change decision pack/.test(t)) return "cover";
  if (/workflow review history|accepted with comments|(\baccepted\b[\s\S]*){2}|review not required/.test(t)) return "approvals";
  if (/acknowledge by|^sent (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\bcc \(\d+\)/.test(t)) return "acknowledgement";
  if (/bill of quantit|\bboq\b|unit rate|\bqty\b[\s\S]*\brate\b[\s\S]*\bamount\b/.test(t)) return "boq";
  if (/letter ref|classification: internal|c\.r: 1010590650|dear sir/.test(t)) return "letter";
  return "other";
}

/** The pages to keep, by the rules the sample packs follow. 1-based, in order. */
export function keyPages(kinds: PageKind[]): number[] {
  const keep = new Set<number>();
  const runLimit: Partial<Record<PageKind, number>> = { pvo_form: 2, ei_form: 2, dvo_form: 2, letter: 2, approvals: 2, acknowledgement: 1, vo_form: 1, cover: 1, mail: 1, transmittal: 1 };
  let prev: PageKind | null = null;
  let run = 0;
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i];
    run = k === prev ? run + 1 : 1;
    prev = k;
    if (k === "blank" || k === "boq" || k === "other") continue;
    // an approval history or acknowledgement only counts right after the mail it belongs to
    if (k === "approvals" || k === "acknowledgement") {
      const before = kinds.slice(Math.max(0, i - 3), i);
      if (!before.some((b) => b === "transmittal" || b === "mail" || b === "acknowledgement" || b === "approvals")) continue;
    }
    if (run <= (runLimit[k] ?? 1)) keep.add(i + 1);
  }
  if (!keep.size) for (let i = 0; i < kinds.length && keep.size < 2; i++) if (kinds[i] !== "blank") keep.add(i + 1);
  if (!keep.size && kinds.length) keep.add(1);
  return [...keep].sort((a, b) => a - b).slice(0, 12);
}

/**
 * The pages a given part of the pack wants from a file: an approval part takes the workflow
 * transmittal and its review history, a front-page part the first page(s) of the form, the VO-issued
 * part the Aconex mail or letter. When the file holds none of those, the general key pages are taken.
 */
export function keyPagesFor(section: string, kinds: PageKind[]): number[] {
  const want: Record<string, PageKind[]> = {
    dvo_approval: ["transmittal", "approvals"],
    pvo_vo_approval: ["transmittal", "approvals"],
    dvo_front: ["dvo_form"],
    pvo_vo_front: ["pvo_form", "vo_form", "cover"],
    vo_issued: ["mail", "letter", "acknowledgement"],
  };
  const wanted = want[section];
  if (!wanted) return keyPages(kinds);
  const keep: number[] = [];
  const limit: Partial<Record<PageKind, number>> = { transmittal: 2, approvals: 2, dvo_form: 2, pvo_form: 2, vo_form: 2, cover: 1, mail: 2, letter: 2, acknowledgement: 1 };
  const used: Partial<Record<PageKind, number>> = {};
  let prev: PageKind | null = null;
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i];
    if (wanted.includes(k)) {
      // an approval history only counts on the heels of its transmittal
      if (k === "approvals" && !(prev === "transmittal" || prev === "approvals" || prev === "mail")) {
        prev = k;
        continue;
      }
      if ((used[k] ?? 0) < (limit[k] ?? 1)) {
        keep.push(i + 1);
        used[k] = (used[k] ?? 0) + 1;
      }
    }
    prev = k;
    if (keep.length >= 6) break;
  }
  return keep.length ? keep : keyPages(kinds).slice(0, 4);
}

/** "1-3, 5" → [1, 2, 3, 5] within 1..count; an empty or unreadable selection means every page. */
export function parsePages(selection: string | null | undefined, count: number): number[] {
  const s = String(selection ?? "").trim().toLowerCase();
  if (!s || s === "all") return Array.from({ length: count }, (_, i) => i + 1);
  const out = new Set<number>();
  for (const part of s.split(/[,;\s]+/)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= count) out.add(i);
  }
  return out.size ? [...out].sort((a, b) => a - b) : Array.from({ length: count }, (_, i) => i + 1);
}

/** [1, 2, 3, 5] → "1-3, 5". */
export function formatPages(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i + 1 ? `${sorted[i]}-${sorted[j]}` : j === i + 1 ? `${sorted[i]}, ${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(", ");
}

/** Reads every page's text and types it; null when the file is not a readable PDF. */
export async function readPdfPages(bytes: Buffer): Promise<{ count: number; kinds: PageKind[] } | null> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const r = await parser.getText();
      const kinds: PageKind[] = [];
      for (let i = 1; i <= (r.total ?? 0); i++) kinds.push(classifyPage(r.getPageText(i)));
      return { count: r.total ?? kinds.length, kinds };
    } finally {
      await parser.destroy?.();
    }
  } catch {
    return null;
  }
}
