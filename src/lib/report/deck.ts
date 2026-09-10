import type { ReportData } from "./data";
import { executiveTotals } from "../cost-report/executive";
import { changeContribution } from "../dashboard/movement";
import { getClaimsSummary } from "../claims/summary";
import { getRiskSummary } from "../risks/summary";
import { CHANGE_STAGES } from "../registers/defs/changes";
import { formatDate, formatMonthYear } from "../format";
import { APP_NAME } from "../brand";
import type { RecordRow } from "../registers/types";

/**
 * The monthly cost report as a presentation: one slide model, rendered to PowerPoint (deck-pptx.ts)
 * and to PDF (deck-pdf.ts) so both look the same. Positions are in inches on a 16:9 canvas of
 * 13.333 x 7.5 in (PowerPoint "wide"); the PDF renderer scales by 72 pt per inch.
 */
export const CANVAS = { w: 13.333, h: 7.5 };
const M = 0.45; // side margin
const BODY_Y = 1.25;
const BODY_H = 5.6;
const BODY_W = CANVAS.w - 2 * M;

export const PALETTE = {
  navy: "1F3A5F",
  teal: "0E7C86",
  accent: "EB6834",
  blue: "2A78D6",
  gold: "C9A227",
  green: "2E9E5B",
  red: "D64545",
  amber: "E29A1A",
  purple: "7C5CBF",
  grey: "6B7280",
  ink: "172033",
  line: "D6DCE5",
  zebra: "F3F6FA",
  tile: "F7F9FC",
  white: "FFFFFF",
};
/** Series colours, in order. */
export const SERIES_COLORS = [PALETTE.blue, PALETTE.accent, PALETTE.teal, PALETTE.gold, PALETTE.purple, PALETTE.green, PALETTE.red, PALETTE.grey];

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Tone = "neutral" | "good" | "bad" | "accent" | "info";
export interface DeckKpi {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}
export interface DeckColumn {
  label: string;
  align?: "left" | "right" | "center";
  /** relative width */
  w: number;
}
export interface DeckTable {
  columns: DeckColumn[];
  rows: string[][];
  /** last row is a total: bold with a top rule */
  totalRow?: boolean;
  fontSize?: number;
  /** per-row tone for the first cell chip (e.g. status colours) */
  tones?: (Tone | undefined)[];
}
export type ChartKind = "bar" | "stackedBar" | "line" | "doughnut" | "pie" | "barH";
export interface DeckChart {
  type: ChartKind;
  categories: string[];
  series: { name: string; values: number[]; color?: string }[];
  /** axis / label unit, e.g. "SAR million" */
  unit?: string;
  showValues?: boolean;
  colors?: string[];
  /** number format for labels: decimals */
  decimals?: number;
}
export type DeckBlock =
  | { kind: "kpis"; frame: Frame; items: DeckKpi[] }
  | { kind: "table"; frame: Frame; title?: string; table: DeckTable }
  | { kind: "chart"; frame: Frame; title?: string; chart: DeckChart }
  | { kind: "bullets"; frame: Frame; title?: string; items: string[]; fontSize?: number }
  | { kind: "text"; frame: Frame; title?: string; text: string; fontSize?: number };

export interface DeckSlide {
  /** "title" slides are drawn on a navy background; "content" slides have the header/footer */
  layout: "title" | "content";
  title: string;
  subtitle?: string;
  /** colour of the slide's accent band */
  accent: string;
  blocks: DeckBlock[];
  /** speaker notes */
  notes?: string;
}

/** A block before layout: the composer gives it a frame. */
type Content = (Omit<Extract<DeckBlock, { kind: "table" }>, "frame"> | Omit<Extract<DeckBlock, { kind: "chart" }>, "frame"> | Omit<Extract<DeckBlock, { kind: "bullets" }>, "frame"> | Omit<Extract<DeckBlock, { kind: "text" }>, "frame">) & { weight?: number };

const isEmpty = (b: Content): boolean =>
  (b.kind === "table" && b.table.rows.length === 0) ||
  (b.kind === "chart" && !b.chart.series.some((s) => s.values.some((v) => v !== 0))) ||
  (b.kind === "bullets" && b.items.length === 0) ||
  (b.kind === "text" && !b.text.trim());

/**
 * Lays a slide out so it is always full: empty blocks are dropped, the survivors share the body
 * (side by side, or stacked with `stack`), KPI tiles without a value are dropped. Returns null when
 * nothing presentable is left, so the slide is skipped.
 */
function compose(spec: { title: string; subtitle?: string; accent: string; kpis?: DeckKpi[]; blocks: Content[]; stack?: boolean; notes?: string }): DeckSlide | null {
  const kpis = (spec.kpis ?? []).filter((k) => k.value && !/^(n\/a|–|-|0|0 \/ 0)$/.test(k.value.trim()));
  const blocks = spec.blocks.filter((b) => !isEmpty(b));
  if (!blocks.length && kpis.length < 3) return null;
  const out: DeckBlock[] = [];
  let area = full();
  if (kpis.length) {
    const k = kpiRow();
    out.push({ kind: "kpis", frame: k, items: kpis.slice(0, 6) });
    area = below(k.h);
  }
  const total = blocks.reduce((t, b) => t + (b.weight ?? 1), 0);
  let pos = 0;
  for (const b of blocks) {
    const share = (b.weight ?? 1) / total;
    const frame: Frame = spec.stack
      ? { x: area.x, y: area.y + pos * (area.h + GAP), w: area.w, h: share * (area.h + GAP) - GAP }
      : { x: area.x + pos * (area.w + GAP), y: area.y, w: share * (area.w + GAP) - GAP, h: area.h };
    pos += share;
    const { weight: _w, ...rest } = b;
    void _w;
    out.push({ ...rest, frame } as DeckBlock);
  }
  return { layout: "content", title: spec.title, subtitle: spec.subtitle, accent: spec.accent, blocks: out, notes: spec.notes };
}
export interface Deck {
  meta: {
    appName: string;
    programme: string;
    programmeCode: string;
    asset: string;
    period: string;
    reportNo: number;
    cutOff: string;
    status: "Issued" | "Draft";
    client: string;
    location: string;
    generated: string;
  };
  slides: DeckSlide[];
}

/* ------------------------------------------------------------------ */
/* Layout helpers                                                      */
/* ------------------------------------------------------------------ */
const GAP = 0.3;
const full = (): Frame => ({ x: M, y: BODY_Y, w: BODY_W, h: BODY_H });
const kpiRow = (h = 1.15): Frame => ({ x: M, y: BODY_Y, w: BODY_W, h });
const below = (top: number): Frame => ({ x: M, y: BODY_Y + top + GAP, w: BODY_W, h: BODY_H - top - GAP });


/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
/** SAR with thousands separators, no decimals. */
export const money = (v: number) => (Math.round(v) < 0 ? `(${Math.abs(Math.round(v)).toLocaleString("en-US")})` : Math.round(v).toLocaleString("en-US"));
/** SAR in millions with one decimal, e.g. "314.7m". */
export const mio = (v: number) => `${(v / 1e6).toFixed(1)}m`;
const signed = (v: number) => (v > 0 ? `+${money(v)}` : money(v));
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");
const toMio = (v: number) => Math.round((v / 1e6) * 100) / 100;
const clip = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const label = (r: RecordRow, key: string) => String(r[`${key}__label`] ?? r[key] ?? "");
const SHORT_COL: Record<string, string> = { E: "Baseline budget", F: "Budget transfers", G: "Latest budget", H: "Determined VOs", I: "Committed", J: "Potential VOs", K: "RFCs", L: "Early warnings", M: "Claims", N: "Anticipated FA", O: "Variance", P: "Certified", Q: "Works to complete" };
const toneOf = (v: number, goodWhenNegative = true): Tone => (v === 0 ? "neutral" : (v < 0) === goodWhenNegative ? "good" : "bad");

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */
export function buildDeck(d: ReportData): Deck {
  const g = executiveTotals(d.costReport);
  const dash = d.dashboard;
  const mv = d.movement;
  const rows = (key: string) => d.registers[key]?.rows ?? [];
  const meta: Deck["meta"] = {
    appName: APP_NAME,
    programme: d.programme.name,
    programmeCode: d.programme.code,
    asset: d.asset ? `${d.asset.code} · ${d.asset.name}` : "",
    period: d.period.label,
    reportNo: d.period.report_no,
    cutOff: formatDate(d.period.period_end),
    status: d.locked ? "Issued" : "Draft",
    client: d.client,
    location: d.location,
    generated: formatDate(d.generatedAt),
  };
  const slides: DeckSlide[] = [];

  /* Accent colours cycle through the deck so every section has its own colour band. */
  const ACCENTS = [PALETTE.accent, PALETTE.teal, PALETTE.blue, PALETTE.gold, PALETTE.purple, PALETTE.green, PALETTE.red];
  let accentNo = 0;
  const nextAccent = () => ACCENTS[accentNo++ % ACCENTS.length];
  const push = (slide: DeckSlide | null) => {
    if (slide) slides.push(slide);
  };

  /* 1. Title */
  slides.push({
    layout: "title",
    accent: PALETTE.accent,
    title: "Monthly Cost Report",
    subtitle: `${d.period.label} · cut-off ${meta.cutOff}`,
    blocks: [
      { kind: "text", frame: { x: 0.9, y: 4.2, w: 8.5, h: 1.6 }, text: [d.programme.name, meta.asset, [d.client, d.location].filter(Boolean).join(" · ")].filter(Boolean).join("\n") },
      { kind: "text", frame: { x: 0.9, y: 6.2, w: 11, h: 0.6 }, text: `${meta.status === "Issued" ? "Issued report" : "Draft – period not yet locked"} · prepared by the Commercial Management team · ${meta.generated}` },
    ],
  });

  /* 2. Executive dashboard */
  const prevLabel = d.costReport.previousPeriod?.label ?? "";
  const movementOk = !!d.costReport.previousPeriod?.snapshotAvailable && !!mv && !mv.warning;
  const shortPrev = prevLabel.replace("Monthly Report ", "");
  const composition: DeckChart = {
    type: "doughnut",
    categories: ["Latest budget (G)", "Determined VOs (H)", "Potential VOs (J)", "RFCs (K)", "Early warnings (L)", "Claims (M)"],
    series: [{ name: "Anticipated Final Account", values: [g.G, g.H, g.J, g.K, g.L, g.M].map(toMio) }],
    unit: "SAR million",
    colors: [PALETTE.navy, PALETTE.blue, PALETTE.teal, PALETTE.gold, PALETTE.amber, PALETTE.red],
    decimals: 1,
  };
  const headlines: string[] = [
    `Anticipated Final Account of SAR ${money(g.N)} against a latest budget of SAR ${money(g.G)}: ${g.O === 0 ? "on budget" : `SAR ${money(Math.abs(g.O))} (${pct(Math.abs(g.O), g.G)}) ${g.O > 0 ? "over" : "under"} budget`}.`,
    ...(movementOk ? [`Movement since ${prevLabel}: ${g.S === 0 ? "no change" : `${g.S > 0 ? "increase" : "decrease"} of SAR ${money(Math.abs(g.S))}`}${mv?.keyMovements?.length ? `, mainly ${describeTopMovement(mv.keyMovements)}` : ""}.`] : []),
    `Certified to date SAR ${money(g.P)} (${pct(g.P, g.N)} of the anticipated final account); works to complete SAR ${money(g.Q)}.`,
    `${dash.openChanges} open change item${dash.openChanges === 1 ? "" : "s"} carried at SAR ${money(g.H + g.J + g.K)} (DVO, PVO and RFC); ${dash.openEarlyWarnings} open early warning${dash.openEarlyWarnings === 1 ? "" : "s"} at SAR ${money(dash.ewOpenValue)}.`,
    ...(dash.openClaims || dash.openRisks ? [`${dash.openClaims} pending claim${dash.openClaims === 1 ? "" : "s"} (SAR ${money(dash.claimsPendingValue)} claimed); ${dash.openRisks} open risk${dash.openRisks === 1 ? "" : "s"}.`] : []),
    `Bonds & insurance: ${dash.bonds.expired} expired on live contracts, ${dash.bonds.red + dash.bonds.amber} expiring within 60 days, ${dash.bonds.shortfall} below the contract requirement.`,
  ];
  push(
    compose({
      title: "Executive Summary",
      subtitle: "Cost position at a glance",
      accent: nextAccent(),
      kpis: [
        { label: "Approved baseline budget", value: money(g.E) },
        { label: "Latest budget", value: money(g.G), sub: `transfers ${signed(g.F)}` },
        { label: "Anticipated final account", value: money(g.N), tone: "accent" },
        { label: "Variance to budget", value: signed(g.O), tone: toneOf(g.O), sub: g.O > 0 ? "over budget" : g.O < 0 ? "under budget" : "on budget" },
        { label: "Certified to date", value: money(g.P), sub: `${pct(g.P, g.N)} of AFA` },
        movementOk ? { label: "Period movement", value: signed(g.S), tone: toneOf(g.S), sub: `vs ${shortPrev}` } : { label: "Works to complete", value: money(g.Q), sub: "AFA less certified" },
      ],
      blocks: [
        { kind: "bullets", title: "Headlines", items: headlines, fontSize: 11, weight: 1 },
        { kind: "chart", title: "Anticipated final account build-up (SAR million)", chart: composition, weight: 1 },
      ],
      notes: headlines.join(" "),
    }),
  );

  /* 3. Level 1 (Excel "Level 01" layout: categories across, report lines down) */
  {
    const m = d.level1Matrix;
    const want = ["G", "awards", "H", "J", "K", "L", "M", "N", "O", "P"];
    const picked = want.map((k) => m.rows.find((r) => r.key === k)).filter((r): r is NonNullable<typeof r> => !!r && (r.total !== 0 || ["G", "N", "O"].includes(r.key)));
    const t: DeckTable = {
      columns: [{ label: "SAR", w: 2.6 }, ...m.columns.map((c) => ({ label: clip(c.label, 22), align: "right" as const, w: 1.2 })), { label: "Total", align: "right", w: 1.3 }, ...(movementOk ? [{ label: "Movement", align: "right" as const, w: 1.1 }] : [])],
      rows: picked.map((r) => [r.label.replace(/\s*\(.*\)$/, ""), ...r.values.map((v) => (r.signed ? signed(v) : money(v))), r.signed ? signed(r.total) : money(r.total), ...(movementOk ? [r.movement === null ? "–" : signed(r.movement)] : [])]),
      fontSize: 8,
      tones: picked.map((r) => (r.key === "O" ? toneOf(r.total) : r.key === "N" ? "accent" : undefined)),
    };
    const gRow = m.rows.find((r) => r.key === "G");
    const nRow = m.rows.find((r) => r.key === "N");
    const chart: DeckChart = {
      type: "bar",
      categories: m.columns.slice(0, 8).map((c) => clip(c.label, 18)),
      series: [
        { name: "Development budget", values: (gRow?.values ?? []).slice(0, 8).map(toMio), color: PALETTE.blue },
        { name: "Anticipated final account", values: (nRow?.values ?? []).slice(0, 8).map(toMio), color: PALETTE.accent },
      ],
      unit: "SAR million",
      decimals: 1,
    };
    push(compose({ title: "Cost Report – Level 1 (Executive)", subtitle: "By cost category, executive view (budget includes the unallocated hold; other lines exclude it)", accent: nextAccent(), stack: true, blocks: [{ kind: "table", table: t, weight: 1.4 }, { kind: "chart", title: "Development budget vs anticipated final account by category (SAR million)", chart, weight: 1 }] }));
  }

  /* 4. Packages */
  {
    const pk = [...d.costReport.chart].filter((p) => p.baseline || p.afa).sort((a, b) => b.baseline - a.baseline).slice(0, 12);
    const chart: DeckChart = {
      type: "bar",
      categories: pk.map((p) => clip(p.package, 16)),
      series: [
        { name: "Approved baseline budget", values: pk.map((p) => toMio(p.baseline)), color: PALETTE.blue },
        { name: "Anticipated final account", values: pk.map((p) => toMio(p.afa)), color: PALETTE.accent },
      ],
      unit: "SAR million",
      decimals: 1,
    };
    const worst = [...d.costReport.lines].filter((l) => !l.is_budget_hold && l.O > 0).sort((a, b) => b.O - a.O).slice(0, 6);
    const best = [...d.costReport.lines].filter((l) => !l.is_budget_hold && l.O < 0).sort((a, b) => a.O - b.O).slice(0, 4);
    const t: DeckTable = {
      columns: [
        { label: "Cost line", w: 2.6 },
        { label: "Latest budget", align: "right", w: 1.2 },
        { label: "Anticipated FA", align: "right", w: 1.2 },
        { label: "Variance", align: "right", w: 1.1 },
      ],
      rows: [...worst, ...best].map((l) => [`${l.code} ${clip(l.name, 28)}`, money(l.G), money(l.N), signed(l.O)]),
      fontSize: 8,
      tones: [...worst.map(() => "bad" as Tone), ...best.map(() => "good" as Tone)],
    };
    push(compose({ title: "Cost Report – Packages", subtitle: "Largest packages and the lines driving the variance", accent: nextAccent(), blocks: [{ kind: "chart", title: "Baseline budget vs anticipated final account by package (SAR million)", chart, weight: 1.25 }, { kind: "table", title: "Largest over-runs and savings (SAR)", table: t, weight: 1 }] }));
  }

  /* 5. Movement – only when there is an issued previous report to compare with */
  if (movementOk && mv) {
    const moves = (mv.keyMovements ?? []).flatMap((k) => k.items.map((i) => ({ col: k.col, colLabel: k.label, ...i }))).filter((m) => m.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10);
    const t: DeckTable = {
      columns: [
        { label: "Col", align: "center", w: 0.5 },
        { label: "Item", w: 3.6 },
        { label: "Previous", align: "right", w: 1.2 },
        { label: "Now", align: "right", w: 1.2 },
        { label: "Movement", align: "right", w: 1.2 },
        { label: "Note", w: 2.2 },
      ],
      rows: moves.map((m) => [m.col, clip(m.title, 52), money(m.prev), money(m.now), signed(m.delta), clip(m.note, 34)]),
      fontSize: 8,
      tones: moves.map((m) => toneOf(m.delta)),
    };
    const cols = (mv.keyMovements ?? []).filter((k) => k.kpiDelta !== 0);
    const chart: DeckChart = {
      type: "barH",
      categories: cols.map((k) => `${k.col} · ${SHORT_COL[k.col] ?? clip(k.label, 22)}`),
      series: [{ name: "Movement (SAR million)", values: cols.map((k) => toMio(k.kpiDelta)), color: PALETTE.teal }],
      unit: "SAR million",
      showValues: true,
      decimals: 2,
    };
    push(
      compose({
        title: "Movement since the previous report",
        subtitle: `${prevLabel} to ${d.period.label}`,
        accent: nextAccent(),
        kpis: ([
          { label: `AFA – ${shortPrev}`, value: money(g.R) },
          { label: `AFA – ${d.period.label.replace("Monthly Report ", "")}`, value: money(g.N), tone: "accent" },
          { label: "Period movement", value: signed(g.S), tone: toneOf(g.S) },
          ...(mv.kpis ?? []).filter((k) => ["G", "H", "J", "L", "M"].includes(k.key) && k.delta !== 0).map((k): DeckKpi => ({ label: `${SHORT_COL[k.key] ?? k.label} (${k.key})`, value: signed(k.delta), tone: toneOf(k.delta), sub: "movement" })),
        ] as DeckKpi[]).slice(0, 6),
        stack: moves.length <= 5,
        blocks: moves.length <= 5 ? [{ kind: "chart", title: "Movement by cost report column", chart, weight: 1 }, { kind: "table", title: "Key period movements", table: t, weight: 0.2 + 0.16 * (moves.length + 1) }] : [
          { kind: "chart", title: "Movement by cost report column", chart, weight: 0.8 },
          { kind: "table", title: "Key period movements", table: t, weight: 1.4 },
        ],
      }),
    );
  }

  /* 6. Change management */
  {
    const ch = rows("changes");
    const stages = CHANGE_STAGES.filter((s) => ["rfc", "pvo", "vo", "dvo"].includes(s.prefix));
    const statusOf = (r: RecordRow, prefix: string) => String(r[`${prefix}_status_id__label`] ?? "");
    const buckets = ["Approved", "Pending", "Cancelled"] as const;
    const counts = stages.map((s) => {
      const c = { Approved: 0, Pending: 0, Cancelled: 0, Other: 0 };
      for (const r of ch) {
        const st = statusOf(r, s.prefix);
        if (!st) continue;
        if (st === "Approved" || st === "Review Complete") c.Approved++;
        else if (st === "Pending" || st === "Revised & Re-submit") c.Pending++;
        else if (st === "Cancelled" || st === "Superseded") c.Cancelled++;
        else c.Other++;
      }
      return c;
    });
    const chart: DeckChart = {
      type: "stackedBar",
      categories: stages.map((s) => s.short),
      series: [
        ...buckets.map((b, i) => ({ name: b, values: counts.map((c) => c[b]), color: [PALETTE.green, PALETTE.amber, PALETTE.grey][i] })),
        ...(counts.some((c) => c.Other) ? [{ name: "Other", values: counts.map((c) => c.Other), color: PALETTE.purple }] : []),
      ],
      showValues: true,
      decimals: 0,
    };
    const open = ch
      .filter((r) => r.is_closed !== true)
      .map((r) => ({ r, c: changeContribution(r) }))
      .filter((x) => x.c && x.c.amount !== 0)
      .sort((a, b) => Math.abs(b.c!.amount) - Math.abs(a.c!.amount))
      .slice(0, 10);
    const t: DeckTable = {
      columns: [
        { label: "Item", w: 0.9 },
        { label: "Description", w: 3.2 },
        { label: "Stage", align: "center", w: 0.7 },
        { label: "Status", w: 1.2 },
        { label: "Contractor", w: 1.6 },
        { label: "Cost report (SAR)", align: "right", w: 1.3 },
      ],
      rows: open.map(({ r, c }) => [String(r.item_no ?? ""), clip(r.description, 48), String(r.current_stage ?? ""), label(r, "overall_status_id"), clip(label(r, "contractor_id"), 24), `${c!.col}: ${money(c!.amount)}`]),
      fontSize: 8,
    };
    const over90 = mv?.dvoAgeing?.find((b) => b.bucket.includes("90"))?.now ?? 0;
    if (ch.length)
      push(
        compose({
          title: "Change Management",
          subtitle: "Variations, RFCs and their cost report effect",
          accent: nextAccent(),
          kpis: [
            { label: "Change items", value: String(ch.length) },
            { label: "Open", value: String(dash.openChanges), tone: dash.openChanges ? "info" : "neutral" },
            { label: "Determined VOs (H)", value: money(g.H) },
            { label: "Potential VOs (J)", value: money(g.J) },
            { label: "RFCs (K)", value: money(g.K) },
            { label: "DVOs over 90 days", value: String(over90), tone: over90 > 0 ? "bad" : "good" },
          ],
          blocks: [
            { kind: "chart", title: "Status by stage (number of items)", chart, weight: 0.8 },
            { kind: "table", title: "Largest open change items", table: t, weight: 1.5 },
          ],
        }),
      );
  }

  /* 7. Early warnings & risks */
  {
    const ews = rows("early_warnings");
    const rs = getRiskSummary(rows("risks"));
    const openEw = ews.filter((e) => e.status === "Open").sort((a, b) => num(b.cost_impact) - num(a.cost_impact)).slice(0, 9);
    const t: DeckTable = {
      columns: [
        { label: "EW No", w: 0.8 },
        { label: "Description", w: 3.6 },
        { label: "Contractor", w: 1.8 },
        { label: "Likelihood", align: "center", w: 0.9 },
        { label: "Cost impact", align: "right", w: 1.2 },
        { label: "Time (days)", align: "right", w: 0.8 },
      ],
      rows: openEw.map((e) => [String(e.ew_no ?? ""), clip(e.description, 54), clip(label(e, "contractor_id"), 26), String(e.likelihood ?? ""), money(num(e.cost_impact)), String(num(e.time_impact_days) || "–")]),
      fontSize: 8,
    };
    const byLik = ["High", "Medium", "Low"].map((l) => ews.filter((e) => e.status === "Open" && String(e.likelihood ?? "").startsWith(l)).reduce((s, e) => s + num(e.cost_impact), 0));
    const chart: DeckChart = { type: "pie", categories: ["High likelihood", "Medium likelihood", "Low likelihood"], series: [{ name: "Open early warnings (SAR million)", values: byLik.map(toMio) }], colors: [PALETTE.red, PALETTE.amber, PALETTE.green], decimals: 1, unit: "SAR million" };
    const risk = rs.totals.find((t) => t.type === "Risk");
    const opp = rs.totals.find((t) => t.type === "Opportunity");
    if (ews.length || (risk?.open ?? 0) > 0)
      push(
        compose({
          title: "Early Warnings & Risks",
          subtitle: "Potential cost and time exposure not yet instructed",
          accent: nextAccent(),
          kpis: [
            { label: "Early warnings", value: String(ews.length) },
            { label: "Open", value: String(dash.openEarlyWarnings), tone: dash.openEarlyWarnings ? "info" : "neutral" },
            { label: "Open cost exposure (L)", value: money(dash.ewOpenValue), tone: "accent" },
            { label: "Open risks", value: String(risk?.open ?? 0), tone: (risk?.open ?? 0) ? "bad" : "good" },
            { label: "Risk expected value", value: money(risk?.expectedValue ?? 0) },
            { label: "Opportunity expected value", value: money(opp?.expectedValue ?? 0), tone: "good" },
          ],
          blocks: [
            { kind: "chart", title: "Open early warnings by likelihood", chart, weight: 0.7 },
            { kind: "table", title: "Open early warnings by cost impact", table: t, weight: 1.6 },
          ],
        }),
      );
  }

  /* 8. Claims */
  {
    const cl = rows("claims");
    const cs = getClaimsSummary(d.programme.id, cl);
    const list = [...cl].sort((a, b) => num(b.contractor_cost_view) - num(a.contractor_cost_view)).slice(0, 10);
    const t: DeckTable = {
      columns: [
        { label: "Claim", w: 0.9 },
        { label: "Description", w: 3.4 },
        { label: "Contractor", w: 1.8 },
        { label: "Status", align: "center", w: 0.9 },
        { label: "EOT claimed / granted", align: "center", w: 1.1 },
        { label: "Claimed (SAR)", align: "right", w: 1.2 },
        { label: "Determined (SAR)", align: "right", w: 1.2 },
      ],
      rows: list.map((c) => [String(c.claim_no ?? ""), clip(c.description, 50), clip(label(c, "contractor_id"), 24), String(c.status ?? ""), `${num(c.contractor_eot_days_view) || 0} / ${num(c.determination_eot_days_view) || 0}`, money(num(c.contractor_cost_view)), money(num(c.determination_cost_view))]),
      fontSize: 8,
      tones: list.map((c) => (c.status === "Approved" ? "good" : c.status === "Rejected" ? "neutral" : "info")),
    };
    const parties = cs.parties.filter((p) => p.cost);
    const chart: DeckChart = {
      type: "bar",
      categories: parties.map((p) => p.label.split(/['’]/)[0].split(" / ")[0].trim()),
      series: [{ name: "Cost (SAR million)", values: parties.map((p) => toMio(p.cost)), color: PALETTE.teal }],
      unit: "SAR million",
      showValues: true,
      decimals: 1,
    };
    if (cl.length)
      push(
        compose({
          title: "Claims & Disputes",
          subtitle: "Claims tracker position",
          accent: nextAccent(),
          kpis: [
            { label: "Claims", value: String(cs.total) },
            { label: "Pending", value: String(cs.open), tone: cs.open ? "info" : "neutral" },
            { label: "SAR claimed", value: money(cs.costClaimed), tone: "accent" },
            { label: "SAR determined", value: money(cs.costDetermined) },
            { label: "EOT claimed / granted (days)", value: `${cs.eotClaimed} / ${cs.eotGranted}` },
            { label: "Carried in cost report (M)", value: money(g.M) },
          ],
          blocks: [
            { kind: "chart", title: "Claimed, assessed and determined", chart, weight: 0.7 },
            { kind: "table", title: "Claims by value", table: t, weight: 1.6 },
          ],
        }),
      );
  }

  /* 9. Invoices & payments */
  {
    const pts = dash.payments.slice(-18);
    const chart: DeckChart = {
      type: "line",
      categories: pts.map((p) => formatMonthYear(p.date)),
      series: [
        { name: "Claimed", values: pts.map((p) => toMio(p.claimed)), color: PALETTE.gold },
        { name: "Certified", values: pts.map((p) => toMio(p.certified)), color: PALETTE.blue },
        { name: "Paid", values: pts.map((p) => toMio(p.paid)), color: PALETTE.green },
      ],
      unit: "SAR million",
      decimals: 1,
    };
    const tracker = (mv?.payments ?? []).slice().filter((p) => p.revised || p.certified).sort((a, b) => b.revised - a.revised).slice(0, 9);
    const t: DeckTable = {
      columns: [
        { label: "Contract", w: 2.6 },
        { label: "Contractor", w: 1.7 },
        { label: "Status", align: "center", w: 0.8 },
        { label: "Revised value", align: "right", w: 1.2 },
        { label: "Certified", align: "right", w: 1.2 },
        { label: "%", align: "right", w: 0.5 },
        { label: "Paid", align: "right", w: 1.2 },
        { label: "Late IPC / pay", align: "center", w: 0.9 },
      ],
      rows: tracker.map((p) => [clip(p.title, 34), clip(p.contractor, 22), clip(p.status, 10), money(p.revised), money(p.certified), p.pctCertified === null ? "–" : `${Math.round(p.pctCertified)}%`, money(p.paid), `${p.lateIpcs} / ${p.latePayments}`]),
      fontSize: 8,
      tones: tracker.map((p) => (p.lateIpcs + p.latePayments > 0 ? "bad" : undefined)),
    };
    const last = pts[pts.length - 1];
    if (pts.length)
      push(
        compose({
          title: "Invoices & Payments",
          subtitle: "Certification and payment progress",
          accent: nextAccent(),
          kpis: [
            { label: "Claimed to date", value: money(last?.claimed ?? 0) },
            { label: "Certified to date (P)", value: money(g.P), tone: "accent" },
            { label: "Paid to date", value: money(last?.paid ?? 0), tone: "good" },
            { label: "Certified, not yet paid", value: money((last?.certified ?? 0) - (last?.paid ?? 0)) },
            { label: "Works to complete (Q)", value: money(g.Q) },
            { label: "Late IPCs / payments", value: `${tracker.reduce((s, p) => s + p.lateIpcs, 0)} / ${tracker.reduce((s, p) => s + p.latePayments, 0)}`, tone: tracker.some((p) => p.lateIpcs + p.latePayments > 0) ? "bad" : "good" },
          ],
          blocks: [
            { kind: "chart", title: "Cumulative claimed, certified and paid (SAR million)", chart, weight: 0.8 },
            { kind: "table", title: "Payment status by contract", table: t, weight: 1.5 },
          ],
        }),
      );
  }

  /* 10. Cash flow – only when a forecast or actuals exist */
  {
    const cf = d.cashflow;
    const periodKey = d.period.period_end.slice(0, 7);
    // cf.chart is already cumulative; the month-by-month figures come from monthTotals
    const all = cf.months.map((m, i) => ({ key: m.key, label: m.label, month: cf.monthTotals[m.key] ?? { forecast: 0, actual: 0, difference: 0 }, cum: cf.chart[i] ?? { forecast: 0, actual: 0 } }));
    const upTo = all.filter((m) => m.key <= periodKey);
    const pts = (upTo.length >= 6 ? upTo : all).slice(-18);
    const hasForecast = pts.some((p) => p.month.forecast);
    const hasActual = pts.some((p) => p.month.actual);
    const chart: DeckChart = {
      type: "bar",
      categories: pts.map((p) => p.label),
      series: [...(hasForecast ? [{ name: "Forecast", values: pts.map((p) => toMio(p.month.forecast)), color: PALETTE.blue }] : []), ...(hasActual ? [{ name: "Actual", values: pts.map((p) => toMio(p.month.actual)), color: PALETTE.green }] : [])],
      unit: "SAR million",
      decimals: 1,
    };
    const cumChart: DeckChart = {
      type: "line",
      categories: pts.map((p) => p.label),
      series: [...(hasForecast ? [{ name: "Cumulative forecast", values: pts.map((p) => toMio(p.cum.forecast)), color: PALETTE.blue }] : []), ...(hasActual ? [{ name: "Cumulative actual", values: pts.map((p) => toMio(p.cum.actual)), color: PALETTE.green }] : [])],
      unit: "SAR million",
      decimals: 1,
    };
    const acc = cf.accruals;
    const cashKpis: DeckKpi[] = [
      ...(hasForecast ? [{ label: "Forecast (range)", value: money(cf.grand.forecast) }] : []),
      { label: "Actual (range)", value: money(cf.grand.actual), tone: "accent" },
      ...(hasForecast ? [{ label: "Difference", value: signed(cf.grand.difference), tone: toneOf(cf.grand.difference) }] : []),
      { label: "Accrued (certified, unpaid)", value: money(acc.totalAccrued) },
      { label: "Overdue payments", value: money(acc.totalOverdue), tone: acc.totalOverdue > 0 ? "bad" : "good" },
      { label: "Months shown", value: String(pts.length) },
    ];
    if (hasForecast || hasActual)
      push(
        compose({
          title: "Cash Flow",
          subtitle: hasForecast ? "Forecast against actual expenditure" : "Actual expenditure by month (no forecast entered yet)",
          accent: nextAccent(),
          kpis: cashKpis,
          blocks: [
            { kind: "chart", title: "Monthly (SAR million)", chart, weight: 1 },
            { kind: "chart", title: "Cumulative (SAR million)", chart: cumChart, weight: 1 },
          ],
        }),
      );
  }

  /* 11. Bonds & insurance */
  {
    const b = dash.bonds;
    const list = b.expiring.slice(0, 12);
    const t: DeckTable = {
      columns: [
        { label: "Ref", w: 0.8 },
        { label: "Type", w: 2.4 },
        { label: "Contractor", w: 3.0 },
        { label: "Expiry", align: "center", w: 1.0 },
        { label: "Days", align: "right", w: 0.8 },
      ],
      rows: list.map((e) => [e.ref, clip(e.type, 34), clip(e.contractor, 40), formatDate(e.expiry_date), e.days < 0 ? `expired ${Math.abs(e.days)}d` : String(e.days)]),
      fontSize: 8,
      tones: list.map((e) => (e.tone === "red" ? "bad" : "info")),
    };
    const chart: DeckChart = {
      type: "doughnut",
      categories: ["Active", "Expiring within 60 days", "Expired (live contracts)", "Released / superseded"],
      series: [{ name: "Bonds & policies", values: [Math.max(0, b.total - b.expired - b.red - b.amber - b.released - b.superseded), b.red + b.amber, b.expired, b.released + b.superseded] }],
      colors: [PALETTE.green, PALETTE.amber, PALETTE.red, PALETTE.grey],
      decimals: 0,
    };
    if (b.total)
      push(
        compose({
          title: "Bonds & Insurance",
          subtitle: "Securities held against the contract requirements",
          accent: nextAccent(),
          kpis: [
            { label: "Bonds & policies", value: String(b.total) },
            { label: "Expired on live contracts", value: String(b.expired), tone: b.expired ? "bad" : "good" },
            { label: "Expiring within 60 days", value: String(b.red + b.amber), tone: b.red + b.amber ? "info" : "good" },
            { label: "Released (contract closed)", value: String(b.released + b.superseded) },
            { label: "Provided vs required", value: `${mio(b.provided)} / ${mio(b.required)}` },
            { label: "Shortfalls", value: String(b.shortfall), tone: b.shortfall ? "bad" : "good", sub: b.shortfall ? `SAR ${money(b.shortfallValue)} below requirement` : undefined },
          ],
          blocks: [
            { kind: "chart", title: "Portfolio status", chart, weight: 0.8 },
            { kind: "table", title: "Expired and expiring on live contracts", table: t, weight: 1.5 },
          ],
        }),
      );
  }

  /* 12. Provisional sums & budget transfers – only when there is something to show */
  {
    const ps = rows("provisional_sums").sort((a, b) => num(b.budget) - num(a.budget)).slice(0, 8);
    const bt = rows("budget_transfers").sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))).slice(0, 6);
    const psTotal = rows("provisional_sums").reduce((s, r) => ({ b: s.b + num(r.budget), c: s.c + num(r.contract_value) }), { b: 0, c: 0 });
    const t1: DeckTable = {
      columns: [
        { label: "Item", w: 0.7 },
        { label: "Provisional sum", w: 2.6 },
        { label: "Status", align: "center", w: 1.0 },
        { label: "Budget", align: "right", w: 1.1 },
        { label: "Contract value", align: "right", w: 1.1 },
        { label: "(Saving) / extra", align: "right", w: 1.1 },
      ],
      rows: ps.length ? [...ps.map((r) => [String(r.item ?? ""), clip(r.description, 40), label(r, "status_id"), money(num(r.budget)), money(num(r.contract_value)), signed(num(r.saving_extra))]), ["", "Total (all items)", "", money(psTotal.b), money(psTotal.c), signed(psTotal.c - psTotal.b)]] : [],
      totalRow: true,
      fontSize: 8,
    };
    const t2: DeckTable = {
      columns: [
        { label: "Item", w: 0.7 },
        { label: "Transfer", w: 2.2 },
        { label: "From → to", w: 2.2 },
        { label: "Status", align: "center", w: 0.9 },
        { label: "Amount", align: "right", w: 1.1 },
      ],
      rows: bt.map((r) => [String(r.item ?? ""), clip(r.description, 34), `${clip(label(r, "from_package_id"), 16)} → ${clip(label(r, "to_package_id"), 16)}`, String(r.status ?? ""), money(num(r.amount))]),
      fontSize: 8,
    };
    push(compose({ title: "Provisional Sums & Budget Transfers", subtitle: g.F ? `Transfers to date ${signed(g.F)} (column F)` : "Provisional sums and approved transfers", accent: nextAccent(), blocks: [{ kind: "table", title: "Provisional sums (SAR)", table: t1, weight: 1.2 }, { kind: "table", title: "Latest budget transfers (SAR)", table: t2, weight: 1 }] }));
  }

  /* 13. Key issues & actions – only when there are any */
  {
    const issues = String(dash.keyIssues ?? "")
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 8);
    const actions = dash.actions.slice(0, 9);
    const t: DeckTable = {
      columns: [
        { label: "No", w: 1.0 },
        { label: "Action", w: 3.4 },
        { label: "Owner", w: 1.3 },
        { label: "Due", align: "center", w: 0.9 },
        { label: "Status", align: "center", w: 0.9 },
      ],
      rows: actions.map((a) => [String(a.item_no ?? ""), clip(a.action || a.topic, 60), clip(a.owner, 18), formatDate(String(a.due_date ?? "")) || "–", String(a.status ?? "")]),
      fontSize: 8,
      tones: actions.map((a) => (a.status === "Overdue" || (a.due_date && String(a.due_date) < d.period.period_end && a.status !== "Closed") ? "bad" : undefined)),
    };
    const openActions = actions.filter((a) => a.status !== "Closed");
    const overdue = openActions.filter((a) => a.status === "Overdue" || (a.due_date && String(a.due_date) < d.period.period_end)).length;
    const status = [
      `${d.period.label}: cut-off ${meta.cutOff}, ${meta.status === "Issued" ? "issued and locked" : "draft – figures may still change until the period is locked"}.`,
      movementOk ? `Period movement measured against ${prevLabel}.` : "No earlier issued report to measure the period movement against.",
      `Cost report: ${d.costReport.lines.length} cost lines across ${d.level1Matrix.columns.length} categories; ${dash.openChanges} open change items and ${dash.openEarlyWarnings} open early warnings feed columns H to L.`,
      `Claims, final accounts and bonds are taken from their stand-alone registers as at ${meta.generated}.`,
    ];
    push(
      compose({
        title: "Key Issues & Actions",
        subtitle: "Matters for the attention of the Programme Director",
        accent: nextAccent(),
        kpis: [
          { label: "Open actions", value: String(openActions.length), tone: openActions.length ? "info" : "good" },
          { label: "Overdue actions", value: String(overdue), tone: overdue ? "bad" : "good" },
          { label: "Open change items", value: String(dash.openChanges) },
          { label: "Open early warnings", value: String(dash.openEarlyWarnings) },
          { label: "Pending claims", value: String(dash.openClaims), tone: dash.openClaims ? "info" : "good" },
          { label: "Expired bonds (live contracts)", value: String(dash.bonds.expired), tone: dash.bonds.expired ? "bad" : "good" },
        ],
        stack: actions.length <= 4,
        blocks: [
          issues.length ? { kind: "bullets", title: "Key issues this period", items: issues, fontSize: 12, weight: 1 } : { kind: "bullets", title: "Report status", items: status, fontSize: 12, weight: 1 },
          { kind: "table", title: "Open actions from the commercial meetings", table: t, weight: actions.length <= 4 ? 0.25 + 0.2 * (actions.length + 1) : 1.3 },
        ],
      }),
    );
  }

  return { meta, slides };
}

function describeTopMovement(km: { col: string; label: string; kpiDelta: number }[]): string {
  const top = [...km].filter((k) => k.kpiDelta !== 0).sort((a, b) => Math.abs(b.kpiDelta) - Math.abs(a.kpiDelta))[0];
  if (!top) return "with no single driver";
  return `${top.label.toLowerCase()} (${top.kpiDelta > 0 ? "+" : ""}${money(top.kpiDelta)})`;
}
