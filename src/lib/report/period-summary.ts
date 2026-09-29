import type { ReportData } from "./data";
import type { KeyMovement, KeyMoveItem } from "../dashboard/movement";
import { executiveTotals } from "../cost-report/executive";
import { formatDate } from "../format";
import { plural } from "./report-utils";

/**
 * The Period Summary: the month's story in the shape the directors get it by email –
 * projected cost to complete (previous → updated → net movement), budget position, the forecast
 * movement analysis (what moved the forecast, column by column), the change-management status
 * counts, and the items behind each movement with a written narrative. One model feeds the PDF,
 * the Excel sheet, the email draft and the on-screen page, for whichever project is in the top bar.
 */
export interface MoveRow {
  key: string;
  label: string;
  /** a short label for charts */
  short: string;
  value: number;
  note?: string;
}

export interface StatusRow {
  stage: string;
  label: string;
  prev: number;
  delta: number;
  now: number;
}

export type ItemKind = "new" | "in" | "out" | "revised" | "removed";

export interface CategoryItem extends KeyMoveItem {
  kind: ItemKind;
}

export interface CategoryGroup {
  kind: ItemKind;
  heading: string;
  items: CategoryItem[];
  total: number;
}

export interface CategorySection {
  col: KeyMovement["col"];
  short: string;
  label: string;
  /** movement of the cost-report column since the previous report */
  total: number;
  /** the column's balance in this report */
  balance: number;
  narrative: string;
  groups: CategoryGroup[];
  count: number;
}

export interface PeriodSummary {
  title: string;
  subject: string;
  programme: { code: string; name: string };
  assetName: string;
  period: { label: string; reportNo: number; cutOff: string; short: string };
  previous: { label: string; short: string } | null;
  locked: boolean;
  generatedAt: string;
  hasComparison: boolean;
  warning: string | null;
  projected: { prev: number | null; now: number; delta: number | null; deltaPct: number | null; narrative: string };
  budget: {
    forecast: number;
    approved: number;
    variance: number;
    variancePct: number;
    verdict: "OVER BUDGET" | "UNDER BUDGET" | "ON BUDGET";
    note: string;
    holdNow: number;
    holdPrev: number | null;
    holdInAfa: boolean;
  };
  movement: { rows: MoveRow[]; net: number | null };
  status: StatusRow[];
  categories: CategorySection[];
  balances: { label: string; value: number }[];
  sender: { name: string; role: string };
}

/* ---------- formatting shared by every output of this report ---------- */
const whole = (n: number) => Math.round(Math.abs(n)).toLocaleString("en-US");
/** "SAR 1,234,567" or "(SAR 1,234,567)" for a negative, as accountants write it. */
export const sar = (n: number): string => (n < -0.5 ? `(SAR ${whole(n)})` : `SAR ${whole(n)}`);
/** Movements: "+SAR 4,621,608" / "(SAR 29,877)" / "SAR 0". */
export const sarMove = (n: number | null): string => (n === null ? "–" : n > 0.5 ? `+SAR ${whole(n)}` : n < -0.5 ? `(SAR ${whole(n)})` : "SAR 0");
/** Short money for prose: "SAR 5.9M", "SAR 730k". */
export const sarShort = (n: number): string => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e4 ? `${Math.round(a / 1e3)}k` : whole(n);
  return n < -0.5 ? `(SAR ${s})` : `SAR ${s}`;
};
/** In prose: "+SAR 640,000" / "−SAR 397,551", never nested brackets. */
const prose = (n: number) => (n < -0.5 ? `−SAR ${whole(n)}` : n > 0.5 ? `+SAR ${whole(n)}` : "SAR 0");
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const tag = (it: KeyMoveItem) => (it.party ? ` [${it.party.toUpperCase()}]` : "");
/** "Monthly Report No 51 – Sep'26" → "Sep'26" (the report number is said separately). */
const shortLabel = (label: string) => (label.includes("–") ? label.split("–").pop()!.trim() : label.replace(/^Monthly Report /i, "Report "));

const SHORT: Record<KeyMovement["col"], string> = { H: "DVO", J: "PVO", K: "RFC", L: "Early Warning", M: "Claim" };
const LONG: Record<KeyMovement["col"], string> = { H: "Determined Variations (DVO)", J: "Potential Variations (PVO / VO)", K: "Requests for Change (RFC)", L: "Early Warnings", M: "Claims" };
const NEXT: Record<KeyMovement["col"], string> = { H: "the final account", J: "DVO approval", K: "PVO", L: "RFC or PVO", M: "determination" };

function classify(it: KeyMoveItem): ItemKind {
  const n = it.note.toLowerCase();
  if (n.startsWith("new")) return "new";
  if (n.startsWith("from ")) return "in";
  if (n.startsWith("moved to")) return "out";
  if (n.startsWith("removed")) return "removed";
  return "revised";
}

function groupHeading(col: KeyMovement["col"], kind: ItemKind): string {
  const s = SHORT[col];
  switch (kind) {
    case "new":
      return `New ${s} additions`;
    case "in":
      return `Moved in from an earlier stage`;
    case "out":
      return `Items cascaded to ${NEXT[col]}`;
    case "removed":
      return `Closed or removed from the register`;
    default:
      return `Revised values`;
  }
}

/** One sentence naming the biggest movers of a category, in the tone of the directors' email. */
function categoryNarrative(col: KeyMovement["col"], total: number, items: CategoryItem[], balance: number): string {
  const s = SHORT[col];
  const up = items.filter((i) => i.delta > 0).sort((a, b) => b.delta - a.delta);
  const down = items.filter((i) => i.delta < 0).sort((a, b) => a.delta - b.delta);
  const name = (i: CategoryItem) => `${i.title.trim() || i.key}${tag(i)} (${prose(i.delta)})`;
  const few = (xs: CategoryItem[], n: number) => {
    const shown = xs.slice(0, n).map(name);
    const rest = xs.length - shown.length;
    return shown.join(", ") + (rest > 0 ? ` and ${plural(rest, "other item")}` : "");
  };
  if (!items.length) {
    if (Math.abs(total) < 0.5) return `No movement in ${LONG[col]} this period.`;
    return `${LONG[col]} moved by ${sarMove(total)} through cost-line re-linking or budget adjustments rather than individual register items.`;
  }
  const parts: string[] = [];
  if (total > 0.5) {
    parts.push(`The ${s} increase of ${sar(total)} is driven by ${few(up, 3)}`);
    if (down.length) parts.push(`partly offset by ${few(down, 2)}`);
  } else if (total < -0.5) {
    parts.push(`The ${s} reduction of ${sar(Math.abs(total))} comes from ${few(down, 3)}`);
    if (up.length) parts.push(`partly offset by ${few(up, 2)}`);
  } else {
    parts.push(`${LONG[col]} are unchanged in total: ${few(up, 2)}${up.length && down.length ? " against " : ""}${few(down, 2)}`);
  }
  let text = parts.join(", ") + ".";
  if (col === "L" || col === "M") text += ` The current ${col === "L" ? "Early Warning" : "claims"} balance in the cost report stands at ${sar(balance)}.`;
  return text;
}

/** The sender's job title from the project team list (Data Input), when their name is on it. */
function teamRole(data: ReportData, name: string): string | null {
  const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const me = norm(name);
  if (!me) return null;
  const hit = data.team.find((t) => norm(t.name) === me || (me.length > 5 && norm(t.name).includes(me)));
  const role = hit ? String(hit.role ?? "").replace(/:\s*$/, "").trim() : "";
  return role || null;
}

export function buildPeriodSummary(data: ReportData, sender: { name: string; role?: string }): PeriodSummary {
  const g = executiveTotals(data.costReport);
  const gp = data.previousCostReport ? executiveTotals(data.previousCostReport) : null;
  const m = data.movement;
  const previous = m?.previous ? { label: m.previous.label, short: shortLabel(m.previous.label) } : null;
  const hasComparison = !!previous && !!gp && !m?.warning;
  const assetName = data.asset ? data.asset.name : data.programme.name;
  const period = { label: data.period.label, reportNo: data.period.report_no, cutOff: formatDate(data.period.period_end), short: shortLabel(data.period.label) };
  const holdNow = r2(data.costReport.grandTotal.N - data.costReport.totalsExclHold.N);
  const holdPrev = data.previousCostReport ? r2(data.previousCostReport.grandTotal.N - data.previousCostReport.totalsExclHold.N) : null;
  const holdInAfa = data.costReport.holdInAfa;

  // ---------- projected cost to complete
  const delta = hasComparison ? r2(g.N - gp!.N) : null;
  const deltaPct = delta !== null && gp!.N ? r2((delta / gp!.N) * 100) : null;

  // ---------- forecast movement analysis: what moved the anticipated final account
  const rows: MoveRow[] = [];
  if (hasComparison) {
    const d = (k: keyof typeof g) => r2(g[k] - gp![k]);
    const awarded = r2(d("I") - d("H"));
    if (Math.abs(awarded) >= 0.5) rows.push({ key: "awarded", label: "Contracts awarded / commitments", short: "Contracts awarded", value: awarded, note: "new or revised contract awards" });
    rows.push({ key: "H", label: "Committed movement (DVO approvals)", short: "DVO approvals", value: d("H") });
    rows.push({ key: "J", label: "PVO movement", short: "PVOs", value: d("J") });
    rows.push({ key: "K", label: "RFC movement", short: "RFCs", value: d("K") });
    rows.push({ key: "L", label: "Early Warning movement", short: "Early Warnings", value: d("L") });
    if (Math.abs(d("M")) >= 0.5 || g.M || gp!.M) rows.push({ key: "M", label: "Claims movement", short: "Claims", value: d("M") });
    const explained = rows.reduce((t, r) => t + r.value, 0);
    const residual = r2(delta! - explained);
    if (holdInAfa) {
      // the hold is inside the forecast: what the columns took, the hold gave back (and vice versa)
      const holdMove = holdPrev === null ? residual : r2(holdNow - holdPrev);
      rows.push({ key: "hold", label: "Budget hold movement", short: "Budget hold", value: holdMove, note: "remaining budget hold carried in the forecast" });
      const rest = r2(residual - holdMove);
      if (Math.abs(rest) >= 0.5) rows.push({ key: "other", label: "Budget transfers / other adjustments", short: "Other", value: rest });
    } else if (Math.abs(residual) >= 0.5) rows.push({ key: "other", label: "Budget transfers / other adjustments", short: "Other", value: residual });
  }

  // ---------- budget position
  const variancePct = g.G ? r2((g.O / g.G) * 100) : 0;
  const verdict: PeriodSummary["budget"]["verdict"] = g.O > 0.5 ? "OVER BUDGET" : g.O < -0.5 ? "UNDER BUDGET" : "ON BUDGET";
  const cats = data.costReport.categories.map((c) => ({ label: c.label, over: r2(c.subtotal.O ?? 0), afa: c.subtotal.N }));
  const overs = cats.filter((c) => c.over > 0.5).sort((a, b) => b.over - a.over);
  const withins = cats.filter((c) => c.over <= 0.5 && c.afa);
  const noteParts: string[] = [];
  if (holdInAfa && Math.abs(g.O) < 0.5) {
    noteParts.push(`The forecast equals the approved budget because the remaining budget hold of ${sar(holdNow)} is carried inside the anticipated final account; committed and uncommitted costs excluding the hold stand at ${sar(data.costReport.totalsExclHold.N)}.`);
  } else if (overs.length) {
    noteParts.push(`The overrun sits in ${overs.map((c) => `${c.label} (${sar(c.over)})`).join(", ")}.`);
    if (withins.length > 3) noteParts.push(`The other ${withins.length} categories are forecast within budget.`);
    else if (withins.length) noteParts.push(`${withins.map((c) => c.label).join(", ")} ${withins.length === 1 ? "is" : "are"} forecast within budget.`);
  } else noteParts.push("Every cost category is forecast within its budget.");
  if (holdPrev !== null && Math.abs(holdNow - holdPrev) >= 0.5) noteParts.push(`The remaining budget hold has ${holdNow < holdPrev ? "reduced" : "increased"} from ${sar(holdPrev)} to ${sar(holdNow)}.`);
  else noteParts.push(`The remaining budget hold stands at ${sar(holdNow)}.`);

  // ---------- change management status counts
  const status: StatusRow[] = (m?.statusCounts ?? [])
    .filter((s) => ["RFC", "PVO", "VO", "DVO"].includes(s.stage))
    .map((s) => ({ stage: s.stage, label: `${s.stage}s`, prev: hasComparison ? s.pending.prev : s.pending.now, delta: hasComparison ? s.pending.now - s.pending.prev : 0, now: s.pending.now }));

  // ---------- items behind each movement
  const categories: CategorySection[] = [];
  for (const km of m?.keyMovements ?? []) {
    if (!hasComparison) break;
    const items: CategoryItem[] = km.items.map((it) => ({ ...it, kind: classify(it) }));
    if (!items.length && Math.abs(km.kpiDelta) < 0.5) continue;
    const order: ItemKind[] = ["new", "in", "revised", "out", "removed"];
    const groups: CategoryGroup[] = order
      .map((kind) => {
        const list = items.filter((i) => i.kind === kind).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        return { kind, heading: groupHeading(km.col, kind), items: list, total: r2(list.reduce((t, i) => t + i.delta, 0)) };
      })
      .filter((gr) => gr.items.length);
    const balance = g[km.col];
    categories.push({ col: km.col, short: SHORT[km.col], label: LONG[km.col], total: km.kpiDelta, balance, narrative: categoryNarrative(km.col, km.kpiDelta, items, balance), groups, count: items.length });
  }

  // ---------- the opening paragraph
  let narrative: string;
  if (!hasComparison) {
    narrative = m?.warning
      ? `${m.warning} The position below is this report's; the movement analysis needs an issued previous report to compare with.`
      : `This is the first issued report for ${assetName}, so there is no previous position to compare with. The anticipated final account stands at ${sar(g.N)} against an approved budget of ${sar(g.G)}.`;
  } else {
    const size = Math.abs(delta!) < Math.max(1, gp!.N * 0.0005) ? "effectively unchanged" : delta! > 0 ? "higher" : "lower";
    const dir = delta! > 0.5 ? "increase" : delta! < -0.5 ? "reduction" : "movement";
    const ups = rows.filter((r) => r.value > 0.5).sort((a, b) => b.value - a.value);
    const downs = rows.filter((r) => r.value < -0.5).sort((a, b) => a.value - b.value);
    const allItems = categories.flatMap((c) => c.groups.flatMap((gr) => gr.items.map((i) => ({ ...i, col: c.col }))));
    const top = allItems.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    const s: string[] = [];
    s.push(
      size === "effectively unchanged"
        ? `The forecast is effectively unchanged this period, with a net ${dir} of ${sar(Math.abs(delta!))}.`
        : `The forecast is ${size} this period: a net ${dir} of ${sar(Math.abs(delta!))} (${Math.abs(deltaPct!).toFixed(2)}%), from ${sar(gp!.N)} to ${sar(g.N)}.`,
    );
    if (top) {
      const where = top.kind === "out" ? `which has ${top.note.replace("moved to", "moved to")}` : top.kind === "in" ? `carried ${top.note.split(" · ")[0]}` : top.kind === "new" ? "a new item" : top.kind === "removed" ? "now removed from the register" : "revised in value";
      s.push(`The largest single movement is ${top.title.trim() || top.key}${tag(top)} in ${SHORT[top.col]}s (${prose(top.delta)}), ${where}.`);
    }
    if (ups.length && downs.length) {
      const upTxt = ups.map((r) => `${r.short} (${sarShort(r.value)})`).join(", ");
      const downTxt = downs.map((r) => `${r.short} (${sarShort(Math.abs(r.value))})`).join(", ");
      const absorbed = Math.abs(downs.reduce((t, r) => t + r.value, 0)) >= ups.reduce((t, r) => t + r.value, 0);
      s.push(`Increases in ${upTxt} have been ${absorbed ? "absorbed by" : "partly offset by"} reductions in ${downTxt}.`);
    } else if (ups.length) s.push(`The movement comes from ${ups.map((r) => `${r.short} (${sarShort(r.value)})`).join(", ")}.`);
    else if (downs.length) s.push(`The reduction comes from ${downs.map((r) => `${r.short} (${sarShort(Math.abs(r.value))})`).join(", ")}.`);
    narrative = s.join(" ");
  }

  const subject = `${data.programme.code} · ${assetName} – Commercial Report No. ${period.reportNo} (${period.short}) – Key Period Movements${data.locked ? "" : " (draft)"}`;
  return {
    title: `Period Summary – ${period.label}`,
    subject,
    programme: { code: data.programme.code, name: data.programme.name },
    assetName,
    period,
    previous,
    locked: data.locked,
    generatedAt: data.generatedAt,
    hasComparison,
    warning: m?.warning ?? null,
    projected: { prev: hasComparison ? gp!.N : null, now: g.N, delta, deltaPct, narrative },
    budget: { forecast: g.N, approved: g.G, variance: g.O, variancePct, verdict, note: noteParts.join(" "), holdNow, holdPrev, holdInAfa },
    movement: { rows, net: delta },
    status,
    categories,
    balances: [
      { label: "Determined Variations (DVO) in the cost report", value: g.H },
      { label: "Potential Variations (PVO / VO)", value: g.J },
      { label: "Requests for Change (RFC)", value: g.K },
      { label: "Early Warnings", value: g.L },
      { label: "Claims", value: g.M },
    ],
    sender: { name: sender.name, role: sender.role ?? teamRole(data, sender.name) ?? `Commercial Management – ${assetName}` },
  };
}
