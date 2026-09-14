import type { ReportData } from "./data";
import type { RecordRow } from "../registers/types";
import { formatDate } from "../format";
import { NO_BONDS_FILTER, bondCategory, bondExpiryBucket, bondsFilterLabel, filterBonds, isFiltered, type BondsFilter } from "../bonds/filter";
import { num, numOrNull, txt, money, plural, list } from "./report-utils";

/** Executive Bonds & Insurance Status Report: cover held against requirement, expiry timeline, checks
 * outstanding, and what needs attention. Honours the filter chosen on the page (expiry window and
 * bond / insurance / other), so a download always matches what was on screen. */
export interface BondLine {
  ref: string;
  contractor: string;
  package: string;
  type: string;
  category: string;
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
  /** The filter the report was run with, in words – null when it covers the whole register. */
  filterLabel: string | null;
  headline: {
    total: number;
    active: number;
    expiring60: number;
    expiring30: number;
    expiring15: number;
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
  /** Every item the filter selected, earliest expiry first (printed when a filter is on). */
  rows: BondLine[];
  byType: { type: string; n: number; required: number; provided: number }[];
  byCategory: { category: string; n: number; required: number; provided: number }[];
}

const CATEGORY_LABEL: Record<string, string> = { bond: "Bond / guarantee", insurance: "Insurance policy", other: "Other" };

/** The status shown for a row, worked out the same way the register does – reports issued before the
 * status column existed do not carry it, so it is never read straight off the row. */
function statusOf(bucket: ReturnType<typeof bondExpiryBucket>, r: RecordRow): string {
  if (bucket === "closed") return r.superseded === true ? "Superseded" : "Released";
  if (bucket === "expired") return "Expired";
  if (bucket === "active") return "Active";
  return "Expiring";
}

export function buildBondsReport(data: ReportData, filter: BondsFilter = NO_BONDS_FILTER): BondsReport {
  const all = (data.registers.bonds?.rows ?? []) as RecordRow[];
  const src = filterBonds(all, filter);
  const asOf = data.period.period_end;
  const assetName = data.asset ? `${data.asset.code} ${data.asset.name}` : data.programme.name;
  const filterLabel = bondsFilterLabel(filter);
  const filtered = isFiltered(filter);

  const lines: BondLine[] = src.map((r) => {
    const bucket = bondExpiryBucket(r);
    return {
      ref: txt(r.ref),
      contractor: txt(r.contractor_id__label),
      package: txt(r.package_id__label),
      type: txt(r.type_id__label),
      category: CATEGORY_LABEL[bondCategory(r.type_id__label)],
      required: num(r.required_amount),
      provided: num(r.amount_provided),
      variance: num(r.variance),
      expiryDate: txt(r.expiry_date) || null,
      daysToExpiry: numOrNull(r.days_to_expiry),
      status: statusOf(bucket, r),
      approved: r.approved === true,
      bankVerified: r.bank_verification === true,
    };
  });
  const bucketOf = new Map(src.map((r, i) => [lines[i], bondExpiryBucket(r)]));
  const inBucket = (...b: string[]) => lines.filter((l) => b.includes(bucketOf.get(l) ?? ""));

  const expired = inBucket("expired");
  const released = lines.filter((l) => l.status === "Released");
  const superseded = lines.filter((l) => l.status === "Superseded");
  const expiring15 = inBucket("d15");
  const expiring30 = inBucket("d30");
  const expiring60 = inBucket("d60");
  const active = inBucket("active", "d15", "d30", "d60");
  const trackedForCover = lines.filter((l) => (bucketOf.get(l) ?? "") !== "closed");
  const required = Math.round(trackedForCover.reduce((t, l) => t + l.required, 0) * 100) / 100;
  const provided = Math.round(trackedForCover.reduce((t, l) => t + l.provided, 0) * 100) / 100;
  const shortfalls = trackedForCover.filter((l) => l.variance < -0.004);
  const shortfallValue = Math.round(shortfalls.reduce((t, l) => t + Math.abs(l.variance), 0) * 100) / 100;
  const notApproved = trackedForCover.filter((l) => !l.approved).length;
  const notVerified = trackedForCover.filter((l) => !l.bankVerified).length;

  const byExpiry = (a: BondLine, b: BondLine) => (a.daysToExpiry ?? Infinity) - (b.daysToExpiry ?? Infinity);
  const expiringSoon = [...expired, ...expiring15, ...expiring30, ...expiring60].sort(byExpiry);
  const rows = [...lines].sort(byExpiry);

  const group = <K extends string>(pick: (l: BondLine) => K) => {
    const m = new Map<K, { n: number; required: number; provided: number }>();
    for (const l of trackedForCover) {
      const k = pick(l);
      const b = m.get(k) ?? { n: 0, required: 0, provided: 0 };
      b.n++;
      b.required += l.required;
      b.provided += l.provided;
      m.set(k, b);
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, n: v.n, required: Math.round(v.required * 100) / 100, provided: Math.round(v.provided * 100) / 100 })).sort((a, b) => b.provided - a.provided);
  };
  const byType = group((l) => l.type).map((g) => ({ type: g.key, n: g.n, required: g.required, provided: g.provided }));
  const byCategory = group((l) => l.category).map((g) => ({ category: g.key, n: g.n, required: g.required, provided: g.provided }));

  const headline: BondsReport["headline"] = {
    total: lines.length,
    active: active.length,
    expiring60: expiring60.length,
    expiring30: expiring30.length,
    expiring15: expiring15.length,
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
  if (expiring15.length) attention.push(`${plural(expiring15.length, "bond / policy")} expiring within 15 days (${list(expiring15.map((l) => `${l.ref} (${l.daysToExpiry}d)`))}) – renewal is urgent.`);
  if (expiring30.length) attention.push(`${plural(expiring30.length, "bond / policy")} expiring within 30 days (${list(expiring30.map((l) => `${l.ref} (${l.daysToExpiry}d)`))}) – start the renewal now.`);
  if (shortfalls.length) attention.push(`${plural(shortfalls.length, "bond / policy")} below the contract requirement, ${money(shortfallValue)} short in total (${list(shortfalls.map((l) => l.ref))}).`);
  if (notApproved) attention.push(`${plural(notApproved, "bond / policy")} not yet approved.`);
  if (notVerified) attention.push(`${plural(notVerified, "bond / policy")} not yet bank-verified.`);

  const scope = filterLabel ? `${assetName}, filtered to ${filterLabel.toLowerCase()},` : assetName;
  const narrative: { heading: string; text: string }[] = [];
  narrative.push({
    heading: "Position at cut-off",
    text:
      lines.length === 0
        ? filtered
          ? `No bond or insurance policy matches ${filterLabel!.toLowerCase()} for ${assetName} as at ${formatDate(asOf)}.`
          : `No bonds or insurance policies are recorded against ${assetName} as at ${formatDate(asOf)}.`
        : `As at ${formatDate(asOf)}, ${plural(lines.length, "bond / insurance item")} ${lines.length === 1 ? "is" : "are"} ${filtered ? "selected by this filter" : "tracked"} against ${scope} ${expired.length} expired, ${expiring30.length + expiring15.length} expiring within 30 days, ${expiring60.length} expiring within 60 days, ${released.length} released and ${superseded.length} superseded. Cover held is ${money(provided)} against a requirement of ${money(required)}${shortfalls.length ? `, with ${plural(shortfalls.length, "item")} short by ${money(shortfallValue)} in total` : ", meeting or exceeding the requirement across the board"}.`,
  });
  if (mv?.previous && !filtered) {
    const n = grp ? grp.added.length + grp.changed.length + grp.removed.length : 0;
    narrative.push({ heading: `Movement since ${mv.previous.label}`, text: n === 0 ? `No movement in the bonds and insurance register since ${mv.previous.label}.` : `${grp!.added.length ? `${plural(grp!.added.length, "new item")} added. ` : ""}${grp!.changed.length ? `${plural(grp!.changed.length, "item")} changed. ` : ""}${grp!.removed.length ? `${plural(grp!.removed.length, "item")} removed. ` : ""}` });
  }
  narrative.push({
    heading: "Expiry and compliance",
    text: `${expiring15.length ? `${plural(expiring15.length, "item")} expires within 15 days and needs a renewal in hand now. ` : ""}${expiring30.length + expired.length ? `${plural(expiring30.length + expired.length, "item")} need action in the next 30 days (renewal or closure confirmation).` : "Nothing expires within 30 days."} ${notApproved || notVerified ? `${notApproved} item(s) await approval and ${notVerified} await bank verification.` : "All tracked items are approved and bank-verified."}`,
  });

  return {
    title: `Bonds & Insurance Status Report – ${data.period.label}${filterLabel ? ` (${filterLabel})` : ""}`,
    asOf,
    filterLabel,
    headline,
    narrative,
    movement,
    attention,
    expiring: expiringSoon,
    rows,
    byType,
    byCategory,
  };
}
