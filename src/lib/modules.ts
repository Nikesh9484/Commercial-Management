/**
 * The 12 modules of the Commercial Dashboard. Drives the left menu and the placeholder pages.
 */
export interface ModuleInfo {
  no: number;
  slug: string;
  title: string;
  short: string;
  description: string;
  icon: string; // lucide icon name, resolved in the sidebar
}

export const modules: ModuleInfo[] = [
  { no: 1, slug: "project-setup", title: "Project Setup & Report Control", short: "Project Setup", icon: "ClipboardList", description: "Project particulars, contract details, key dates and control of the monthly reporting cycle." },
  { no: 2, slug: "cost-report", title: "Cost Report Level 1 & 2", short: "Cost Report", icon: "Calculator", description: "Budget, committed, forecast and variance by package (Level 1) and by cost element (Level 2)." },
  { no: 3, slug: "change-management", title: "Change Management Tracker", short: "Change Management", icon: "GitBranch", description: "Register of variations and change events with approval status, values and time impact." },
  { no: 4, slug: "claims-disputes", title: "Claims & Disputes", short: "Claims & Disputes", icon: "Scale", description: "Contractual claims, notices and disputes with claimed vs assessed values." },
  { no: 5, slug: "early-warnings", title: "Early Warnings & Risks / Opportunities", short: "Early Warnings & Risks", icon: "AlertTriangle", description: "Early warning notices plus the commercial risk and opportunity register." },
  { no: 6, slug: "provisional-sums", title: "Provisional Sums", short: "Provisional Sums", icon: "PiggyBank", description: "Provisional sum allowances, instructions issued and expenditure to date." },
  { no: 7, slug: "bonds-insurance", title: "Bonds & Insurance", short: "Bonds & Insurance", icon: "ShieldCheck", description: "Bonds and insurance policies with values, expiry dates and renewal status." },
  { no: 8, slug: "invoices-payments", title: "Invoice & Payment Tracking", short: "Invoices & Payments", icon: "Receipt", description: "Payment applications, certified amounts, retention and payment status per contractor." },
  { no: 9, slug: "cash-flow", title: "Cash Flow", short: "Cash Flow", icon: "TrendingUp", description: "Planned vs actual monthly cash flow and forecast to completion." },
  { no: 10, slug: "budget-transfers", title: "Budget Transfers", short: "Budget Transfers", icon: "ArrowLeftRight", description: "Movements of budget between packages / cost codes with approval trail." },
  { no: 11, slug: "executive-summary", title: "Executive Summary & Minutes of Meeting", short: "Executive Summary", icon: "LayoutDashboard", description: "Headline KPIs, key issues, open actions and charts for directors, plus minutes of commercial meetings." },
  { no: 12, slug: "monthly-report", title: "Monthly Report Export", short: "Monthly Report", icon: "FileDown", description: "Generate the monthly commercial report as PDF / Excel from the locked period." },
];

export function getModule(slug: string): ModuleInfo | undefined {
  return modules.find((m) => m.slug === slug);
}
