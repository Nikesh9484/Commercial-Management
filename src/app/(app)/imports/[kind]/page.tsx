import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Lock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { listPeriods } from "@/lib/snapshots";
import { getRegisterDef } from "@/lib/registers";
import { IMPORTABLE } from "@/lib/workbook/analyze";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorkbookImporter, type StandaloneMode } from "@/components/workbook/WorkbookImporter";

/** The stand-alone import pages (left menu "Stand-alone imports"). "monthly" is the full monthly workbook. */
export const IMPORT_KINDS: Record<string, { title: string; subtitle: string; only?: string[]; exclude?: string[]; intro?: string; fileHint?: string; doneHref?: string; doneLabel?: string }> = {
  monthly: {
    title: "Import monthly workbook",
    subtitle: "Upload one of your Excel monthly reports and the app records it against a reporting period. Import past months in date order, locking each one, to build the history; then each new month shows its movement against the last. Claims & Disputes are not taken from the workbook: use Stand-alone imports → Claims Tracker.",
    exclude: ["claims"],
  },
  bonds: {
    title: "Import Bonds & Insurance",
    subtitle: "Update the bonds and insurance log of the current report from Excel.",
    only: ["bonds"],
    intro: "Upload your Schedule G (bonds & insurance) sheet, the Excel downloaded from the Bonds & Insurance page, or the whole monthly workbook – only the bonds sheet is used.",
    fileHint: "Schedule G / bonds export",
    doneHref: "/modules/bonds-insurance",
    doneLabel: "Open Bonds & Insurance",
  },
  payments: {
    title: "Import Invoices & Payments",
    subtitle: "Update the contracts and the IPC log of the current report from Excel.",
    only: ["contracts", "payment_applications"],
    intro: "Upload your Schedule H sheet and the per-contract IPC sheets, the Excel downloaded from Invoices & Payments, or the whole monthly workbook – only the contracts and IPC sheets are used.",
    fileHint: "Schedule H / IPC logs",
    doneHref: "/modules/invoices-payments",
    doneLabel: "Open Invoices & Payments",
  },
  "final-accounts": {
    title: "Import Final Account Status",
    subtitle: "Update the final account status of the current report from Excel.",
    only: ["final_accounts"],
    intro: "Upload your FA Status sheet, the Excel downloaded from the Final Account Status page, or the whole monthly workbook – only the final account sheet is used.",
    fileHint: "FA Status sheet",
    doneHref: "/modules/final-accounts",
    doneLabel: "Open Final Account Status",
  },
  "claims-tracker": {
    title: "Import Claims Tracker",
    subtitle: "Pick our claims out of the AMAALA Claims Tracker workbook and update Claims & Disputes for the current report.",
    only: ["claims"],
    intro: "Upload the Claims Tracker workbook (AMA-CM-FRM-0018, the file with the Program_01 sheet). Only the claims whose contract number or asset code belongs to the programme and asset in the top bar are kept; each is linked to our cost report line by its contract code (e.g. 1TB01031C02 → 031C02). Claims already in the dashboard are matched by their letter references and updated; the others are added as CT-###.",
    fileHint: "Claims Tracker (Program_01 sheet)",
    doneHref: "/modules/claims-disputes",
    doneLabel: "Open Claims & Disputes",
  },
};

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return { title: IMPORT_KINDS[kind]?.title ?? "Import" };
}

export default async function ImportPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ period?: string }> }) {
  const { kind } = await params;
  const { period: periodParam } = await searchParams;
  const initialPeriodId = Number(periodParam) || null;
  const spec = IMPORT_KINDS[kind];
  if (!spec) notFound();
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  const periods = listPeriods().map((p) => ({ id: p.id, label: p.label, status: p.status, report_no: p.report_no }));
  const registers = IMPORTABLE.filter((i) => (!spec.only || spec.only.includes(i.key)) && !spec.exclude?.includes(i.key)).map((i) => {
    const def = getRegisterDef(i.key)!;
    return {
      key: i.key,
      label: i.label,
      fields: def.fields
        .filter((f) => !f.virtual && !f.readonly && f.type !== "password" && f.key !== "programme_id")
        .map((f) => {
          const generic = /^(date|ref|status|cost \(sar\)|eot \(days\)|compensable days|amount|value|reference no|reference)$/i.test(f.label.trim()) || f.label.length <= 5;
          const section = f.section && f.section !== def.fields[0]?.section && !/details$/i.test(f.section) ? f.section : null;
          return { key: f.key, label: section && generic ? `${section} · ${f.label}` : f.label, required: f.required };
        }),
    };
  });
  const nextNo = (periods[0]?.report_no ?? 0) + 1;
  const current = ctx.period ? periods.find((p) => p.id === ctx.period!.id) ?? null : null;
  const standalone: StandaloneMode | undefined = spec.only && current ? { only: spec.only, period: { id: current.id, label: current.label }, intro: spec.intro ?? "", fileHint: spec.fileHint ?? "", doneHref: spec.doneHref ?? "/", doneLabel: spec.doneLabel ?? "Done" } : undefined;

  let blocker: React.ReactNode = null;
  if (!ctx.programme) blocker = <>Select a programme in the top bar first.</>;
  else if (user.role !== "admin" && user.role !== "editor") blocker = <>Only Editors and Admins can import.</>;
  else if (spec.only && !current) blocker = <>Choose a reporting period in the top bar first – the import updates that report only.</>;
  else if (spec.only && current && current.status === "Locked")
    blocker = (
      <>
        <b>{current.label}</b> is locked (issued). Stand-alone imports only update the report selected in the top bar, so switch to an open report – or ask an Admin to unlock this one – and try again.
      </>
    );

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Stand-alone imports" title={spec.title} subtitle={spec.subtitle} />
      {blocker ? (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          {spec.only && current?.status === "Locked" ? <Lock size={16} className="shrink-0" /> : <AlertTriangle size={16} className="shrink-0" />} <span>{blocker}</span>
        </div>
      ) : (
        <>
          {spec.only && current && (
            <div className="card flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-navy p-4 text-sm">
              <div>
                Updating <b>{current.label}</b> only (the report selected in the top bar). To update another month, change the period in the top bar first.
              </div>
              <Link href="/" className="text-xs text-accent hover:underline">
                Executive Summary
              </Link>
            </div>
          )}
          {initialPeriodId && periods.find((p) => p.id === initialPeriodId) && (
            <div className="card flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-navy p-4 text-sm">
              <div>
                Re-uploading <b>{periods.find((p) => p.id === initialPeriodId)!.label}</b> from the report library: the period is pre-selected below. Rows are matched by their references, so the report is refreshed, not duplicated.
              </div>
              <Link href="/modules/monthly-report/library" className="text-xs text-accent hover:underline">
                Back to the report library
              </Link>
            </div>
          )}
          <WorkbookImporter registers={registers} periods={periods} isAdmin={user.role === "admin"} defaultReportNo={nextNo} standalone={standalone} excludeRegisters={spec.exclude} initialPeriodId={initialPeriodId} />
        </>
      )}
    </div>
  );
}
