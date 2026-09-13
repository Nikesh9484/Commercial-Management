import { findSheet, money, rows, txt, type Sheet } from "./marina";

/**
 * The figures printed on the monthly workbook's own Level 1 sheet ("Level 01" / "Level 1"):
 * development budget, anticipated final account, variance to budget, last month's anticipated final
 * account and the variance to last month – kept with the imported report so the dashboard can show,
 * for every period, whether it reads the same as the Excel.
 */
export interface Level1Check {
  budget: number | null;
  afa: number | null;
  variance: number | null;
  lastMonthAfa: number | null;
  varianceToLastMonth: number | null;
  /** true when the sheet lists "Remaining Budget Hold" under Commitments (the hold counts as a commitment) */
  holdInAfa: boolean;
  sheet: string;
}

export function readLevel1Check(sheets: Sheet[]): Level1Check | null {
  const sheet = sheets.find((s) => /^level\s*0?1$/i.test(s.name.trim())) ?? findSheet(sheets, "Level 01", "Level 1");
  if (!sheet) return null;
  const all = rows(sheet);
  // the "Total …" column of the header row
  let totalCol = 0;
  for (const [, v] of all) {
    const i = v.findIndex((x, idx) => idx > 1 && /^total\b/i.test(String(x ?? "").trim()));
    if (i > 0) {
      totalCol = i;
      break;
    }
  }
  if (!totalCol) return null;
  const out: Level1Check = { budget: null, afa: null, variance: null, lastMonthAfa: null, varianceToLastMonth: null, holdInAfa: false, sheet: sheet.name };
  for (const [, v] of all) {
    const label = txt(v, 1).toLowerCase().replace(/\s+/g, " ").trim();
    if (!label) continue;
    const val = money(v, totalCol);
    if (label.startsWith("development budget")) out.budget = val;
    else if (label.startsWith("last month anticipated")) out.lastMonthAfa = val;
    else if (label.startsWith("anticipated final account")) out.afa = val;
    else if (label.startsWith("variance to last month")) out.varianceToLastMonth = val;
    else if (label.startsWith("variance to budget")) out.variance = val;
    else if (label.startsWith("remaining budget hold")) out.holdInAfa = true;
  }
  return out.budget === null && out.afa === null ? null : out;
}
