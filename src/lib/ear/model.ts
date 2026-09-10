/**
 * The Employer's Assessment Report as structured content: what the engine produces and what the
 * Word writer renders. Kept free of server-only imports (shared with the browser for previews).
 */
export type EarBlockType = "paragraph" | "bullets" | "numbered" | "table" | "note";

export interface EarBlock {
  type: EarBlockType;
  /** paragraph / note text */
  text: string;
  /** bullets / numbered items */
  items: string[];
  /** table: caption, header row and body rows (strings; amounts already formatted) */
  caption: string;
  header: string[];
  rows: string[][];
}

export interface EarSection {
  heading: string;
  /** 1 = main heading, 2 = sub-heading, 3 = minor heading */
  level: number;
  blocks: EarBlock[];
}

export interface EarSummary {
  eot_claimed_days: number;
  eot_assessed_days: number;
  cost_claimed_sar: number;
  cost_assessed_sar: number;
  /** One-line position, e.g. "Partially substantiated – 41 days recommended, no additional cost." */
  recommendation: string;
}

export interface EarDocument {
  title: string;
  subtitle: string;
  /** Cover block: Project, Employer, Contractor, Contract No, Claim ref, Submission ref / date, Report revision, Report date, Prepared by */
  meta: { label: string; value: string }[];
  summary: EarSummary;
  sections: EarSection[];
  /** Documents the engine relied on (file names) */
  documents_relied_on: string[];
  /** Gaps: what the contractor has not evidenced / what the Employer should request */
  information_gaps: string[];
}

/** JSON schema handed to the engine as the required output shape. */
export const EAR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "subtitle", "meta", "summary", "sections", "documents_relied_on", "information_gaps"],
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    meta: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } } },
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["eot_claimed_days", "eot_assessed_days", "cost_claimed_sar", "cost_assessed_sar", "recommendation"],
      properties: { eot_claimed_days: { type: "number" }, eot_assessed_days: { type: "number" }, cost_claimed_sar: { type: "number" }, cost_assessed_sar: { type: "number" }, recommendation: { type: "string" } },
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "level", "blocks"],
        properties: {
          heading: { type: "string" },
          level: { type: "integer" },
          blocks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "text", "items", "caption", "header", "rows"],
              properties: {
                type: { type: "string", enum: ["paragraph", "bullets", "numbered", "table", "note"] },
                text: { type: "string" },
                items: { type: "array", items: { type: "string" } },
                caption: { type: "string" },
                header: { type: "array", items: { type: "string" } },
                rows: { type: "array", items: { type: "array", items: { type: "string" } } },
              },
            },
          },
        },
      },
    },
    documents_relied_on: { type: "array", items: { type: "string" } },
    information_gaps: { type: "array", items: { type: "string" } },
  },
} as const;

export const para = (text: string): EarBlock => ({ type: "paragraph", text, items: [], caption: "", header: [], rows: [] });
export const note = (text: string): EarBlock => ({ type: "note", text, items: [], caption: "", header: [], rows: [] });
export const bullets = (items: string[]): EarBlock => ({ type: "bullets", text: "", items, caption: "", header: [], rows: [] });
export const table = (caption: string, header: string[], rows: string[][]): EarBlock => ({ type: "table", text: "", items: [], caption, header, rows });

/** Cleans whatever the engine returned into a well-formed document. */
export function normaliseEar(raw: unknown): EarDocument {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (v == null ? "" : String(v)).trim();
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const arr = <T,>(v: unknown, f: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(f).filter((x): x is T => x != null) : []);
  const sum = (o.summary && typeof o.summary === "object" ? o.summary : {}) as Record<string, unknown>;
  return {
    title: s(o.title) || "Employer's Assessment Report",
    subtitle: s(o.subtitle),
    meta: arr(o.meta, (m) => {
      const r = (m ?? {}) as Record<string, unknown>;
      return s(r.label) ? { label: s(r.label), value: s(r.value) } : null;
    }),
    summary: { eot_claimed_days: n(sum.eot_claimed_days), eot_assessed_days: n(sum.eot_assessed_days), cost_claimed_sar: n(sum.cost_claimed_sar), cost_assessed_sar: n(sum.cost_assessed_sar), recommendation: s(sum.recommendation) },
    sections: arr(o.sections, (sec) => {
      const r = (sec ?? {}) as Record<string, unknown>;
      const heading = s(r.heading);
      if (!heading) return null;
      const level = Math.min(3, Math.max(1, Math.round(n(r.level) || 1)));
      const blocks = arr<EarBlock>(r.blocks, (b) => {
        const x = (b ?? {}) as Record<string, unknown>;
        const type = (["paragraph", "bullets", "numbered", "table", "note"].includes(s(x.type)) ? s(x.type) : "paragraph") as EarBlockType;
        const items = arr(x.items, (i) => (s(i) ? s(i) : null));
        const header = arr(x.header, (i) => s(i));
        const rows = arr(x.rows, (row) => (Array.isArray(row) ? row.map(s) : null)).filter((row) => row.some((c) => c));
        const block: EarBlock = { type, text: s(x.text), items, caption: s(x.caption), header, rows };
        if (type === "table" && !header.length && !rows.length) return null;
        if ((type === "bullets" || type === "numbered") && !items.length) return block.text ? { ...block, type: "paragraph" as const } : null;
        if ((type === "paragraph" || type === "note") && !block.text) return null;
        return block;
      });
      return { heading, level, blocks };
    }),
    documents_relied_on: arr(o.documents_relied_on, (i) => (s(i) ? s(i) : null)),
    information_gaps: arr(o.information_gaps, (i) => (s(i) ? s(i) : null)),
  };
}

/** Every line of the document as plain text, in reading order (used for revisions and previews). */
export function earPlainLines(doc: EarDocument): string[] {
  const out: string[] = [doc.title];
  if (doc.subtitle) out.push(doc.subtitle);
  for (const m of doc.meta) out.push(`${m.label}: ${m.value}`);
  for (const sec of doc.sections) {
    out.push(sec.heading);
    for (const b of sec.blocks) {
      if (b.type === "paragraph" || b.type === "note") out.push(b.text);
      else if (b.type === "bullets" || b.type === "numbered") out.push(...b.items);
      else {
        if (b.caption) out.push(b.caption);
        if (b.header.length) out.push(b.header.join(" | "));
        for (const r of b.rows) out.push(r.join(" | "));
      }
    }
  }
  return out;
}
