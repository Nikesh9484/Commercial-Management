/**
 * Tidies the wording that comes in from a spreadsheet. Trackers are typed by many hands over months:
 * the same claim arrives as "NOTICE OF DISATISFACTION", "notice of disatisfaction -engineers
 * instruction no.5" and "Notice of Dissatisfaction – Engineer's Instruction No. 5". None of that is
 * worth correcting by hand in the workbook, and it should not be what the commercial team reads.
 *
 * Only presentation is changed – spelling, spacing, capitals and the punctuation between words. No
 * word is added, removed or reordered, so a reference, a number or a name is never altered beyond
 * its capitals, and the claim still reads as the claim the workbook holds.
 */

/** Words that are always written this way: they are references or initialisms, not prose. */
const ACRONYMS = [
  "EOT", "DVO", "PVO", "VO", "EI", "TIA", "EAR", "HLEAR", "RFA", "IPC", "NOD", "NOC", "LOI", "NTP",
  "SAR", "RSG", "AMAALA", "BOQ", "QS", "LLC", "LLP", "JV", "PO", "RFI", "NCR", "MEP", "HSE", "TB",
  "FIDIC", "CPM", "WBS", "GRP", "HDPE", "PVC", "RC", "IFC", "AFC", "TQ", "SI", "DAB", "KPI", "VAT",
];
const ACRONYM_SET = new Set(ACRONYMS);

/**
 * Misspellings seen in the real trackers, and the shapes that keep coming back. Kept as whole words
 * so "disatisfaction" is corrected but a reference like "DIS-01" is left exactly as it is.
 */
const SPELLINGS: [RegExp, string][] = [
  [/\bdis+at+isfaction\b/gi, "Dissatisfaction"],
  [/\bdissatisfation\b/gi, "Dissatisfaction"],
  [/\bstruc?uture\b/gi, "Structure"],
  [/\bstructre\b/gi, "Structure"],
  [/\bstrucutre\b/gi, "Structure"],
  [/\brecieved\b/gi, "received"],
  [/\brecieve\b/gi, "receive"],
  [/\boccured\b/gi, "occurred"],
  [/\boccuring\b/gi, "occurring"],
  [/\bseperate\b/gi, "separate"],
  [/\bseperation\b/gi, "separation"],
  [/\bdeterminaton\b/gi, "Determination"],
  [/\bdetermiation\b/gi, "Determination"],
  [/\bextention\b/gi, "Extension"],
  [/\bprolongaton\b/gi, "Prolongation"],
  [/\bprolongration\b/gi, "Prolongation"],
  [/\bacceleartion\b/gi, "Acceleration"],
  [/\bdisrution\b/gi, "Disruption"],
  [/\bcontracter\b/gi, "Contractor"],
  [/\bengineeer\b/gi, "Engineer"],
  [/\binstuction\b/gi, "Instruction"],
  [/\binstrcution\b/gi, "Instruction"],
  [/\bsubmital\b/gi, "submittal"],
  [/\bsubmisson\b/gi, "submission"],
  [/\bresubmision\b/gi, "resubmission"],
  [/\bremeasurment\b/gi, "remeasurement"],
  [/\bremeasued\b/gi, "remeasured"],
  [/\bvariaton\b/gi, "Variation"],
  [/\bcompensible\b/gi, "compensable"],
  [/\bcompensatable\b/gi, "compensable"],
  [/\bmileston\b/gi, "milestone"],
  [/\bprecas\b/gi, "Precast"],
  [/\bjetti?es\b/gi, "jetties"],
  [/\bjetty?s\b/gi, "jetties"],
  // a possessive typed without its apostrophe – "the Engineers Instruction" is one engineer's
  [/\bengineers\s+(instruction|determination|recommendation|assessment|response|decision|letter|opinion)\b/gi, "Engineer's $1"],
  [/\bcontractors\s+(claim|submission|notice|letter|request|entitlement|proposal)\b/gi, "Contractor's $1"],
  [/\bemployers\s+(assessment|determination|instruction|response|decision|letter)\b/gi, "Employer's $1"],
  // company names that arrive run together
  [/\bals+a+ad\b/gi, "Al Saad"],
  [/\bal-saad\b/gi, "Al Saad"],
  [/\belmar\s*marinas?\b/gi, "Elmar Marinas"],
];

/** Words that stay lower case inside a title, unless they start it. */
const MINOR = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with", "vs", "per", "via"]);

const isAcronym = (w: string) => ACRONYM_SET.has(w.replace(/[^A-Za-z]/g, "").toUpperCase()) && w.replace(/[^A-Za-z]/g, "").length > 1;

/** Sentence case for a word that arrived in block capitals, leaving real acronyms alone. */
function fixCase(word: string, first: boolean): string {
  const letters = word.replace(/[^A-Za-z]/g, "");
  if (!letters) return word;
  if (isAcronym(word)) return word.replace(/[A-Za-z]+/g, (m) => m.toUpperCase());
  // a word with its own internal capitals (McGregor, AlSaad) is left as typed
  if (/[a-z]/.test(word) && /[A-Z]/.test(word.slice(1))) return word;
  const lower = word.toLowerCase();
  if (!first && MINOR.has(lower.replace(/[^a-z]/g, ""))) return lower;
  return lower.replace(/[a-z]/, (m) => m.toUpperCase());
}

/**
 * The tidy itself. Safe to run twice – running it on an already-tidy string returns the same string.
 */
export function tidyText(raw: unknown): string {
  let s = String(raw ?? "");
  if (!s.trim()) return "";

  // whitespace, including the non-breaking spaces and line breaks that come out of spreadsheet cells
  s = s.replace(/[   ]/g, " ").replace(/\s*[\r\n]+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  // matched pairs of stray quotes left by a copy and paste
  s = s.replace(/^["']+|["']+$/g, "").trim();
  // a trailing separator left where a note was deleted
  s = s.replace(/[\s\-–—,;:.]+$/g, (m) => (m.includes(".") && !m.includes("-") && !m.includes("–") ? "." : "")).trim();

  // a description shouted in block capitals is put back into ordinary case; mixed case is left alone
  const letters = s.replace(/[^A-Za-z]/g, "");
  const shouting = letters.length > 3 && letters === letters.toUpperCase();
  if (shouting) {
    let first = true;
    s = s.replace(/[A-Za-z][A-Za-z'’]*/g, (w) => {
      const out = fixCase(w, first);
      first = false;
      return out;
    });
  } else {
    // even in ordinary case, a real acronym keeps its capitals
    s = s.replace(/[A-Za-z]{2,}/g, (w) => (isAcronym(w) ? w.toUpperCase() : w));
  }

  for (const [re, to] of SPELLINGS) {
    // A replacement carrying a capture ($1) has to go straight through, or the group is never
    // filled in. Case has already been settled above, so the replacement text is used as written.
    s = s.replace(re, to);
  }

  // punctuation: no space before, one space after; a lone hyphen between words becomes a dash
  s = s.replace(/\s+([,;:.!?])/g, "$1");
  s = s.replace(/([,;:])(?=[^\s\d])/g, "$1 ");
  s = s.replace(/\s+-\s+/g, " – ");
  s = s.replace(/([a-z])-\s+/gi, "$1 – ");
  // " -word" – a dash typed without the space after it. "EOT-01" is untouched: no space before it.
  s = s.replace(/\s+-(?=[A-Za-z])/g, " – ");
  s = s.replace(/\s*–\s*/g, " – ");
  // "no.5" / "NO . 5" / "no 5" after a word → "No. 5"
  s = s.replace(/\bno\s*\.?\s*(?=\d)/gi, "No. ");
  s = s.replace(/\s{2,}/g, " ").trim();
  // brackets: no space just inside them
  s = s.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\[\s+/g, "[").replace(/\s+\]/g, "]");
  // start with a capital
  s = s.replace(/^[a-z]/, (m) => m.toUpperCase());
  return s;
}

/** True when tidying would change the text – used to report how many rows a clean-up touched. */
export function needsTidy(raw: unknown): boolean {
  const s = String(raw ?? "");
  return s.trim() !== "" && tidyText(s) !== s;
}
