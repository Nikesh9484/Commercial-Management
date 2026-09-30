/** Types and labels of the KPI feature that both the server and the browser use – nothing else imported here. */

export type KpiCategory = "closed" | "open";
export type KpiMovement = "new" | "closed_now" | "updated" | "unchanged";

export interface KpiItem {
  changeId: number;
  itemNo: string;
  description: string;
  category: KpiCategory;
  /** the head office register columns */
  program: string;
  projectName: string;
  assetCode: string;
  accContractRef: string;
  reefPo: string;
  vendor: string;
  vendorType: string;
  instructionRef: string;
  instructionDate: string | null;
  dvoRef: string;
  dvoDate: string | null;
  pvoValue: number | null;
  avvValue: number | null;
  daysToClose: number | null;
  dvoStatus: "APPROVED" | "PENDING";
  deadline: string | null;
  remainingDays: number | null;
  /** F1 – closed within the 90-day norm (approved items only) */
  f1: number | null;
  /** F2 – movement in value between PVO and DVO (approved items only) */
  f2: number | null;
  /** the change's own stage refs, for the pack cover and the file name */
  pvoRef: string;
  voRef: string;
  eiRef: string;
  rfcRef: string;
  pvoDate: string | null;
  voDate: string | null;
  overallStatus: string;
  /** since the previous report */
  movement: KpiMovement;
  movementNote: string;
  /** the previous report's figures, when it had the item */
  previous: { pvoValue: number | null; avvValue: number | null; dvoRef: string; instructionRef: string; category: KpiCategory | null } | null;
  /** the head office file name for the supporting documents, before any override */
  defaultFileName: string;
  /** short form of the vendor, as the packs are named (HOI, SPM, DEPA) */
  vendorShort: string;
}


export const MOVEMENT_LABEL: Record<KpiMovement, string> = { closed_now: "DVO approved this report", new: "New this report", updated: "Updated this report", unchanged: "No movement" };

/**
 * The five parts of a KPI supporting-document pack, in the order the head office reads them. A
 * Closed KPI (DVO approved) takes all five; an Open KPI (DVO still pending) the last three.
 */
export const KPI_SECTIONS = ["dvo_approval", "dvo_front", "pvo_vo_approval", "pvo_vo_front", "vo_issued"] as const;
export type KpiSection = (typeof KPI_SECTIONS)[number];
export const KPI_SECTION_LABEL: Record<KpiSection, string> = {
  dvo_approval: "DVO – Aconex approval",
  dvo_front: "DVO – front page",
  pvo_vo_approval: "PVO and VO – Aconex approval",
  pvo_vo_front: "PVO and VO – front pages",
  vo_issued: "VO issued – Aconex reference",
};
export const KPI_SECTION_HINT: Record<KpiSection, string> = {
  dvo_approval: "The Aconex workflow transmittal that approved the DVO, with its review history",
  dvo_front: "The signed Determination of Variation Order form – first page",
  pvo_vo_approval: "The Aconex workflow transmittal(s) that approved the PVO and the VO",
  pvo_vo_front: "The PVO form and the VO form – first pages",
  vo_issued: "The Aconex mail or letter that issued the VO to the contractor (its reference and date)",
};
/** The parts that apply to a category: no DVO parts while the DVO is still pending. */
export function kpiSectionsFor(category: "closed" | "open"): KpiSection[] {
  return category === "closed" ? [...KPI_SECTIONS] : KPI_SECTIONS.filter((s) => !s.startsWith("dvo_"));
}
export const KPI_SECTION_NO: Record<KpiSection, number> = { dvo_approval: 1, dvo_front: 2, pvo_vo_approval: 3, pvo_vo_front: 4, vo_issued: 5 };

export interface KpiDoc {
  id: number;
  change_id: number;
  section: KpiSection;
  name: string;
  rel_path: string;
  disk_path: string;
  size: number;
  mime: string;
  sort_order: number;
  /** pages in the file (PDF), 0 when unknown */
  page_count: number;
  /** the pages the pack takes – "1-3, 5"; blank means every page */
  pages: string;
  /** what each page was read as, in order (JSON array of page kinds) */
  page_kinds: string;
  created_at: string;
  created_by: string;
}

