/**
 * The order of the monthly report. Change the letters / titles here to match the workbook.
 * `register` = a register whose table columns are printed; `special` = a custom section.
 */
export interface ScheduleDef {
  letter: string;
  title: string;
  moduleNo: number;
  register?: string | string[];
  special?: "cost_l1" | "cost_l2" | "cashflow";
}

export const REPORT_SCHEDULES: ScheduleDef[] = [
  { letter: "A", title: "Cost Report – Level 1 (Executive)", moduleNo: 2, special: "cost_l1" },
  { letter: "B", title: "Cost Report – Level 2 (Detailed)", moduleNo: 2, special: "cost_l2" },
  { letter: "C", title: "Change Management Tracker", moduleNo: 3, register: "changes" },
  { letter: "D", title: "Early Warnings & Risks / Opportunities", moduleNo: 5, register: ["early_warnings", "risks"] },
  { letter: "E", title: "Claims & Disputes", moduleNo: 4, register: "claims" },
  { letter: "F", title: "Provisional Sums", moduleNo: 6, register: "provisional_sums" },
  { letter: "G", title: "Bonds & Insurance", moduleNo: 7, register: "bonds" },
  { letter: "H", title: "Invoice & Payment Tracking and Final Account Status", moduleNo: 8, register: ["contracts", "payment_applications", "final_accounts"] },
  { letter: "I", title: "Cash Flow", moduleNo: 9, special: "cashflow" },
  { letter: "J", title: "Budget Transfers", moduleNo: 10, register: "budget_transfers" },
];
