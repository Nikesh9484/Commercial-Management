import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Lock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { listPeriods } from "@/lib/snapshots";
import { getRegisterDef } from "@/lib/registers";
import { IMPORTABLE } from "@/lib/workbook/analyze";
import { standaloneOnly } from "@/lib/workbook/import";
import { getDb } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorkbookImporter, type StandaloneMode } from "@/components/workbook/WorkbookImporter";

/** The stand-alone import pages (left menu "Stand-alone imports"). "monthly" is the full monthly workbook. */
export const IMPORT_KINDS: Record<string, { title: string; subtitle: string; only?: string[]; exclude?: string[]; intro?: string; fileHint?: string; doneHref?: string; doneLabel?: string; /** not part of any month's report: may be uploaded whatever report is selected, locked or not */ anyTime?: boolean }> = {
  monthly: {
    title: "Import monthly workbook",
    subtitle: "Upload one of your Excel monthly reports and the app records it against a reporting period. Each month is stored as its own report, so months can be loaded in any order and each one shows its movement against the last. Bonds & Insurance, Invoices & Payments and Final Account Status all come from this workbook – Schedule G, Schedule H with its IPC sheets, and the FA Status sheet – so one upload keeps the whole month in step. Claims & Disputes are the exception: they are never taken from the workbook, because they come from the AMAALA Claims Tracker, which is a different file.",
    exclude: ["claims", "bonds", "final_accounts"],
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
  accommodation: {
    title: "Import accommodation invoice tracker",
    subtitle: "Upload the AMAALA Construction Village lease-agreement invoice tracker whenever it changes – it is not part of the monthly report – and the Cost Recovery page shows what each of our contractors has been invoiced, has paid or had recovered through its IPCs, and still owes.",
    only: ["accommodation_recovery"],
    intro: "Upload the accommodation invoice tracker (the workbook with the \"L.A. Invoice Tracker (W)\" sheet, .xlsx or .xlsm). Only the lease agreements of the project in the top bar are kept – recognised by their asset code (1TB01031 …) or the program name on the row – and each is tied to our contractor by name. Rows already here are updated, so the tracker can be re-uploaded as often as it changes.",
    fileHint: "Accommodation invoice tracker (L.A. Invoice Tracker sheet)",
    doneHref: "/modules/cost-recovery",
    doneLabel: "Open Cost Recovery",
    anyTime: true,
  },
  customs: {
    title: "Import customs recovery tracker",
    subtitle: "Upload the AMAALA Customs Recovery Tracker whenever it changes – it is not part of the monthly report – and the Cost Recovery page shows the customs duties RSG paid on each contractor's imports and how they are being recovered.",
    only: ["customs_recovery"],
    intro: "Upload the customs recovery tracker (the workbook with the \"Summary-Site Team to Enter\" sheet). Only the contracts of the project in the top bar are kept – recognised by the asset code in the commercial lead's columns – together with the customs figures of vendors that are our contractors, each tied to its cost report line by contract code (031C13 → CN.031C13). Rows already here are updated on a re-upload.",
    fileHint: "AMAALA Customs Recovery Tracker (Summary sheet)",
    doneHref: "/modules/cost-recovery?tab=customs",
    doneLabel: "Open Cost Recovery",
    anyTime: true,
  },
  aconex: {
    title: "Import Aconex control account export",
    subtitle: "Upload the control-account export from Aconex for the project in the top bar (one file per project) and the Aconex Cost Check reconciles its budget, commitments, changes and estimate at completion against the dashboard's cost report, line by line.",
    only: ["aconex_control_accounts"],
    intro: "Upload the Aconex control-account export (the .csv file, or the same table saved as .xlsx). Only the rows of the project in the top bar are kept: one per contract (1TB01031.01.CN.031C15) and per budget hold (…PS.98), each tied to its cost report line by contract code. Rows already here are replaced by the new figures on a re-upload.",
    fileHint: "control-account-export.csv",
    doneHref: "/modules/aconex-check",
    doneLabel: "Open Aconex Cost Check",
    anyTime: true,
  },
};

/** Imports that have been folded into the monthly workbook. The URLs still answer, so an old link or
 *  bookmark explains where the import went rather than showing "not found". */
export const RETIRED_IMPORTS: Record<string, { title: string; was: string; sheet: string; href: string; label: string }> = {
  bonds: { title: "Bonds & Insurance", was: "the stand-alone bonds import", sheet: "Schedule G", href: "/modules/bonds-insurance", label: "Open Bonds & Insurance" },
  payments: { title: "Invoices & Payments", was: "the stand-alone payments import", sheet: "Schedule H and its per-contract IPC sheets", href: "/modules/invoices-payments", label: "Open Invoices & Payments" },
  "final-accounts": { title: "Final Account Status", was: "the stand-alone final-account import", sheet: "the FA Status sheet", href: "/modules/final-accounts", label: "Open Final Account Status" },
};

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return { title: IMPORT_KINDS[kind]?.title ?? RETIRED_IMPORTS[kind]?.title ?? "Import" };
}

export default async function ImportPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ period?: string }> }) {
  const { kind } = await params;
  const { period: periodParam } = await searchParams;
  const initialPeriodId = Number(periodParam) || null;
  const retired = RETIRED_IMPORTS[kind];
  if (retired) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Stand-alone imports" title={`${retired.title} now comes with the monthly report`} subtitle={`${retired.was} has been retired.`} />
        <div className="card space-y-3 p-5 text-sm">
          <p className="text-ink">
            {retired.title} is read straight out of the monthly report workbook – <b>{retired.sheet}</b> – for every project, so importing the month keeps it in step with the cost report instead of needing a second upload that could disagree with it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link className="btn btn-primary" href="/imports/monthly">
              Import the monthly workbook
            </Link>
            <Link className="btn btn-secondary" href={retired.href}>
              {retired.label}
            </Link>
          </div>
        </div>
      </div>
    );
  }
  const spec = IMPORT_KINDS[kind];
  if (!spec) notFound();
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  const periods = listPeriods().map((p) => ({ id: p.id, label: p.label, status: p.status, report_no: p.report_no }));
  // the monthly import leaves out the registers this project feeds only from stand-alone imports
  const exclude = spec.exclude ? standaloneOnly(getDb(), ctx.programme?.id ?? 0) : undefined;
  const registers = IMPORTABLE.filter((i) => (!spec.only || spec.only.includes(i.key)) && !exclude?.includes(i.key)).map((i) => {
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
  else if (spec.only && current && current.status === "Locked" && !spec.anyTime)
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
                {spec.anyTime ? (
                  <>
                    Updating the <b>{ctx.programme?.name}</b> rows of this tracker. The tracker is not part of a monthly report: upload it whenever it changes, whatever report is selected in the top bar.
                  </>
                ) : (
                  <>
                    Updating <b>{current.label}</b> only (the report selected in the top bar). To update another month, change the period in the top bar first.
                  </>
                )}
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
          <WorkbookImporter registers={registers} periods={periods} isAdmin={user.role === "admin"} defaultReportNo={nextNo} standalone={standalone} excludeRegisters={exclude} initialPeriodId={initialPeriodId} />
        </>
      )}
    </div>
  );
}
