import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "../db";
import { logAudit } from "../audit";
import { ValidationError } from "../registers/engine";
import type { UserInfo } from "../registers/types";
import { buildPack, documentTexts } from "./pack";
import { aiEnabled, aiKeyPresent, aiOffReason } from "../ai-switch";

/**
 * ASK ME – the dashboard's assistant. The whole project (every register, the cost report, the
 * movement, the report library, the EOT and contract libraries) is handed to Claude with the
 * question; the answer ends with a professional summary the user can copy into an email or report.
 */
export const ASK_MODEL = process.env.ASK_MODEL || "claude-opus-5";

export function askConfigured(): boolean {
  // the switch on the Settings page turns every paid call off without removing the key
  return aiEnabled() && aiKeyPresent();
}

const SYSTEM = `You are ASK ME, the assistant built into the Commercial Dashboard of a construction Commercial Manager (AMAALA, Triple Bay – The Marina and Village Boutique Hotel projects, Saudi Arabia; all amounts in SAR).
You are given the complete data of the project and reporting period selected in the top bar: the cost report (Level 1 and Level 2), the movement since the previous report, every register (changes, claims, early warnings, risks, provisional sums, bonds & insurance, contracts, payment applications, final accounts, budget transfers, meetings and actions, project setup), the report library, and the EOT and contract document libraries.

How to answer:
- Search all of the data before answering. Quote the actual figures, references, dates, names and statuses from the data; never invent anything. If the data does not contain the answer, say exactly what is missing and where it would normally be recorded.
- Be precise about which reporting period and project the figures belong to.
- Show your working where numbers are combined (e.g. list the items that make up a total).
- Write in clear professional English for a commercial / contracts audience. Use short headings and bullet points where they help; tables for lists of figures.
- ALWAYS finish with a section headed exactly "Summary for copy-paste" containing a self-contained professional summary (one to three short paragraphs, or a short bulleted note when the question is a list) that the user can paste into an email, a report or minutes without editing. It must repeat the key figures and references, name the project and reporting period, and carry no references to "the data" or "the dashboard".`;

export interface AskTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AskResult {
  answer: string;
  summary: string;
  usage: string;
  project: string;
  period: string;
}

export async function ask(question: string, history: AskTurn[], user: UserInfo): Promise<AskResult> {
  const q = question.trim();
  if (!q) throw new ValidationError("Type a question first.");
  if (!askConfigured()) throw new ValidationError(`ASK ME is not available: ${aiOffReason() ?? "the reading engine is not configured"}.`);
  const pack = buildPack();
  const docs = documentTexts(q);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY, maxRetries: 2, timeout: 10 * 60 * 1000 });

  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of history.slice(-8)) messages.push({ role: t.role, content: t.text.slice(0, 20_000) });
  messages.push({ role: "user", content: `${docs ? `RELEVANT DOCUMENT TEXTS FROM THE LIBRARIES:\n${docs}\n\n` : ""}QUESTION from ${user.name} (${user.role}): ${q}` });

  const stream = client.beta.messages.stream({
    model: ASK_MODEL,
    max_tokens: 16_000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: [
      { type: "text", text: SYSTEM },
      // the data pack is the same for every question until the data changes: cached for follow-ups
      { type: "text", text: `# DASHBOARD DATA – ${pack.project} – ${pack.period}\n\n${pack.text}`, cache_control: { type: "ephemeral" } },
    ],
    messages,
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new ValidationError("The assistant declined to answer this question. Please rephrase it.");
  const answer = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
  const m = /summary for copy-paste[:\s]*\n([\s\S]*)$/i.exec(answer);
  const summary = (m ? m[1] : "").replace(/^[-=*#\s]+/, "").trim();
  const usage = `${(msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0)).toLocaleString()} tokens read (${(msg.usage.cache_read_input_tokens ?? 0).toLocaleString()} from cache), ${msg.usage.output_tokens.toLocaleString()} written`;
  logAudit(getDb(), { registerKey: "ask", recordId: null, action: "context", user, summary: `ASK ME: ${q.slice(0, 200)}` });
  return { answer, summary, usage, project: pack.project, period: pack.period };
}
