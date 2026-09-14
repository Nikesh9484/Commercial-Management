import type { RecordRow } from "../registers/types";
import { formatDate } from "../format";
import type { ReportSpec, SourceField, SourceInfo } from "./types";
import type { Band, BuildContext, ResultColumn, ResultGroup } from "./build";
import { fmtMoney } from "./build";

/**
 * Writes the report up in plain commercial English: a one-sentence answer first, then the position,
 * where the weight sits, how it is ageing, and what to do about it. Nothing is typed by hand and
 * every figure comes from the same numbers the tables print, so the words can never drift from the
 * data. No API key is involved – this is the dashboard's own writing, available offline.
 */

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
/** "status" -> "statuses", "party" -> "parties", "box" -> "boxes". */
export function pluralise(word: string): string {
  const w = word.trim();
  if (/(s|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}
const plural = (n: number, one: string, many?: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : (many ?? pluralise(one))}`;
/** "a, b and c", trimmed to the first few. */
function list(items: string[], max = 4): string {
  const kept = items.slice(0, max);
  const rest = items.length - kept.length;
  const joined = kept.length <= 1 ? (kept[0] ?? "") : `${kept.slice(0, -1).join(", ")} and ${kept[kept.length - 1]}`;
  return rest > 0 ? `${joined} and ${rest} more` : joined;
}
const money = (v: unknown) => `SAR ${fmtMoney(v)}`;
/** "Payments due & ageing" -> "Payments due & ageing report"; leaves "… tracker" and "… register" alone. */
function sourceNoun(title: string): string {
  return /report|tracker|register|scorecard|log|bridge|list/i.test(title) ? title : `${title} report`;
}

export interface NarrativeInput {
  spec: ReportSpec;
  info: SourceInfo;
  fields: SourceField[];
  rows: RecordRow[];
  all: RecordRow[];
  columns: ResultColumn[];
  totals: Record<string, number>;
  groups: ResultGroup[] | null;
  groupLabel: string | null;
  breakdown: { label: string; bands: Band[] } | null;
  ageing: { label: string; bands: Band[] } | null;
  money: ResultColumn | null;
  ctx: BuildContext;
}

export interface Written {
  headline: string;
  narrative: { heading: string; text: string }[];
  attention: string[];
}

export function writeNarrative(input: NarrativeInput): Written {
  const { rows, all, info, ctx, money: moneyCol, breakdown, ageing, spec } = input;
  const asOf = formatDate(ctx.periodEnd);
  const scope = ctx.assetName ? `${ctx.assetName}` : `${ctx.programmeName}`;
  const total = moneyCol ? num(input.totals[moneyCol.key]) : 0;
  const filtered = spec.conditions.filter((c) => c.field).length > 0;

  const narrative: { heading: string; text: string }[] = [];
  const attention: string[] = [];

  /* ---------------------------------------------------------------- headline */
  let headline: string;
  if (!rows.length) {
    headline = filtered ? `Nothing on the ${sourceNoun(info.title)} meets this filter as at ${asOf}.` : `The ${sourceNoun(info.title)} is empty for ${scope} as at ${asOf}.`;
  } else {
    headline = specificHeadline(input, asOf, scope) ?? `${plural(rows.length, "record")} on the ${sourceNoun(info.title)}${moneyCol ? `, worth ${money(total)} in total` : ""}, as at ${asOf}.`;
  }

  /* ---------------------------------------------------------------- position */
  narrative.push({
    heading: "Position at cut-off",
    text: !rows.length
      ? `${headline} ${filtered ? "Widen the filter, or take the empty result as confirmation that there is nothing outstanding on this test." : ""}`.trim()
      : `As at ${asOf}, ${plural(rows.length, "record")} ${rows.length === 1 ? "is" : "are"} reported from the ${sourceNoun(info.title)} for ${scope}${filtered ? `, filtered to ${input.spec.conditions.length === 1 ? "one condition" : `${input.spec.conditions.length} conditions`} out of ${plural(all.length, "record")} on the register` : ` (the whole register of ${plural(all.length, "record")})`}.${moneyCol ? ` They carry ${money(total)} of ${moneyCol.label.toLowerCase()}${rows.length > 1 ? `, an average of ${money(total / rows.length)} each` : ""}.` : ""}`,
  });

  /* ---------------------------------------------------------------- where the weight sits */
  if (breakdown && breakdown.bands.length > 1) {
    const top = breakdown.bands[0];
    const topThree = breakdown.bands.slice(0, 3);
    const concentration = moneyCol && total ? Math.round((topThree.reduce((t, b) => t + b.value, 0) / total) * 100) : null;
    narrative.push({
      heading: `Where it sits, by ${breakdown.label.toLowerCase()}`,
      text: `${top.label} carries the most, with ${plural(top.n, "record")}${moneyCol ? ` worth ${money(top.value)} – ${top.share.toFixed(0)}% of the total` : ""}. ${
        concentration !== null && breakdown.bands.length > 3 ? `The three largest (${list(topThree.map((b) => b.label), 3)}) together account for ${concentration}% of the value. ` : ""
      }${breakdown.bands.length > 1 ? `The rest is spread across ${plural(breakdown.bands.length - 1, "other " + breakdown.label.toLowerCase())}.` : ""}`,
    });
  }

  /* ---------------------------------------------------------------- ageing */
  if (ageing && ageing.bands.length) {
    const since = info.ageMode === "since";
    const overdue = ageing.bands.filter((b) => b.label !== "Not yet due" && b.label !== "No date");
    const old = ageing.bands.filter((b) => b.label === "61–90 days" || b.label === "Over 90 days");
    const oldCount = old.reduce((t, b) => t + b.n, 0);
    const oldValue = old.reduce((t, b) => t + b.value, 0);
    narrative.push({
      heading: "Ageing",
      text: overdue.length
        ? `${plural(overdue.reduce((t, b) => t + b.n, 0), "item")} ${overdue.length === 1 && overdue[0].n === 1 ? "is" : "are"} ${since ? `carrying a ${ageing.label.toLowerCase()} in the past` : "already past the date they fall due"}${moneyCol ? `, carrying ${money(overdue.reduce((t, b) => t + b.value, 0))}` : ""}. ${
            oldCount ? `${oldCount === 1 ? "One of them has" : `${oldCount} of them have`} been outstanding for more than 60 days${moneyCol && oldValue ? ` and account for ${money(oldValue)}` : ""} – these are the ones to deal with first.` : "None has been outstanding for more than 60 days."
          } ${since ? `Bands count back from ${ageing.label.toLowerCase()}.` : "Ageing is counted from the date each item falls due, not from when it was raised."}`
        : `Nothing is past its date: every item is still within time.${since ? "" : " Ageing is counted from the date each item falls due."}`,
    });
  }

  /* ---------------------------------------------------------------- source-specific reading */
  const extra = specificSection(input, asOf);
  if (extra) narrative.push(extra);

  /* ---------------------------------------------------------------- what to do */
  attention.push(...specificAttention(input));
  if (rows.length && !attention.length && moneyCol) {
    const biggest = [...rows].sort((a, b) => num(b[moneyCol.key]) - num(a[moneyCol.key]))[0];
    const ref = firstText(biggest, input.columns);
    if (ref) attention.push(`The largest single item is ${ref} at ${money(biggest[moneyCol.key])} – worth checking it is correctly stated before the report is issued.`);
  }
  if (attention.length) {
    narrative.push({
      heading: "What this means",
      text: `${attention.length === 1 ? "One point needs" : `${attention.length} points need`} attention before this report is relied on. ${attention[0]}`,
    });
  }

  return { headline, narrative, attention };
}

/** The first text-ish column of a row – used to name an item in prose. */
function firstText(row: RecordRow, columns: ResultColumn[]): string {
  const c = columns.find((x) => !x.numeric && x.type !== "date" && row[x.key]);
  return c ? String(row[c.key]) : "";
}

/* ------------------------------------------------------------------ per-source writing */

function specificHeadline(input: NarrativeInput, asOf: string, scope: string): string | null {
  const { rows, money: moneyCol, spec } = input;
  const total = moneyCol ? num(input.totals[moneyCol.key]) : 0;
  switch (spec.source) {
    case "payments_due": {
      const overdue = rows.filter((r) => String(r.bucket) === "Overdue");
      const overdueValue = overdue.reduce((t, r) => t + num(r.total_due), 0);
      if (!overdue.length) return `${money(total)} is owed across ${plural(rows.length, "certified payment")} as at ${asOf}, none of it past the contractual date.`;
      // once the report is filtered down to the overdue items, the two totals are the same figure
      if (overdue.length === rows.length) return `${money(overdueValue)} is overdue across ${plural(overdue.length, "certified payment")} as at ${asOf}, the oldest by ${Math.max(...overdue.map((r) => -num(r.days)))} days.`;
      return `${money(overdueValue)} is already overdue across ${plural(overdue.length, "payment")}, out of ${money(total)} owed in total as at ${asOf}.`;
    }
    case "eot_tracker": {
      const open = rows.filter((r) => String(r.state) === "Open");
      const stuck = open.filter((r) => String(r.flag) === "Stuck");
      if (!open.length) return `No claim is open on ${scope} as at ${asOf}.`;
      return `${plural(open.length, "claim")} ${open.length === 1 ? "is" : "are"} open as at ${asOf}${stuck.length ? `, and ${stuck.length} of them ${stuck.length === 1 ? "has" : "have"} had no action for over a month` : ", all of them with action inside the last month"}.`;
    }
    case "attention": {
      const critical = rows.filter((r) => String(r.severity) === "Critical");
      if (!rows.length) return `Nothing across the project is late, expiring or stuck as at ${asOf}.`;
      return `${plural(rows.length, "item")} across the project ${rows.length === 1 ? "needs" : "need"} attention as at ${asOf}${critical.length ? `, ${critical.length} of them critical` : ""}${total ? `, with ${money(total)} at stake` : ""}.`;
    }
    case "scorecard": {
      const watch = rows.filter((r) => String(r.health) === "Watch");
      return `${plural(rows.length, "contract")} ${rows.length === 1 ? "is" : "are"} reported as at ${asOf}${watch.length ? `, ${watch.length} of which need watching for late payments, lapsed cover or over-certification` : ", none of which is showing a payment, cover or certification problem"}.`;
    }
    case "value_bridge": {
      const original = rows.reduce((t, r) => t + num(r.original_value), 0);
      const revised = rows.reduce((t, r) => t + num(r.revised_value), 0);
      const movement = revised - original;
      const pct = original ? (movement / original) * 100 : 0;
      return `${plural(rows.length, "contract")} let for ${money(original)} now stand at ${money(revised)}, a ${movement >= 0 ? "net increase" : "net reduction"} of ${money(Math.abs(movement))} (${Math.abs(pct).toFixed(1)}%), as at ${asOf}.`;
    }
    default:
      return null;
  }
}

function specificSection(input: NarrativeInput, asOf: string): { heading: string; text: string } | null {
  const { rows, spec } = input;
  if (!rows.length) return null;
  switch (spec.source) {
    case "payments_due": {
      const by = (b: string) => rows.filter((r) => String(r.bucket) === b);
      const v = (set: RecordRow[]) => set.reduce((t, r) => t + num(r.total_due), 0);
      const overdue = by("Overdue");
      const d14 = by("Due within 14 days");
      const d30 = by("Due within 30 days");
      const noInv = by("Certified – invoice not yet raised");
      const worst = [...overdue].sort((a, b) => num(a.days) - num(b.days))[0];
      return {
        heading: "What has to be paid, and when",
        text: `${overdue.length ? `${plural(overdue.length, "payment")} worth ${money(v(overdue))} ${overdue.length === 1 ? "is" : "are"} past the contractual date${worst ? `, the oldest being ${String(worst.contractor)} ${String(worst.application_no)} at ${-num(worst.days)} days` : ""}. ` : "Nothing is past the contractual date. "}${d14.length ? `${plural(d14.length, "payment")} worth ${money(v(d14))} fall${d14.length === 1 ? "s" : ""} due within a fortnight and should be put in the next run. ` : ""}${d30.length ? `A further ${plural(d30.length, "payment")} worth ${money(v(d30))} fall${d30.length === 1 ? "s" : ""} due within the month. ` : ""}${
          noInv.length ? `${plural(noInv.length, "certified amount")} worth ${money(v(noInv))} ${noInv.length === 1 ? "has" : "have"} no invoice against ${noInv.length === 1 ? "it" : "them"} yet: the certification is done and the contractor has to be chased for the invoice before anything can be paid.` : ""
        }`.trim(),
      };
    }
    case "eot_tracker": {
      const open = rows.filter((r) => String(r.state) === "Open");
      if (!open.length) return null;
      const m = new Map<string, number>();
      for (const r of open) m.set(String(r.pending_with), (m.get(String(r.pending_with)) ?? 0) + 1);
      const where = [...m.entries()].sort((a, b) => b[1] - a[1]);
      const ours = open.filter((r) => !/contractor/i.test(String(r.pending_with)));
      const pastTarget = open.filter((r) => r.days_to_target !== null && num(r.days_to_target) < 0);
      return {
        heading: "Where the action sits",
        text: `Of ${plural(open.length, "open claim")}, ${where.map(([k, n]) => `${n} ${n === 1 ? "sits" : "sit"} with ${k}`).slice(0, 5).join(", ")}. ${ours.length ? `${plural(ours.length, "claim")} ${ours.length === 1 ? "is" : "are"} with us rather than the contractor – that is the part of the list we control.` : "Every open claim is with the contractor."} ${pastTarget.length ? `${plural(pastTarget.length, "claim")} ${pastTarget.length === 1 ? "has" : "have"} passed the target date set for the next step.` : "No claim has passed its target date."}`,
      };
    }
    case "value_bridge": {
      const up = rows.filter((r) => num(r.movement) > 0.5);
      const down = rows.filter((r) => num(r.movement) < -0.5);
      const vos = rows.reduce((t, r) => t + num(r.approved_vos), 0);
      const claims = rows.reduce((t, r) => t + num(r.approved_claims), 0);
      const fa = rows.reduce((t, r) => t + num(r.fa_adjustment), 0);
      const biggest = [...rows].sort((a, b) => Math.abs(num(b.movement)) - Math.abs(num(a.movement)))[0];
      return {
        heading: "What moved the price",
        text: `Approved variations account for ${money(vos)}, approved claims for ${money(claims)} and final account or Stage 2 adjustments for ${money(fa)}. ${plural(up.length, "contract")} ${up.length === 1 ? "has" : "have"} gone up and ${plural(down.length, "contract")} ${down.length === 1 ? "has" : "have"} come down. ${biggest ? `The largest single movement is ${String(biggest.contract_ref)} (${String(biggest.contractor)}) at ${money(num(biggest.movement))}, ${Math.abs(num(biggest.movement_pct)).toFixed(1)}% of its original price.` : ""} A finer split of the movement – quantity, rate, design development, scope gap and instructed scope – comes from a bill-by-bill reading of the Stage 2 BOQ and is not derived here.`,
      };
    }
    case "scorecard": {
      const late = rows.filter((r) => num(r.overdue_count) > 0);
      const cover = rows.filter((r) => /expired/i.test(String(r.bond_status)));
      const over = rows.filter((r) => r.pct_certified !== null && num(r.pct_certified) > 100.5);
      return {
        heading: "How the contracts are running",
        text: `${late.length ? `${plural(late.length, "contract")} ${late.length === 1 ? "has" : "have"} a payment past its contractual date. ` : "No contract has a payment past its date. "}${cover.length ? `${plural(cover.length, "contract")} ${cover.length === 1 ? "is" : "are"} carrying an expired bond or policy. ` : ""}${over.length ? `${plural(over.length, "contract")} ${over.length === 1 ? "has" : "have"} been certified beyond the revised contract value, which usually means an approved change has not reached the contract record. ` : ""}${
          rows.length ? `Across the board, ${money(rows.reduce((t, r) => t + num(r.unpaid_certified), 0))} is certified and not yet paid, and ${money(rows.reduce((t, r) => t + num(r.retention_held), 0))} is held as retention.` : ""
        }`.trim(),
      };
    }
    case "attention": {
      const m = new Map<string, number>();
      for (const r of rows) m.set(String(r.module), (m.get(String(r.module)) ?? 0) + 1);
      const top = [...m.entries()].sort((a, b) => b[1] - a[1]);
      return {
        heading: "Where the pressure is",
        text: `The list is ranked by what is at stake and how long it has been waiting, not by which module it came from. ${top.map(([k, n]) => `${k}: ${n}`).join(" · ")}. Everything on it has a named next step and says what happens if nothing is done; as at ${asOf} the top item is "${String(rows[0]?.item ?? "")}".`,
      };
    }
    default:
      return null;
  }
}

function specificAttention(input: NarrativeInput): string[] {
  const { rows, spec } = input;
  const out: string[] = [];
  if (!rows.length) return out;
  switch (spec.source) {
    case "payments_due": {
      const overdue = rows.filter((r) => String(r.bucket) === "Overdue");
      const old = overdue.filter((r) => num(r.days) < -30);
      const ancient = overdue.filter((r) => num(r.days) < -180);
      if (old.length) out.push(`${plural(old.length, "payment")} ${old.length === 1 ? "is" : "are"} more than 30 days past the contractual date (${list(old.map((r) => `${String(r.contractor)} ${String(r.application_no)}`))}) – late payment interest may already be running.`);
      // a register where most of the "overdue" is very old is usually missing payment dates, not unpaid
      if (overdue.length > 5 && ancient.length / overdue.length > 0.5)
        out.push(`${ancient.length} of the ${overdue.length} overdue items are more than six months past their date. On a running project that normally means the payment date has not been written back against them rather than that they are all genuinely unpaid – worth reconciling the IPC log against the finance record before this report is issued outside the team.`);
      const noInv = rows.filter((r) => String(r.bucket) === "Certified – invoice not yet raised");
      if (noInv.length) out.push(`${plural(noInv.length, "certified amount")} worth ${money(noInv.reduce((t, r) => t + num(r.total_due), 0))} cannot be paid until the contractor invoices – chase ${list([...new Set(noInv.map((r) => String(r.contractor)))])}.`);
      const wht = rows.filter((r) => /WHT/.test(String(r.tax_type)));
      if (wht.length) out.push(`${plural(wht.length, "payment")} ${wht.length === 1 ? "carries" : "carry"} withholding tax rather than VAT – the amount transferred is below the certified figure.`);
      break;
    }
    case "eot_tracker": {
      const stuck = rows.filter((r) => String(r.flag) === "Stuck" && String(r.state) === "Open");
      if (stuck.length) out.push(`${plural(stuck.length, "open claim")} ${stuck.length === 1 ? "has" : "have"} had no recorded action for over 30 days (${list(stuck.map((r) => String(r.claim_no)))}) – the contemporaneous record weakens as they age.`);
      const noTarget = rows.filter((r) => String(r.state) === "Open" && !r.target_date);
      if (noTarget.length) out.push(`${plural(noTarget.length, "open claim")} ${noTarget.length === 1 ? "has" : "have"} no target date set for the next step, so nothing drives ${noTarget.length === 1 ? "it" : "them"} forward.`);
      const late = rows.filter((r) => String(r.state) === "Open" && r.days_to_target !== null && num(r.days_to_target) < 0);
      if (late.length) out.push(`${plural(late.length, "claim")} ${late.length === 1 ? "is" : "are"} past the target date for the next step – either act or reset the date.`);
      break;
    }
    case "attention": {
      const critical = rows.filter((r) => String(r.severity) === "Critical");
      for (const r of critical.slice(0, 5)) out.push(`${String(r.module)} – ${String(r.ref)}: ${String(r.item)}. ${String(r.consequence)} ${String(r.action)}`);
      break;
    }
    case "scorecard": {
      const over = rows.filter((r) => r.pct_certified !== null && num(r.pct_certified) > 100.5);
      if (over.length) out.push(`${plural(over.length, "contract")} ${over.length === 1 ? "is" : "are"} certified beyond the revised contract value (${list(over.map((r) => String(r.contract_ref)))}) – check every approved change has reached the contract record.`);
      const cover = rows.filter((r) => /expired/i.test(String(r.bond_status)));
      if (cover.length) out.push(`${plural(cover.length, "contract")} ${cover.length === 1 ? "is" : "are"} running with an expired bond or policy (${list(cover.map((r) => String(r.contract_ref)))}).`);
      break;
    }
    case "value_bridge": {
      const unsigned = rows.filter((r) => num(r.fa_adjustment) !== 0 && /not agreed|pending|draft/i.test(String(r.status)));
      if (unsigned.length) out.push(`${plural(unsigned.length, "contract")} ${unsigned.length === 1 ? "carries" : "carry"} a final account adjustment on a contract that is not yet agreed – the figure is an assessment, not a settled price.`);
      const big = rows.filter((r) => Math.abs(num(r.movement_pct)) > 25);
      if (big.length) out.push(`${plural(big.length, "contract")} ${big.length === 1 ? "has" : "have"} moved more than 25% from the original price (${list(big.map((r) => String(r.contract_ref)))}) – expect these to be asked about.`);
      break;
    }
  }
  return out;
}
