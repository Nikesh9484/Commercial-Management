import type { ReportData } from "./data";
import type { RecordRow } from "../registers/types";
import { formatMoney, formatDate } from "../format";

/**
 * Executive Final Account Status Report: one row per contract with committed cost, anticipated final
 * account and closure status, plus a short narrative written from the data.
 */
export interface FaLine {
  acc_ref: string;
  description: string;
  contractor: string;
  type: string;
  committed: number;
  afa: number;
  uncommitted: number;
  responsible: string;
  forecast: string | null;
  daysRemaining: number | null;
  status: string;
  closedDate: string | null;
  comments: string;
}

export interface FaReport {
  title: string;
  asOf: string;
  headline: {
    total: number;
    open: number;
    closed: number;
    notRequired: number;
    openValue: number;
    closedValue: number;
    notRequiredValue: number;
    totalAfa: number;
    overdue: number;
    dueSoon: number;
    noDate: number;
    uncommittedOpen: number;
  };
  narrative: { heading: string; text: string }[];
  movement: { label: string; items: string[] } | null;
  attention: string[];
  rows: FaLine[];
  byStatus: { status: string; count: number; afa: number }[];
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const money = (n: number) => `SAR ${formatMoney(n)}`;
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;
const list = (items: string[], max = 4) => (items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} and ${items.length - max} more`);
const NOT_REQ = ["Not Required", "Direct Payment – No FA"];

export function buildFaReport(data: ReportData): FaReport {
  const src = data.registers.final_accounts?.rows ?? [];
  const asOf = data.period.period_end;
  const assetName = data.asset ? `${data.asset.code} ${data.asset.name}` : data.programme.name;

  const rows: FaLine[] = src.map((r: RecordRow) => ({
    acc_ref: String(r.acc_ref ?? ""),
    description: String(r.description ?? ""),
    contractor: String(r.contractor_id__label ?? ""),
    type: String(r.type ?? ""),
    committed: num(r.committed),
    afa: num(r.afa),
    uncommitted: num(r.uncommitted),
    responsible: String(r.responsible ?? ""),
    forecast: (r.forecast_closure_date as string | null) ?? null,
    daysRemaining: r.days_remaining === null || r.days_remaining === undefined ? null : Number(r.days_remaining),
    status: String(r.status ?? ""),
    closedDate: (r.closed_date as string | null) ?? null,
    comments: String(r.comments ?? ""),
  }));
  const order: Record<string, number> = { Open: 0, Closed: 1 };
  rows.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999) || b.afa - a.afa);

  const open = rows.filter((r) => r.status === "Open");
  const closed = rows.filter((r) => r.status === "Closed");
  const notReq = rows.filter((r) => NOT_REQ.includes(r.status));
  const sum = (xs: FaLine[]) => xs.reduce((t, r) => t + r.afa, 0);
  const overdue = open.filter((r) => r.daysRemaining !== null && r.daysRemaining < 0);
  const dueSoon = open.filter((r) => r.daysRemaining !== null && r.daysRemaining >= 0 && r.daysRemaining <= 60);
  const noDate = open.filter((r) => !r.forecast);
  const uncommittedOpen = open.reduce((t, r) => t + r.uncommitted, 0);
  const byStatusMap = new Map<string, { status: string; count: number; afa: number }>();
  for (const r of rows) {
    const s = byStatusMap.get(r.status) ?? { status: r.status, count: 0, afa: 0 };
    s.count++;
    s.afa += r.afa;
    byStatusMap.set(r.status, s);
  }

  const mv = data.movement;
  const grp = mv?.groups.find((g) => g.key === "final_accounts");
  const movement = mv?.previous && grp
    ? {
        label: `Since ${mv.previous.label}`,
        items: [
          ...grp.added.map((i) => `New: ${i.key} ${i.title} (${i.to})`),
          ...grp.changed.map((i) => (i.from === i.to ? `${i.key} ${i.title}: anticipated final account ${i.delta && i.delta > 0 ? "+" : ""}${formatMoney(i.delta ?? 0)} (still ${i.to})` : `${i.key} ${i.title}: ${i.from} -> ${i.to}${i.delta ? ` (AFA ${i.delta > 0 ? "+" : ""}${formatMoney(i.delta)})` : ""}`)),
          ...grp.removed.map((i) => `Removed: ${i.key} ${i.title}`),
        ],
      }
    : null;
  const closedThisPeriod = grp ? grp.changed.filter((i) => i.to === "Closed" && i.from !== "Closed").length : 0;

  const attention: string[] = [];
  if (overdue.length) attention.push(`${plural(overdue.length, "final account")} past the forecast closure date (${list(overdue.map((r) => `${r.acc_ref} ${r.contractor}`.trim()))}) – revise the forecast or escalate the closure.`);
  if (dueSoon.length) attention.push(`${plural(dueSoon.length, "final account")} due to close within 60 days (${list(dueSoon.map((r) => r.acc_ref))}) – final account statements should be in preparation.`);
  if (noDate.length) attention.push(`${plural(noDate.length, "open final account")} without a forecast closure date (${list(noDate.map((r) => r.acc_ref))}) – a date is needed for the closure programme.`);
  const bigUncommitted = open.filter((r) => r.uncommitted > 0).sort((a, b) => b.uncommitted - a.uncommitted).slice(0, 3);
  if (bigUncommitted.length) attention.push(`Largest uncommitted balances still to be agreed: ${bigUncommitted.map((r) => `${r.acc_ref} ${money(r.uncommitted)}`).join("; ")}.`);
  const noResp = open.filter((r) => !r.responsible);
  if (noResp.length) attention.push(`${plural(noResp.length, "open final account")} with no responsible person assigned.`);

  const narrative: { heading: string; text: string }[] = [];
  narrative.push({
    heading: "Position at cut-off",
    text:
      rows.length === 0
        ? `No final accounts are recorded against ${assetName} as at ${formatDate(asOf)}.`
        : `As at ${formatDate(asOf)}, ${plural(rows.length, "contract package")} ${rows.length === 1 ? "is" : "are"} tracked for final account on ${assetName}: ${open.length} open (${money(sum(open))} anticipated final account), ${closed.length} closed with the final account statement signed (${money(sum(closed))}) and ${notReq.length} not requiring a final account or paid directly (${money(sum(notReq))}). The anticipated final account across all packages is ${money(sum(rows))}, of which ${money(uncommittedOpen)} on the open packages is not yet committed and remains to be agreed.`,
  });
  if (mv?.previous) {
    const n = grp ? grp.added.length + grp.changed.length + grp.removed.length : 0;
    narrative.push({
      heading: `Movement since ${mv.previous.label}`,
      text:
        n === 0
          ? `There has been no change to the final account status since ${mv.previous.label}.`
          : `${closedThisPeriod ? `${plural(closedThisPeriod, "final account")} ${closedThisPeriod === 1 ? "was" : "were"} closed during the period. ` : ""}${grp!.added.length ? `${plural(grp!.added.length, "package")} ${grp!.added.length === 1 ? "was" : "were"} added to the tracker (${list(grp!.added.map((i) => i.key))}). ` : ""}${grp!.changed.length ? `${plural(grp!.changed.length, "package")} changed status or anticipated final account (${list(grp!.changed.map((i) => i.key))}). ` : ""}${grp!.removed.length ? `${plural(grp!.removed.length, "package")} ${grp!.removed.length === 1 ? "was" : "were"} removed. ` : ""}The anticipated final account of the tracked packages moved by ${grp && Math.abs(grp.nowValue - grp.prevValue) >= 0.005 ? `${grp.nowValue - grp.prevValue > 0 ? "+" : ""}${formatMoney(grp.nowValue - grp.prevValue)}` : "nil"}.`,
    });
  }
  if (open.length) {
    const dated = open.filter((r) => r.forecast).sort((a, b) => String(a.forecast).localeCompare(String(b.forecast)));
    const next = dated.find((r) => String(r.forecast) >= asOf) ?? dated[0];
    narrative.push({
      heading: "Closure programme",
      text: `${overdue.length ? `${plural(overdue.length, "package")} ${overdue.length === 1 ? "is" : "are"} beyond the forecast closure date and ${overdue.length === 1 ? "needs" : "need"} a revised programme or escalation. ` : "No open package is beyond its forecast closure date. "}${dueSoon.length ? `${plural(dueSoon.length, "package")} ${dueSoon.length === 1 ? "is" : "are"} due within the next 60 days. ` : ""}${next ? `The next closure is forecast for ${formatDate(next.forecast!)} (${next.acc_ref} ${next.contractor}). ` : ""}${noDate.length ? `${plural(noDate.length, "open package")} ${noDate.length === 1 ? "has" : "have"} no forecast date yet.` : "Every open package has a forecast closure date."}`,
    });
  }
  narrative.push({
    heading: "Outlook and recommended actions",
    text:
      open.length === 0
        ? "All final accounts are closed or not required. No further action is needed beyond archiving the signed statements."
        : `The commercial team's priorities are to ${[
            overdue.length ? "close out the overdue final accounts and agree revised dates where the statement cannot be signed this period" : "",
            dueSoon.length ? "prepare and issue the final account statements falling due in the next 60 days" : "",
            uncommittedOpen > 0 ? `agree the ${money(uncommittedOpen)} of uncommitted value through the change and claims processes so it can be committed before closure` : "",
            noDate.length ? "set a forecast closure date for every open package" : "",
          ]
            .filter(Boolean)
            .join(", ")}. Signed final account statements release the retention and bonds held for each package.`,
  });

  return {
    title: `Final Account Status Report – ${data.period.label}`,
    asOf,
    headline: {
      total: rows.length,
      open: open.length,
      closed: closed.length,
      notRequired: notReq.length,
      openValue: sum(open),
      closedValue: sum(closed),
      notRequiredValue: sum(notReq),
      totalAfa: sum(rows),
      overdue: overdue.length,
      dueSoon: dueSoon.length,
      noDate: noDate.length,
      uncommittedOpen,
    },
    narrative,
    movement,
    attention,
    rows,
    byStatus: [...byStatusMap.values()],
  };
}
