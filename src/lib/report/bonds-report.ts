import type { ReportData } from "./data";
import type { RecordRow } from "../registers/types";
import { formatDate } from "../format";
import { num, numOrNull, txt, money, plural, list } from "./report-utils";

/** Executive Bonds & Insurance Status Report: cover held against requirement, expiry timeline, checks
 * outstanding, and what needs attention. */
export interface BondLine {
  ref: string;
  contractor: string;
  package: string;
  type: string;
  required: number;
  provided: number;
  variance: number;
  expiryDate: string | null;
  daysToExpiry: number | null;
  status: string;
  approved: boolean;
  bankVerified: boolean;
}

export interface BondsReport {
  title: string;
  asOf: string;
  headline: {
    total: number;
    active: number;
    expiring60: number;
    expiring30: number;
    expired: number;
    released: number;
    superseded: number;
    required: number;
    provided: number;
    shortfallCount: number;
    shortfallValue: number;
    notApproved: number;
    notVerified: number;
  };
  narrative: { heading: string; text: string }[];
  movement: { label: string; items: string[] } | null;
  attention: string[];
  expiring: BondLine[];
  byType: { type: string; n: number; required: number; provided: number }[];
}

export function buildBondsReport(data: ReportData): BondsReport {
  const src = (data.registers.bonds?.rows ?? []) as RecordRow[];
  const asOf = data.period.period_end;
  const assetName = data.asset ? `${data.asset.code} ${data.asset.name}` : data.programme.name;

  const lines: BondLine[] = src.map((r) => ({
    ref: txt(r.ref),
    contractor: txt(r.contractor_id__label),
    package: txt(r.package_id__label),
    type: txt(r.type_id__label),
    required: num(r.required_amount),
    provided: num(r.amount_provided),
    variance: num(r.variance),
    expiryDate: txt(r.expiry_date) || null,
    daysToExpiry: numOrNull(r.days_to_expiry),
    status: txt(r.status) || "Active",
    approved: r.approved === true,
    bankVerified: r.bank_verification === true,
  }));

  const active = lines.filter((l) => l.status === "Active" || l.status === "Expiring");
  const expired = lines.filter((l) => l.status === "Expired");
  const released = lines.filter((l) => l.status === "Released");
  const superseded = lines.filter((l) => l.status === "Superseded");
  const expiring60 = active.filter((l) => l.daysToExpiry !== null && l.daysToExpiry <= 60 && l.daysToExpiry > 30);
  const expiring30 = active.filter((l) => l.daysToExpiry !== null && l.daysToExpiry <= 30);
  const trackedForCover = lines.filter((l) => l.status !== "Released" && l.status !== "Superseded");
  const required = Math.round(trackedForCover.reduce((t, l) => t + l.required, 0) * 100) / 100;
  const provided = Math.round(trackedForCover.reduce((t, l) => t + l.provided, 0) * 100) / 100;
  const shortfalls = trackedForCover.filter((l) => l.variance < -0.004);
  const shortfallValue = Math.round(shortfalls.reduce((t, l) => t + Math.abs(l.variance), 0) * 100) / 100;
  const notApproved = trackedForCover.filter((l) => !l.approved).length;
  const notVerified = trackedForCover.filter((l) => !l.bankVerified).length;

  const expiringSoon = [...expired, ...expiring30, ...expiring60].sort((a, b) => (a.daysToExpiry ?? -Infinity) - (b.daysToExpiry ?? -Infinity));

  const byTypeMap = new Map<string, { n: number; required: number; provided: number }>();
  for (const l of trackedForCover) {
    const b = byTypeMap.get(l.type) ?? { n: 0, required: 0, provided: 0 };
    b.n++;
    b.required += l.required;
    b.provided += l.provided;
    byTypeMap.set(l.type, b);
  }
  const byType = [...byTypeMap.entries()].map(([type, v]) => ({ type, n: v.n, required: Math.round(v.required * 100) / 100, provided: Math.round(v.provided * 100) / 100 })).sort((a, b) => b.provided - a.provided);

  const headline: BondsReport["headline"] = {
    total: lines.length,
    active: active.length,
    expiring60: expiring60.length,
    expiring30: expiring30.length,
    expired: expired.length,
    released: released.length,
    superseded: superseded.length,
    required,
    provided,
    shortfallCount: shortfalls.length,
    shortfallValue,
    notApproved,
    notVerified,
  };

  const mv = data.movement;
  const grp = mv?.groups.find((g) => g.key === "bonds");
  const movement = mv?.previous && grp ? { label: `Since ${mv.previous.label}`, items: [...grp.added.map((i) => `New: ${i.key} ${i.title}${i.amount ? ` (${money(i.amount)})` : ""}`), ...grp.changed.map((i) => `${i.key} ${i.title}: ${i.from} -> ${i.to}`), ...grp.removed.map((i) => `Removed: ${i.key} ${i.title}`)] } : null;

  const attention: string[] = [];
  if (expired.length) attention.push(`${plural(expired.length, "bond / policy")} already expired (${list(expired.map((l) => l.ref))}) – renew or confirm the contract is closed.`);
  if (expiring30.length) attention.push(`${plural(expiring30.length, "bond / policy")} expiring within 30 days (${list(expiring30.map((l) => `${l.ref} (${l.daysToExpiry}d)`))}) – start the renewal now.`);
  if (shortfalls.length) attention.push(`${plural(shortfalls.length, "bond / policy")} below the contract requirement, ${money(shortfallValue)} short in total (${list(shortfalls.map((l) => l.ref))}).`);
  if (notApproved) attention.push(`${plural(notApproved, "bond / policy")} not yet approved.`);
  if (notVerified) attention.push(`${plural(notVerified, "bond / policy")} not yet bank-verified.`);

  const narrative: { heading: string; text: string }[] = [];
  narrative.push({
    heading: "Position at cut-off",
    text:
      lines.length === 0
        ? `No bonds or insurance policies are recorded against ${assetName} as at ${formatDate(asOf)}.`
        : `As at ${formatDate(asOf)}, ${plural(lines.length, "bond / insurance item")} ${lines.length === 1 ? "is" : "are"} tracked against ${assetName}: ${active.length} active, ${expired.length} expired, ${released.length} released and ${superseded.length} superseded. Cover held is ${money(provided)} against a requirement of ${money(required)}${shortfalls.length ? `, with ${plural(shortfalls.length, "item")} short by ${money(shortfallValue)} in total` : ", meeting or exceeding the requirement across the board"}.`,
  });
  if (mv?.previous) {
    const n = grp ? grp.added.length + grp.changed.length + grp.removed.length : 0;
    narrative.push({ heading: `Movement since ${mv.previous.label}`, text: n === 0 ? `No movement in the bonds and insurance register since ${mv.previous.label}.` : `${grp!.added.length ? `${plural(grp!.added.length, "new item")} added. ` : ""}${grp!.changed.length ? `${plural(grp!.changed.length, "item")} changed. ` : ""}${grp!.removed.length ? `${plural(grp!.removed.length, "item")} removed. ` : ""}` });
  }
  narrative.push({
    heading: "Expiry and compliance",
    text: `${expiring30.length || expired.length ? `${plural(expiring30.length + expired.length, "item")} need action in the next 30 days (renewal or closure confirmation).` : "Nothing expires within 30 days."} ${notApproved || notVerified ? `${notApproved} item(s) await approval and ${notVerified} await bank verification.` : "All tracked items are approved and bank-verified."}`,
  });

  return { title: `Bonds & Insurance Status Report – ${data.period.label}`, asOf, headline, narrative, movement, attention, expiring: expiringSoon, byType };
}
