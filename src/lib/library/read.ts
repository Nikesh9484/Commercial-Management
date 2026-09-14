import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Database from "better-sqlite3";
import { getDb } from "../db";
import { LIBRARY_INFO, type LibraryKey, type Reading } from "./store";
import { aiEnabled, aiKeyPresent, aiOffReason } from "../ai-switch";

/**
 * Reads a library document and works out where it belongs.
 *
 *   1. Matching against the project's own registers (fast, always on): the ACC references
 *      (031C10, 006C15 …), PO numbers and contractor names found in the text and file name are
 *      compared with the Contracts, Cost report lines and Contractors of the project.
 *   2. The reading engine (Claude), when the server has an API key: the document is read and
 *      the type, title, reference, date, claim reference, time / cost figures and a short
 *      professional summary are extracted; its contractor and contract code are reconciled
 *      with the registers.
 */
export const LIBRARY_MODEL = process.env.LIBRARY_MODEL || process.env.EAR_MODEL || "claude-opus-5";

export function readerConfigured(): boolean {
  // the switch on the Settings page turns every paid call off without removing the key
  return aiEnabled() && aiKeyPresent();
}

interface KnownContract {
  id: number;
  title: string;
  po: string;
  acc: string;
  contractor_id: number | null;
  contractor: string;
  line_code: string;
}
interface KnownContractor {
  id: number;
  name: string;
  acc: string;
}

const GENERIC = new Set(["company", "limited", "ltd", "co", "contracting", "for", "and", "of", "the", "services", "general", "est", "llc", "saudi", "arabia", "engineering", "construction", "international", "trading", "industry", "industries", "partners", "consultants", "consultant", "group", "branch", "sal", "plc", "inc", "corp", "corporation", "middle", "east", "gulf", "arab", "national", "united", "holding", "design", "development", "management", "project", "projects", "works", "systems", "solutions", "technology", "technologies", "supply", "supplies", "factory", "trade", "commercial", "consultancy", "office", "studio"]);

/** Distinctive words of a name (the ones that identify it). */
function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !GENERIC.has(w));
}

export function fragOf(s: string): string {
  const m = /(\d{3}[A-Z]#?\d{2,3})/i.exec(s.replace(/\s+/g, ""));
  return m ? m[1].toUpperCase() : "";
}

function known(db: Database.Database, programmeId: number): { contracts: KnownContract[]; contractors: KnownContractor[] } {
  const contracts = db
    .prepare(
      `SELECT c.id, c.title, COALESCE(c.reef_po_no,'') AS po, COALESCE(c.acc_ref,'') AS acc, c.contractor_id, COALESCE((SELECT name FROM contractors WHERE id = c.contractor_id),'') AS contractor,
              COALESCE((SELECT code FROM cost_lines WHERE id = c.cost_line_id),'') AS line_code
       FROM contracts c WHERE c.programme_id = ?`,
    )
    .all(programmeId) as KnownContract[];
  const ids = new Set(contracts.map((c) => c.contractor_id).filter(Boolean));
  const extra = db.prepare("SELECT DISTINCT contractor_id FROM cost_lines WHERE programme_id = ? AND contractor_id IS NOT NULL").all(programmeId) as { contractor_id: number }[];
  for (const e of extra) ids.add(e.contractor_id);
  const contractors = (db.prepare("SELECT id, name, COALESCE(acc_ref,'') AS acc FROM contractors").all() as KnownContractor[]).filter((c) => ids.size === 0 || ids.has(c.id));
  return { contracts, contractors };
}

export interface Match {
  contractor_id: number | null;
  contract_id: number | null;
  contract_code: string | null;
  po_no: string | null;
  matched_by: string;
  confidence: "High" | "Medium" | "Low" | "None";
}

/** Step 1: match the document against the project's registers. */
export function matchAgainstRegisters(db: Database.Database, programmeId: number, text: string, fileName: string, hints: { contractor?: string; code?: string; po?: string } = {}): Match {
  const { contracts, contractors } = known(db, programmeId);
  const head = `${fileName}\n${hints.code ?? ""}\n${hints.po ?? ""}\n${text.slice(0, 60_000)}`;
  const upper = head.toUpperCase();
  const lower = head.toLowerCase();

  // ACC fragments in the text (e.g. 1TB01006-006C15-SPM-LTR-0201, "031C10", "CN.006C05")
  const fragHits = new Map<string, number>();
  for (const m of upper.matchAll(/(?<![A-Z0-9])(\d{3}[A-Z]\d{2,3})(?![A-Z0-9])/g)) fragHits.set(m[1], (fragHits.get(m[1]) ?? 0) + 1);
  const byFrag = (frag: string) => contracts.filter((c) => (c.acc && fragOf(c.acc) === frag) || (c.line_code && fragOf(c.line_code) === frag));
  let best: { c: KnownContract; score: number; how: string } | null = null;
  for (const [frag, n] of fragHits) {
    for (const c of byFrag(frag)) {
      const score = n * 10;
      if (!best || score > best.score) best = { c, score, how: `ACC ref ${frag} in the document` };
    }
  }
  // PO numbers
  for (const c of contracts) {
    if (!/^\d{6,}$/.test(c.po)) continue;
    const n = (upper.match(new RegExp(`(?<!\\d)${c.po}(?!\\d)`, "g")) ?? []).length;
    if (n && (!best || n * 8 > best.score)) best = { c, score: n * 8, how: `PO ${c.po} in the document` };
  }
  // contractor names
  const nameScore = (name: string) => {
    const t = tokens(name);
    if (!t.length) return 0;
    let hits = 0;
    for (const w of t.slice(0, 3)) {
      const n = (lower.match(new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "g")) ?? []).length;
      if (n) hits += Math.min(n, 20);
    }
    return hits;
  };
  let bestContractor: { c: KnownContractor; score: number } | null = null;
  for (const c of contractors) {
    const s = nameScore(c.name) + (hints.contractor && tokens(hints.contractor).some((w) => tokens(c.name).includes(w)) ? 15 : 0);
    if (s > 0 && (!bestContractor || s > bestContractor.score)) bestContractor = { c, score: s };
  }
  if (best) {
    return { contractor_id: best.c.contractor_id ?? bestContractor?.c.id ?? null, contract_id: best.c.id, contract_code: best.c.acc || fragOf(best.c.line_code) || null, po_no: best.c.po || null, matched_by: best.how, confidence: best.score >= 20 ? "High" : "Medium" };
  }
  if (bestContractor) {
    const mine = contracts.filter((c) => c.contractor_id === bestContractor!.c.id);
    // a contractor with exactly one contract: file it there
    const only = mine.length === 1 ? mine[0] : null;
    return { contractor_id: bestContractor.c.id, contract_id: only?.id ?? null, contract_code: only ? only.acc || fragOf(only.line_code) || null : null, po_no: only?.po ?? null, matched_by: `contractor name "${bestContractor.c.name}" in the document${only ? " (its only contract)" : mine.length > 1 ? ` – ${mine.length} contracts, code not found` : ""}`, confidence: bestContractor.score >= 6 ? (only ? "High" : "Medium") : "Low" };
  }
  return { contractor_id: null, contract_id: null, contract_code: null, po_no: null, matched_by: "no contractor or contract reference found in the document", confidence: "None" };
}

const Extraction = z.object({
  document_type: z.string().describe("One of the allowed document types, or 'Other'."),
  title: z.string().describe("A short descriptive title of the document, e.g. 'EAR – EOT Claim No 1 (Shapoorji)' or 'Contract Agreement – Marina Basin Main Works'."),
  reference: z.string().describe("The document's own reference / letter number / Aconex reference, or '' if none."),
  document_date: z.string().describe("The document date as YYYY-MM-DD, or '' if not stated."),
  contractor_name: z.string().describe("The contractor / consultant the document concerns, as written in the document."),
  contract_code: z.string().describe("The contract / ACC code as written (e.g. 1TB01006-006C15, CN.006C15, 006C15), or ''."),
  po_number: z.string().describe("The purchase order / PO number if written, else ''."),
  claim_reference: z.string().describe("The claim reference / EOT claim number the document deals with, or ''."),
  eot_days_claimed: z.number().nullable().describe("Days of extension of time claimed by the contractor, if stated."),
  eot_days_assessed: z.number().nullable().describe("Days of extension of time assessed / recommended / determined by the Employer, if stated."),
  cost_claimed: z.number().nullable().describe("Amount claimed (SAR), if stated."),
  cost_assessed: z.number().nullable().describe("Amount assessed / determined by the Employer (SAR), if stated."),
  revised_completion_date: z.string().describe("The revised completion date resulting from the assessment (YYYY-MM-DD), or ''."),
  summary: z.string().describe("A professional 3–6 sentence summary of what the document is and what it decides or contains, written for the Commercial Manager."),
  key_points: z.array(z.string()).describe("Up to 6 key points (findings, decisions, key dates, amounts)."),
});

const SYSTEM = `You read commercial documents for a construction Commercial Manager (AMAALA / Triple Bay, Saudi Arabia; amounts in SAR) and file them.
Extract only what the document states; never invent references, dates or figures. Use '' or null when something is not stated.
Dates as YYYY-MM-DD. Numbers as plain numbers (no thousands separators).`;

/** Step 2: the reading engine. Returns null when no key is configured or the document has no readable text. */
export async function readWithEngine(library: LibraryKey, fileName: string, text: string): Promise<z.infer<typeof Extraction> | null> {
  if (!readerConfigured() || !text.trim()) return null;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY, maxRetries: 2, timeout: 4 * 60 * 1000 });
  const body = text.length > 90_000 ? `${text.slice(0, 70_000)}\n\n[… ${text.length - 90_000} characters omitted …]\n\n${text.slice(-20_000)}` : text;
  const kinds = LIBRARY_INFO[library].types;
  const response = await client.messages.parse({
    model: LIBRARY_MODEL,
    max_tokens: 4000,
    output_config: { effort: "medium", format: zodOutputFormat(Extraction) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Library: ${LIBRARY_INFO[library].title}.\nAllowed document types: ${kinds.join(" | ")}.\nFile name: ${fileName}\n\nDOCUMENT TEXT:\n${body}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
}

/** Full reading of a document: registers first, then the engine, reconciled into one Reading. */
export async function readDocument(programmeId: number, library: LibraryKey, fileName: string, text: string): Promise<Reading> {
  const db = getDb();
  let engine: z.infer<typeof Extraction> | null = null;
  let engineNote = "";
  try {
    engine = await readWithEngine(library, fileName, text);
  } catch (e) {
    engineNote = e instanceof Error ? e.message : String(e);
  }
  const match = matchAgainstRegisters(db, programmeId, text, fileName, engine ? { contractor: engine.contractor_name, code: engine.contract_code, po: engine.po_number } : {});
  const iso = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const types = LIBRARY_INFO[library].types;
  const engineType = engine ? (types.find((t) => t.toLowerCase() === engine!.document_type.toLowerCase()) ?? types.find((t) => t.toLowerCase().includes(engine!.document_type.toLowerCase().split(/[^a-z]+/)[0] ?? "§")) ?? engine.document_type.slice(0, 80)) : "";
  const docType = engineType || guessType(library, fileName, text);
  const readStatus: Reading["read_status"] = !text.trim() ? "Unread" : engine ? "Read" : "Partly read";
  return {
    contractor_id: match.contractor_id,
    contract_id: match.contract_id,
    contract_code: match.contract_code ?? (engine?.contract_code ? engine.contract_code.slice(0, 40) : null),
    po_no: match.po_no ?? (engine?.po_number ? engine.po_number.slice(0, 40) : null),
    doc_type: docType,
    title: engine?.title?.slice(0, 200) || fileName.replace(/\.[a-z0-9]+$/i, ""),
    reference: engine?.reference?.slice(0, 160) ?? "",
    doc_date: engine ? iso(engine.document_date) : null,
    claim_ref: engine?.claim_reference?.slice(0, 120) ?? "",
    eot_days_claimed: engine?.eot_days_claimed ?? null,
    eot_days_assessed: engine?.eot_days_assessed ?? null,
    cost_claimed: engine?.cost_claimed ?? null,
    cost_assessed: engine?.cost_assessed ?? null,
    summary: engine?.summary?.slice(0, 4000) ?? (text.trim() ? (readerConfigured() ? `The reading engine could not read this document${engineNote ? ` (${engineNote})` : ""}; it was filed from its references only.` : `Filed from the references found in the document; it was not read and summarised because ${aiOffReason() ?? "the reading engine is not configured"}.`) : "No readable text (scanned PDF or unsupported file type). File it by hand with Change."),
    key_points: engine?.key_points?.slice(0, 6).map((k) => k.slice(0, 300)) ?? [],
    matched_by: match.matched_by + (engine?.contractor_name && !match.contractor_id ? `; the document names "${engine.contractor_name}", which is not a contractor of this project` : ""),
    confidence: match.confidence,
    read_status: readStatus,
  };
}

/** A best guess at the document type from its name and first lines when the engine is not available. */
function guessType(library: LibraryKey, fileName: string, text: string): string {
  const s = `${fileName}\n${text.slice(0, 3000)}`.toLowerCase();
  if (library === "eot") {
    if (/employer'?s assessment|assessment report|\bear\b/.test(s)) return /prolongation|cost/.test(s) && /extension of time|\beot\b/.test(s) ? "EAR – Combined (Time & Cost)" : /prolongation|cost/.test(s) ? "EAR – Prolongation / Cost" : "EAR – Extension of Time";
    if (/determination/.test(s)) return "Determination letter";
    if (/notice/.test(s)) return "Notice / correspondence";
    if (/claim/.test(s)) return "Claim submission";
    return "Other";
  }
  if (/letter of award|letter of acceptance|\bloa\b/.test(s)) return "Letter of Award / Acceptance";
  if (/particular conditions/.test(s)) return "Particular Conditions";
  if (/conditions of contract|general conditions/.test(s)) return "Conditions of Contract";
  if (/bill of quantities|\bboq\b|pricing schedule|schedule of rates/.test(s)) return "Pricing Schedule / BoQ";
  if (/amendment|addendum/.test(s)) return "Amendment / Addendum";
  if (/variation order|change order/.test(s)) return "Variation / Change Order";
  if (/scope of work|specification/.test(s)) return "Scope of Work / Specification";
  if (/bond|guarantee/.test(s)) return "Bond / Guarantee";
  if (/agreement|contract/.test(s)) return "Contract Agreement";
  return "Other";
}
