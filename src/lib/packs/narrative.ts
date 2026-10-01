import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { aiEnabled, aiKeyPresent } from "../ai-switch";
import { getDb } from "../db";
import type { PackCase, PackValues } from "./shared";

export const AI_WORDING_AVAILABLE = () => aiEnabled() && aiKeyPresent();

/**
 * The wording of a PVO pack's annexures – the Employer's letter, the VO particulars, the executive
 * summary, the contractual basis, the assessment and the budget treatment – is written from the
 * pack's values by fixed sentences. When the AI switch is on and a key is present, the same wording
 * is drafted from the values instead, in the voice of the approved packs, and kept with the pack so
 * it is drafted once; it is dropped by itself when the values it was written from change. Nothing
 * here is visible when the switch is off, and the pack is produced either way.
 */

export const PACK_MODEL = process.env.PACK_MODEL || process.env.EAR_MODEL || "claude-opus-5";

const NarrativeSchema = z.object({
  letter_paragraphs: z.array(z.string()).describe("The paragraphs of the Employer's letter issuing the Variation Order, 5 to 8, in order"),
  vo_bullets: z.array(z.string()).describe("The lines of the Variation Order's 'particulars' box: an opening sentence then bullet lines starting with '• '"),
  executive_summary: z.array(z.string()).describe("The paragraphs of the executive summary of the change assessment pack, 3 to 6"),
  basis_rows: z.array(z.object({ clause: z.string(), title: z.string(), application: z.string() })).describe("The contractual basis table: each clause relied on, its title and how it applies to this change"),
  assessment_basis: z.string().describe("How the value was assessed"),
  assessment_evidence: z.string().describe("Where the evidence sits in the pack"),
  assessment_exclusions: z.array(z.string()).describe("Exclusions and the time impact, one per line"),
  budget_treatment: z.string().describe("The budget treatment under the option chosen (A: no additional budget, B: transfer, C: additional budget)"),
  emergency_circumstances: z.string().describe("For an Emergency Variation Order: the description of the emergency circumstances, 2 to 4 sentences from the facts given; empty when the change is not an emergency"),
});

const INPUT_KEYS = ["title", "scope", "reason", "contractual_basis", "root_cause", "rom_basis", "cost_items", "omit", "add", "total_value", "time_impact", "time_comments", "budget_source", "budget_line", "budget_to_line", "budget_available", "eac_included", "eac_explanation", "contractor", "contract_no", "contract_title", "project_name", "works_package", "rfc_ref", "instruction_ref", "instruction_text", "ei_no", "pvo_no", "date", "commencement_date", "cost_subject", "cost_scope", "employer_rep", "employer_rep_position"];

const SYSTEM = `You draft the wording of a Proposed Variation Order (PVO) pack for the Employer's commercial team on the AMAALA / Triple Bay development (Red Sea Global, Saudi Arabia; FIDIC-based contract; amounts in SAR).
Write in the formal, measured voice of an Employer's variation pack: plain sentences, defined terms capitalised, sub-clauses cited as "Sub-Clause 12.1 [Employer's Right to Vary]".
Use only the facts given. Never invent references, dates, figures, names or clauses; where something is not given, write around it. Amounts are written as "SAR 126,833.05"; a credit (negative value) is a recovery from the Contractor by reduction of the Contract Price.`;

const hashOf = (values: PackValues) => crypto.createHash("sha1").update(INPUT_KEYS.map((k) => `${k}=${values[k] ?? ""}`).join("\n")).digest("hex");

/** The values with their drafted wording when the AI is on; the values as they are otherwise. */
export async function withNarrative(c: PackCase, values: PackValues): Promise<PackValues> {
  if (!aiEnabled() || !aiKeyPresent()) return values;
  const hash = hashOf(values);
  if (values.__narrative && values.__narrative_hash === hash) {
    try {
      const d = JSON.parse(values.__narrative) as { emergency_circumstances?: string };
      if (!values.emergency_circumstances && d.emergency_circumstances) return { ...values, emergency_circumstances: d.emergency_circumstances };
    } catch {
      /* the drafted wording is read again below */
    }
    return values;
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY, maxRetries: 2, timeout: 4 * 60 * 1000 });
    const facts = INPUT_KEYS.filter((k) => String(values[k] ?? "").trim())
      .map((k) => `${k}: ${String(values[k]).slice(0, 4000)}`)
      .join("\n");
    const response = await client.messages.parse({
      model: PACK_MODEL,
      max_tokens: 6000,
      output_config: { effort: "medium", format: zodOutputFormat(NarrativeSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Draft the wording of the PVO pack from these values.\n\n${facts}` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return values;
    const next: PackValues = { ...values, __narrative: JSON.stringify(response.parsed_output), __narrative_hash: hash };
    if (!next.emergency_circumstances && response.parsed_output.emergency_circumstances) next.emergency_circumstances = response.parsed_output.emergency_circumstances;
    getDb().prepare("UPDATE pack_cases SET values_json = ? WHERE id = ?").run(JSON.stringify(next), c.id);
    return next;
  } catch (e) {
    console.error("pack wording could not be drafted – the fixed wording is used:", e);
    return values;
  }
}

/* ------------------------------------------------------------------ */
/* the change itself, worded for the PVO form                           */

const WordingSchema = z.object({
  title: z.string().describe("A short title of the variation, as the approved PVOs name them (one line, no reference numbers)"),
  scope: z.string().describe("Scope of works / services (brief): what the Contractor is to do, as a short paragraph followed by bullet lines starting with '• ' where there are distinct items"),
  reason: z.string().describe("Reason for the Proposed Variation Order: the justification, then a line 'Benefits:' followed by bullet lines starting with '• ' where benefits apply"),
  contractual_basis: z.string().describe("Contractual basis for variation entitlement: the sub-clauses relied on and one or two sentences on how they apply, in the voice of the approved PVOs"),
});

const WORDING_SYSTEM = `You word the change of a Proposed Variation Order (PVO) for the Employer's commercial team on the AMAALA / Triple Bay development (Red Sea Global, Saudi Arabia; FIDIC-based contract; amounts in SAR).
Write as the approved PVOs read: plain, formal, in the Employer's voice, defined terms capitalised, sub-clauses cited as "Sub-Clause 12.1 [Employer's Right to Vary]". Do not copy the documents' sentences; summarise and reword them.
Use only the facts in the documents and values given. Never invent references, dates, figures, names or clauses.`;

/**
 * The title, scope, reason and contractual basis of the change, drafted from the change documents
 * (the RFC / RFA / EVO / Employer's Instruction, its executive summary and letter) when the AI is on.
 * Kept with the pack under a hash of what it was drafted from; nothing visible when the switch is off.
 */
export async function draftChangeWording(values: PackValues, texts: string): Promise<{ title: string; scope: string; reason: string; contractual_basis: string } | null> {
  if (!aiEnabled() || !aiKeyPresent() || !texts.trim()) return null;
  const hash = crypto.createHash("sha1").update(texts).update(String(values.title ?? "")).digest("hex");
  if (values.__wording && values.__wording_hash === hash) {
    try {
      return JSON.parse(values.__wording) as { title: string; scope: string; reason: string; contractual_basis: string };
    } catch {
      /* drafted again below */
    }
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY, maxRetries: 2, timeout: 4 * 60 * 1000 });
    const facts = ["title", "scope", "reason", "contractual_basis", "contractor", "contract_no", "contract_title", "project_name", "works_package", "rfc_ref", "instruction_ref", "ei_no", "total_value", "cost_scope", "cost_subject"]
      .filter((k) => String(values[k] ?? "").trim())
      .map((k) => `${k}: ${String(values[k]).slice(0, 3000)}`)
      .join("\n");
    const response = await client.messages.parse({
      model: PACK_MODEL,
      max_tokens: 3000,
      output_config: { effort: "medium", format: zodOutputFormat(WordingSchema) },
      system: WORDING_SYSTEM,
      messages: [{ role: "user", content: `Word the change for the PVO form.\n\nVALUES READ SO FAR:\n${facts}\n\nCHANGE DOCUMENTS:\n${texts}` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    const out = response.parsed_output;
    values.__wording = JSON.stringify(out);
    values.__wording_hash = hash;
    return out;
  } catch (e) {
    console.error("the change could not be worded – the documents' own wording is used:", e);
    return null;
  }
}
