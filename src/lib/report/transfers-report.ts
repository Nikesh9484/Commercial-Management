import type { ReportData } from "./data";
import type { RecordRow } from "../registers/types";
import { formatDate } from "../format";
import { num, txt, money, plural, list, capMovement} from "./report-utils";

/** Executive Budget Transfers Status Report: what moved between packages, what is pending, and whether
 * column F of the cost report is in balance. */
export interface TransferLine {
  item: string;
  description: string;
  status: string;
  fromPackage: string;
  toPackage: string;
  amount: number;
  date: string | null;
  applied: string;
}

export interface TransfersReport {
  title: string;
  asOf: string;
  headline: {
    total: number;
    approved: number;
    pending: number;
    approvedAmount: number;
    pendingAmount: number;
    notApplied: number;
  };
  narrative: { heading: string; text: string }[];
  movement: { label: string; items: string[] } | null;
  attention: string[];
  rows: TransferLine[];
  byPackage: { package: string; out: number; in: number; net: number }[];
}

export function buildTransfersReport(data: ReportData): TransfersReport {
  const src = (data.registers.budget_transfers?.rows ?? []) as RecordRow[];
  const asOf = data.period.period_end;
  const assetName = data.asset ? `${data.asset.code} ${data.asset.name}` : data.programme.name;

  const rows: TransferLine[] = src.map((r) => ({
    item: txt(r.item),
    description: txt(r.description),
    status: txt(r.status),
    fromPackage: txt(r.from_package_id__label),
    toPackage: txt(r.to_package_id__label),
    amount: num(r.amount),
    date: txt(r.date) || null,
    applied: txt(r.applied) || "–",
  }));
  rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  const approvedRows = rows.filter((r) => r.status === "Approved");
  const pendingRows = rows.filter((r) => r.status === "Pending");
  const approvedAmount = Math.round(approvedRows.reduce((t, r) => t + r.amount, 0) * 100) / 100;
  const pendingAmount = Math.round(pendingRows.reduce((t, r) => t + r.amount, 0) * 100) / 100;
  const notApplied = approvedRows.filter((r) => !/^applied|^yes|^in cost report/i.test(r.applied) && r.applied !== "Applied").length;

  const byPkgMap = new Map<string, { out: number; in: number }>();
  for (const r of approvedRows) {
    const from = byPkgMap.get(r.fromPackage) ?? { out: 0, in: 0 };
    from.out += r.amount;
    byPkgMap.set(r.fromPackage, from);
    const to = byPkgMap.get(r.toPackage) ?? { out: 0, in: 0 };
    to.in += r.amount;
    byPkgMap.set(r.toPackage, to);
  }
  const byPackage = [...byPkgMap.entries()].map(([pkg, v]) => ({ package: pkg, out: Math.round(v.out * 100) / 100, in: Math.round(v.in * 100) / 100, net: Math.round((v.in - v.out) * 100) / 100 })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  const headline: TransfersReport["headline"] = {
    total: rows.length,
    approved: approvedRows.length,
    pending: pendingRows.length,
    approvedAmount,
    pendingAmount,
    notApplied,
  };

  const mv = data.movement;
  const grp = mv?.groups.find((g) => g.key === "budget_transfers");
  const movement = mv?.previous && grp ? { label: `Since ${mv.previous.label}`, items: [...grp.added.map((i) => `New: ${i.key} ${i.title}${i.amount ? ` (${money(i.amount)})` : ""}`), ...grp.changed.map((i) => `${i.key} ${i.title}: ${i.from} -> ${i.to}`), ...grp.removed.map((i) => `Removed: ${i.key} ${i.title}`)] } : null;

  const attention: string[] = [];
  if (pendingRows.length) attention.push(`${plural(pendingRows.length, "transfer")} pending approval, ${money(pendingAmount)} not yet reflected in the cost report (${list(pendingRows.map((r) => r.item))}).`);
  if (notApplied) attention.push(`${plural(notApplied, "approved transfer")} is not applied to the cost report – check the From / To cost line is set.`);
  const netsToZero = Math.abs(byPackage.reduce((t, p) => t + p.net, 0)) < 0.01;
  if (!netsToZero) attention.push("Approved transfers do not net to zero across packages – a From or To cost line may be missing on one or more transfers.");

  const narrative: { heading: string; text: string }[] = [];
  narrative.push({
    heading: "Position at cut-off",
    text:
      rows.length === 0
        ? `No budget transfers are recorded against ${assetName} as at ${formatDate(asOf)}.`
        : `As at ${formatDate(asOf)}, ${plural(rows.length, "budget transfer")} ${rows.length === 1 ? "is" : "are"} recorded against ${assetName}: ${approvedRows.length} approved, moving ${money(approvedAmount)} between packages, and ${pendingRows.length} pending approval worth ${money(pendingAmount)}.`,
  });
  if (mv?.previous) {
    const n = grp ? grp.added.length + grp.changed.length + grp.removed.length : 0;
    narrative.push({ heading: `Movement since ${mv.previous.label}`, text: n === 0 ? `No movement in the budget transfers register since ${mv.previous.label}.` : `${grp!.added.length ? `${plural(grp!.added.length, "new transfer")} raised. ` : ""}${grp!.changed.length ? `${plural(grp!.changed.length, "transfer")} changed status. ` : ""}${grp!.removed.length ? `${plural(grp!.removed.length, "transfer")} removed. ` : ""}` });
  }
  narrative.push({
    heading: "Cost report reconciliation",
    text: `${netsToZero ? "Approved transfers net to zero across packages, so column F is in balance." : "Approved transfers do not currently net to zero – reconcile the From and To cost lines before relying on column F."}${notApplied ? ` ${plural(notApplied, "approved transfer")} still needs its cost line set before it reaches the cost report.` : ""}`,
  });

  return { title: `Budget Transfers Status Report – ${data.period.label}`, asOf, headline, narrative, movement: capMovement(movement), attention, rows, byPackage };
}
