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

export const KPI_SECTIONS = ["DVO", "VO", "PVO", "RFC", "Correspondence"] as const;
export type KpiSection = (typeof KPI_SECTIONS)[number];
export const KPI_SECTION_LABEL: Record<KpiSection, string> = {
  DVO: "A. DVO – Determination of Variation Order",
  VO: "B. Instruction – Variation Order / Engineer's Instruction",
  PVO: "C. PVO – Proposed Variation Order",
  RFC: "D. RFC / CRF – Request for Change",
  Correspondence: "E. Correspondence and other supporting documents",
};

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
  created_at: string;
  created_by: string;
}

