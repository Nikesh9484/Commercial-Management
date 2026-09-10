"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ClipboardList,
  Calculator,
  GitBranch,
  Scale,
  AlertTriangle,
  PiggyBank,
  ShieldCheck,
  Receipt,
  TrendingUp,
  ArrowLeftRight,
  LayoutDashboard,
  FileDown,
  FileText,
  Settings,
  History,
  Upload,
  FolderDown,
  CalendarPlus,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { modules } from "@/lib/modules";
import { APP_SHORT, APP_SUBTITLE } from "@/lib/brand";
import type { Role } from "@/lib/registers/types";

const ICONS: Record<string, LucideIcon> = {
  ClipboardList,
  Calculator,
  GitBranch,
  Scale,
  AlertTriangle,
  PiggyBank,
  ShieldCheck,
  Receipt,
  TrendingUp,
  ArrowLeftRight,
  LayoutDashboard,
  FileDown,
};

export function Sidebar({ open, onClose, role }: { open: boolean; onClose: () => void; role: Role }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const isActive = (href: string) =>
    href.includes("?") ? pathname + "?" + search.toString() === href : href === "/" ? pathname === "/" || pathname === "/modules/executive-summary" : pathname === href || (pathname.startsWith(href + "/") && href !== "/") || (href === "/modules/cost-report" && pathname === href && !search.get("tab")) || (false && pathname.startsWith(href));

  const link = (href: string, label: string, Icon: LucideIcon, badge?: string) => (
    <Link
      key={href}
      href={href}
      onClick={onClose}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
        isActive(href) ? "bg-white/15 font-medium text-white" : "text-blue-100/80 hover:bg-white/10 hover:text-white"
      }`}
    >
      <Icon size={17} className="shrink-0" />
      <span className="truncate">{label}</span>
      {badge && <span className="ml-auto rounded bg-white/10 px-1.5 text-[10px] text-blue-100/70">{badge}</span>}
    </Link>
  );

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-navy-dark/60 lg:hidden" onClick={onClose} />}
      <aside
        className={`app-sidebar fixed inset-y-0 left-0 z-40 flex w-68 flex-col text-white transition-transform lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
          <Link href="/" className="flex items-center gap-2" onClick={onClose}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-sm font-bold">TM</span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-wide">{APP_SHORT}</span>
              <span className="block text-[11px] text-blue-100/80">{APP_SUBTITLE}</span>
            </span>
          </Link>
          <button className="rounded p-1 text-blue-100 hover:bg-white/10 lg:hidden" onClick={onClose} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {role === "reporter" ? (
            <>
              <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-blue-200/50">Reports</div>
              {link("/reports", "Reports & downloads", FolderDown)}
              <a href="/user-guide.pdf" target="_blank" rel="noopener" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-blue-100/80 hover:bg-white/10 hover:text-white">
                <FileText size={18} className="shrink-0" />
                <span className="truncate">User guide (PDF)</span>
              </a>
            </>
          ) : (
          <>
          <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-blue-200/50">Modules</div>
          {modules.map((m) => (
            <div key={m.slug}>
              {link(m.slug === "executive-summary" ? "/" : `/modules/${m.slug}`, m.short, ICONS[m.icon] ?? ClipboardList, String(m.no))}
              {m.slug === "executive-summary" && <div className="pl-4">{link("/modules/executive-summary/minutes", "Minutes of Meeting", FileText)}</div>}
              {m.slug === "invoices-payments" && <div className="pl-4">{link("/modules/final-accounts", "Final Account Status", FileText)}</div>}
              {m.slug === "monthly-report" && <div className="pl-4">{link("/modules/monthly-report/new", "New month (manual entry)", CalendarPlus)}</div>}
              {m.slug === "cost-report" && (
                <div className="pl-4">
                  {link("/modules/cost-report?tab=level1", "Level 1 – Executive", FileText)}
                  {link("/modules/cost-report?tab=level2", "Level 2 – Detailed", FileText)}
                  {link("/modules/cost-report?tab=setup", "Line setup", FileText)}
                </div>
              )}
            </div>
          ))}
          {role !== "viewer" && role !== "contributor" && (
            <>
              <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-blue-200/50">Stand-alone imports</div>
              {link("/imports/monthly", "Monthly report workbook", Upload)}
              {link("/imports/bonds", "Bonds & Insurance", Upload)}
              {link("/imports/payments", "Invoices & Payments", Upload)}
              {link("/imports/final-accounts", "Final Account Status", Upload)}
              {link("/imports/claims-tracker", "Claims Tracker", Upload)}
              <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-blue-200/50">Automation</div>
              {link("/automation/claim-ear", "Claim EAR", Wand2)}
            </>
          )}
          <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-blue-200/50">System</div>
          {link("/reports", "Reports & downloads", FolderDown)}
          <a href="/user-guide.pdf" target="_blank" rel="noopener" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-blue-100/80 hover:bg-white/10 hover:text-white">
            <FileText size={18} className="shrink-0" />
            <span className="truncate">User guide (PDF)</span>
          </a>
          {link("/activity", "Change history", History)}
          {link("/settings", role === "viewer" ? "Reference data" : "Settings", Settings)}
          </>
          )}
        </nav>
        <div className="border-t border-white/10 px-4 py-3 text-[11px] text-blue-200/50">All amounts in SAR · Dates DD-MMM-YY</div>
      </aside>
    </>
  );
}
