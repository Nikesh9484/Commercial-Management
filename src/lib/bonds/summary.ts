import type { RecordRow } from "../registers/types";
import { EXPIRY_AMBER_DAYS, EXPIRY_RED_DAYS } from "../registers/defs/bonds";

export interface ExpiringItem {
  id: number;
  ref: string;
  type: string;
  contractor: string;
  expiry_date: string;
  days: number;
  tone: "red" | "amber";
}

export interface BondsSummary {
  total: number;
  expired: number;
  /** Bonds / policies whose contract is closed – expiry no longer matters. */
  released: number;
  /** Older policies replaced by a newer one of the same type on the same contract. */
  superseded: number;
  red: number; // within 30 days
  amber: number; // 31–60 days
  shortfall: number;
  shortfallValue: number;
  notApproved: number;
  notVerified: number;
  provided: number;
  required: number;
  expiring: ExpiringItem[];
}

export function getBondsSummary(rows: RecordRow[]): BondsSummary {
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
  const expiring: ExpiringItem[] = [];
  let expired = 0;
  let red = 0;
  let amber = 0;
  let released = 0;
  let superseded = 0;
  for (const r of rows) {
    if (r.superseded === true) {
      superseded++;
      continue;
    }
    if (r.released === true) {
      released++;
      continue;
    }
    const d = r.days_to_expiry as number | null;
    if (d === null || d === undefined) continue;
    if (d < 0) expired++;
    else if (d <= EXPIRY_RED_DAYS) red++;
    else if (d <= EXPIRY_AMBER_DAYS) amber++;
    if (d <= EXPIRY_AMBER_DAYS) {
      expiring.push({
        id: r.id,
        ref: String(r.ref),
        type: String(r.type_id__label ?? ""),
        contractor: String(r.contractor_id__label ?? ""),
        expiry_date: String(r.expiry_date),
        days: d,
        tone: d <= EXPIRY_RED_DAYS ? "red" : "amber",
      });
    }
  }
  expiring.sort((a, b) => a.days - b.days);
  const short = rows.filter((r) => typeof r.variance === "number" && (r.variance as number) < -0.004);
  return {
    total: rows.length,
    expired,
    released,
    superseded,
    red,
    amber,
    shortfall: short.length,
    shortfallValue: short.reduce((t, r) => t + Math.abs(num(r.variance)), 0),
    notApproved: rows.filter((r) => r.approved !== true).length,
    notVerified: rows.filter((r) => r.bank_verification !== true).length,
    provided: rows.reduce((t, r) => t + num(r.amount_provided), 0),
    required: rows.reduce((t, r) => t + num(r.required_amount), 0),
    expiring,
  };
}
