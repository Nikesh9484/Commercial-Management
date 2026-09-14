/**
 * One palette for every report the builder produces – the PDF, the Excel, the Word summary and the
 * preview on screen – so a report looks like itself whichever way it is opened.
 *
 * It is deliberately muted. The colours printed by the financial press sit at roughly a third to a
 * half of full saturation; a fully saturated colour is what makes a page look cheap, and the usual
 * accessible chart palettes are all fully saturated. These sit in the same range as those used by
 * the Financial Times and The Economist for everything except an alert.
 *
 * Colour is never the only thing carrying a meaning here. Status is written out in words and given
 * its own shape as well as its own colour, because muted colours are the first thing to disappear
 * in a photocopy and red against green is the pair colour-blind readers cannot separate. Anything
 * that has to survive being photocopied – the bars, the series – is separated by how light or dark
 * it is rather than by hue.
 */

export const PALETTE = {
  /** Deep brand tones – headings, table headers, rules. */
  ink: "#1f2a33",
  brand: "#0f2b4c",
  brandDeep: "#0b2137",
  brandMid: "#2f4f73",
  brandSoft: "#7d95ad",
  muted: "#5b6b7a",
  faint: "#8b98a8",

  /** Page furniture. */
  line: "#d7dee5",
  lineStrong: "#b9c2cd",
  zebra: "#f4f7f9",
  panel: "#e8edf2",
  paper: "#ffffff",

  /**
   * Status, at about half saturation. Each clears AA against white as text (8.1, 5.6 and 4.8 to 1),
   * and each is paired in the reports with both a word and a shape, because no three colours can be
   * dark enough to read as text and still tell apart in greyscale.
   */
  bad: "#87362d",
  badFill: "#a8564a",
  badTint: "#f3e6e3",
  warn: "#8a5f1c",
  warnFill: "#c28b38",
  warnTint: "#f6eedd",
  good: "#3c7e66",
  goodFill: "#5a9b83",
  goodTint: "#e6efea",
  info: "#4a6d8c",
  neutralTint: "#eef2f6",

  /**
   * Bars and breakdowns step through one family by lightness rather than changing hue: the steps stay
   * apart in a greyscale photocopy, and every bar carries its own figure so the shade never has to be
   * read as a code.
   */
  series: ["#0f2b4c", "#2f4f73", "#4d6d8f", "#7d95ad", "#a9bac9"],

  /** Tinted callouts – the warm one is the note the eye is meant to stop on. */
  headlineTint: "#e8edf2",
  calloutWarm: "#f5f1ea",
  calloutRule: "#d9cfc0",
  basisTint: "#f7f8f9",
} as const;

export type ToneName = "red" | "amber" | "green" | "grey";

/** Text colour for a cell tone. */
export const TONE_TEXT: Record<ToneName, string> = {
  red: PALETTE.bad,
  amber: PALETTE.warn,
  green: PALETTE.good,
  grey: PALETTE.muted,
};

/** Background wash for a toned cell – pale enough to keep black text readable over it. */
export const TONE_TINT: Record<ToneName, string> = {
  red: PALETTE.badTint,
  amber: PALETTE.warnTint,
  green: PALETTE.goodTint,
  grey: PALETTE.neutralTint,
};

/**
 * The shape drawn beside a status, so the status still reads when the colour has gone: a triangle
 * for something adverse, a square for something to watch, a circle for something in order.
 */
export const TONE_SHAPE: Record<ToneName, "triangle" | "square" | "circle"> = {
  red: "triangle",
  amber: "square",
  green: "circle",
  grey: "circle",
};

/** The same markers as characters, for Word and Excel where the font has them. */
export const TONE_GLYPH: Record<ToneName, string> = { red: "▲", amber: "■", green: "●", grey: "·" };

/** "#0f2b4c" -> "FF0F2B4C", the form ExcelJS wants. */
export function argb(hex: string): string {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

/** "#0f2b4c" -> "0F2B4C", the form docx wants. */
export function bare(hex: string): string {
  return hex.replace("#", "").toUpperCase();
}

/** A series shade by index, wrapping round. */
export function seriesColor(i: number): string {
  return PALETTE.series[i % PALETTE.series.length];
}
