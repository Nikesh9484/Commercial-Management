import { FilePlus2 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { AddFromDocuments } from "@/components/changes/AddFromDocuments";

export const metadata = { title: "Feed documents" };

/** One place to drop everything: each file is sorted to the register it belongs to. */
export default async function FeedDocumentsPage() {
  const user = (await getCurrentUser())!;
  const admin = user.role === "admin";
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Stand-alone imports" title="Feed documents" subtitle="Drop files or whole folders – RFCs, PVOs, EVOs, EIs, RFAs, DVOs, policies, certificates, guarantees, payment applications, IPC letters, payment certificates, with their Aconex transmittals. Each one is read, sorted and written to the register it belongs to." />
      <div className="card space-y-3 p-5 text-sm">
        <div className="flex items-start gap-3">
          <FilePlus2 size={20} className="mt-0.5 shrink-0 text-navy" />
          <div className="space-y-1">
            <div className="font-semibold text-ink">What goes where</div>
            <ul className="list-disc space-y-0.5 pl-5 text-muted">
              <li>
                <b>Change Management</b> – RFC, PVO, EVO, Employer&apos;s Instruction, RFA, DVO: the next CH number under this month&apos;s report{admin ? "" : " (added by an Admin)"}.
              </li>
              <li>
                <b>Bonds &amp; Insurance</b> – policy schedules, certificates of insurance, bank guarantees: the register row of that contractor and type, whatever report is selected.
              </li>
              <li>
                <b>Invoices &amp; Payments</b> – payment application transmittals, Interim Payment Certificate letters, payment certificate packs: the IPC log row of that contract and application.
              </li>
            </ul>
            <div className="text-muted">An entry already in a register is never written over quietly: the old and the new are shown side by side and you choose to replace or keep. Anything a file did not give is listed with the entry for you to add by hand.</div>
          </div>
        </div>
        <AddFromDocuments endpoint="/api/feed/from-documents" title="Feed documents" button="Upload files or a folder" intro="Any number of files, any file type – they are read, sorted and written to the right register." />
      </div>
    </div>
  );
}
