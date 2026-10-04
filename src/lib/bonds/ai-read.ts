import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LIBRARY_MODEL, readerConfigured } from "../library/read";

/**
 * A second reading of a bond or insurance document by the reading engine (Claude), used to confirm or
 * correct what the dashboard's own rules read: the type of cover, the policy or guarantee number, the
 * insurer or bank, the period, the limit, and whether the document is an endorsement or amendment to a
 * policy already held rather than a new one. Only values that can be found in the text are taken over –
 * the engine never adds a number or a date the document does not carry. Off when no key is set or the
 * AI pill in the top bar is off; the rules alone then decide, as before.
 */
export const BondReading = z.object({
  document_kind: z.enum(["insurance policy or certificate", "endorsement or extension of an existing policy", "bank guarantee or bond", "amendment or extension of a bank guarantee", "transmittal or cover letter", "other"]),
  type_of_cover: z.string().describe("The class of cover the document is for, in a few words – e.g. Public/Third Party Liability, Workmen's Compensation, Contractors All Risks, Professional Indemnity, Performance Bond, Advance Payment Bond, Retention Bond, Plant & Equipment, Motor Vehicle, Marine Hull. Never a cover that the document only excludes."),
  policy_or_guarantee_no: z.string().describe("The policy, certificate or guarantee number exactly as printed, prefixes included (e.g. P-C01-25-50010-392776); '' when none."),
  insurer_or_bank: z.string().describe("The insurer or bank that issued it; '' when not stated."),
  insured_or_applicant: z.string().describe("The insured party or the applicant/contractor the guarantee is for; '' when not stated."),
  inception_date: z.string().describe("The original start of the policy or bond, YYYY-MM-DD; '' when not stated."),
  expiry_date: z.string().describe("The date the cover or bond now runs to – after any endorsement or extension in the document, YYYY-MM-DD; '' when not stated."),
  amount: z.number().nullable().describe("The limit of liability / sum insured / guarantee amount in SAR, as a plain number; null when not stated."),
  is_amendment: z.boolean().describe("True when the document changes a policy or guarantee already in force (an endorsement, an extension, an amendment letter) rather than being the original."),
});
export type BondReadingT = z.infer<typeof BondReading>;

const SYSTEM = `You read insurance certificates, policy schedules, endorsements, bank guarantees and their amendments for a construction Commercial Manager (AMAALA / Triple Bay, Saudi Arabia; amounts in SAR).
Report only what the document states; never invent a number, a date or a figure. An exclusion ("excluding workmen's compensation") names what is NOT covered – the type of cover is what the policy insures.
When a document holds several endorsements of one policy, the expiry is the latest date the cover runs to. Dates as YYYY-MM-DD.`;

export async function readBondWithAi(fileName: string, text: string): Promise<BondReadingT | null> {
  if (!readerConfigured() || !text.trim()) return null;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY, maxRetries: 1, timeout: 90 * 1000 });
  const body = text.length > 40_000 ? `${text.slice(0, 32_000)}\n\n[… ${text.length - 40_000} characters omitted …]\n\n${text.slice(-8_000)}` : text;
  const response = await client.messages.parse({
    model: process.env.BONDS_MODEL || LIBRARY_MODEL,
    max_tokens: 1500,
    output_config: { effort: "low", format: zodOutputFormat(BondReading) },
    system: SYSTEM,
    messages: [{ role: "user", content: `File name: ${fileName}\n\nDOCUMENT TEXT:\n${body}` }],
  });
  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
}
