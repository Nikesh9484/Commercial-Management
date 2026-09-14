import type { RecordRow } from "../registers/types";
import { EXPIRY_AMBER_DAYS, EXPIRY_RED_DAYS } from "../registers/defs/bonds";

/**
 * The filter behind the Bonds & Insurance page and its PDF / Excel reports: which expiry bucket, and
 * whether to look at bonds, insurance policies or everything. Kept free of any database import so the
 * page can run it in the browser and the export route can run the very same rules on the server.
 */

export type BondsExpiry = "all" | "expired" | "d15" | "d30" | "d60" | "action" | "active" | "closed";
export type BondsCategory = "all" | "bond" | "insurance" | "other";

export interface BondsFilter {
  expiry: BondsExpiry;
  category: BondsCategory;
  /** One contractor by name, or "" for every contractor. The name is matched, not the id, so the
   *  filter survives into a stored report that carries the label rather than the lookup. */
  contractor: string;
}

export const NO_BONDS_FILTER: BondsFilter = { expiry: "all", category: "all", contractor: "" };

export const EXPIRY_OPTIONS: { value: BondsExpiry; label: string; help: string }[] = [
  { value: "all", label: "All", help: "Every bond and policy on the register." },
  { value: "action", label: "Expired or within 30 days", help: "The chase list: already expired, or expiring in the next 30 days." },
  { value: "expired", label: "Expired", help: "Past its expiry date and the contract is still live." },
  { value: "d15", label: "Expiring within 15 days", help: "Expires in the next 15 days (not yet expired)." },
  { value: "d30", label: "Expiring within 30 days", help: "Expires in the next 30 days (not yet expired)." },
  { value: "d60", label: "Expiring within 60 days", help: "Expires in the next 60 days (not yet expired)." },
  { value: "active", label: "Active (over 60 days)", help: "In force with more than 60 days to run, or with no expiry date." },
  { value: "closed", label: "Released or superseded", help: "Contract closed, or replaced by a newer policy of the same type." },
];

export const CATEGORY_OPTIONS: { value: BondsCategory; label: string; help: string }[] = [
  { value: "all", label: "Bonds & insurance", help: "Everything on the register." },
  { value: "bond", label: "Bonds only", help: "Performance, advance payment, retention and other bonds / guarantees." },
  { value: "insurance", label: "Insurance only", help: "Indemnity, liability, all-risks, compensation and other policies." },
  { value: "other", label: "Other", help: "Anything that is neither a bond nor an insurance policy (a trade licence, for example)." },
];

const BOND_RE = /\bbond\b|guarantee|\bbg\b/i;
const INSURANCE_RE = /insur|indemnit|liabilit|all risk|compensat|marine|hull|motor|plant|equipment|polic|cover|gosi/i;

/** Bond, insurance policy, or neither – read from the type label ("Performance Bond", "Marine & Hull"). */
export function bondCategory(typeLabel: unknown): Exclude<BondsCategory, "all"> {
  const t = String(typeLabel ?? "");
  if (BOND_RE.test(t)) return "bond";
  if (INSURANCE_RE.test(t)) return "insurance";
  return "other";
}

/**
 * Where a row sits on the expiry scale. Reads days_to_expiry and the released / superseded flags the
 * register adds, never the status text: reports issued before the status column existed do not carry it.
 */
export function bondExpiryBucket(row: RecordRow): "expired" | "d15" | "d30" | "d60" | "active" | "closed" {
  if (row.superseded === true || row.released === true || row.contract_closed === true) return "closed";
  const d = row.days_to_expiry;
  if (d === null || d === undefined || d === "") return "active";
  const days = Number(d);
  if (!Number.isFinite(days)) return "active";
  if (days < 0) return "expired";
  if (days <= 15) return "d15";
  if (days <= EXPIRY_RED_DAYS) return "d30";
  if (days <= EXPIRY_AMBER_DAYS) return "d60";
  return "active";
}

/** Does this bond / policy belong in the filtered view? */
export function matchesBondsFilter(row: RecordRow, filter: BondsFilter): boolean {
  if (filter.contractor && String(row.contractor_id__label ?? "") !== filter.contractor) return false;
  if (filter.category !== "all" && bondCategory(row.type_id__label) !== filter.category) return false;
  if (filter.expiry === "all") return true;
  const bucket = bondExpiryBucket(row);
  // the shorter windows are nested: within 15 days is also within 30 and within 60
  switch (filter.expiry) {
    case "expired":
      return bucket === "expired";
    case "d15":
      return bucket === "d15";
    case "d30":
      return bucket === "d15" || bucket === "d30";
    case "d60":
      return bucket === "d15" || bucket === "d30" || bucket === "d60";
    case "action":
      return bucket === "expired" || bucket === "d15" || bucket === "d30";
    case "active":
      return bucket === "active";
    case "closed":
      return bucket === "closed";
    default:
      return true;
  }
}

export function filterBonds(rows: RecordRow[], filter: BondsFilter): RecordRow[] {
  if (filter.expiry === "all" && filter.category === "all" && !filter.contractor) return rows;
  return rows.filter((r) => matchesBondsFilter(r, filter));
}

export function isFiltered(filter: BondsFilter): boolean {
  return filter.expiry !== "all" || filter.category !== "all" || !!filter.contractor;
}

/** "Expiring within 15 days · insurance only", or null when nothing is filtered. */
export function bondsFilterLabel(filter: BondsFilter): string | null {
  if (!isFiltered(filter)) return null;
  const parts: string[] = [];
  if (filter.expiry !== "all") parts.push(EXPIRY_OPTIONS.find((o) => o.value === filter.expiry)?.label ?? filter.expiry);
  if (filter.category !== "all") parts.push((CATEGORY_OPTIONS.find((o) => o.value === filter.category)?.label ?? filter.category).toLowerCase());
  if (filter.contractor) parts.push(filter.contractor);
  return parts.join(" · ");
}

/** A short, file-name-safe tag for the download ("Expired_bonds"). */
export function bondsFilterSlug(filter: BondsFilter): string {
  if (!isFiltered(filter)) return "";
  const tag = bondsFilterLabel(filter) ?? "";
  return tag.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const EXPIRY_VALUES = new Set(EXPIRY_OPTIONS.map((o) => o.value as string));
const CATEGORY_VALUES = new Set(CATEGORY_OPTIONS.map((o) => o.value as string));

/** Reads the filter out of the export URL (?bondsExpiry=d15&bondsCategory=insurance). */
export function parseBondsFilter(params: URLSearchParams): BondsFilter {
  const expiry = params.get("bondsExpiry") ?? "";
  const category = params.get("bondsCategory") ?? "";
  return {
    expiry: EXPIRY_VALUES.has(expiry) ? (expiry as BondsExpiry) : "all",
    category: CATEGORY_VALUES.has(category) ? (category as BondsCategory) : "all",
    contractor: (params.get("bondsContractor") ?? "").slice(0, 200),
  };
}

/** The same filter as query-string pairs, for the page's download links. */
export function bondsFilterQuery(filter: BondsFilter): string {
  const p: string[] = [];
  if (filter.expiry !== "all") p.push(`bondsExpiry=${filter.expiry}`);
  if (filter.category !== "all") p.push(`bondsCategory=${filter.category}`);
  if (filter.contractor) p.push(`bondsContractor=${encodeURIComponent(filter.contractor)}`);
  return p.join("&");
}
