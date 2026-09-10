"use client";

import { useState } from "react";
import { Mail, Paperclip, Copy, Smartphone, Check, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

interface Summary {
  subject: string;
  to: string[];
  html: string;
  text: string;
  fileBase: string;
}

/**
 * "Email the Report": prepares a short summary of the month and hands it to the user's mail client.
 *  - Outlook (PC): downloads an .eml draft with the Executive Summary, Level 1 and Level 2 PDFs attached;
 *    opening the file shows the email ready to send.
 *  - Phone / other mail apps: opens a mailto: draft with the text summary (attachments cannot be added by a web page).
 *  - Copy: puts the formatted summary on the clipboard to paste into any email.
 */
export function EmailReportButton({ kind = "exec", label = "Email the Report", attachments = "Executive Summary.pdf · Cost Report Level 1.pdf · Cost Report Level 2.pdf", tone = "primary" }: { kind?: "exec" | "claims" | "final_accounts"; label?: string; attachments?: string; tone?: "primary" | "secondary" }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setOpen(true);
    setError(null);
    if (summary) return;
    try {
      const r = await fetch(`/api/email-report?format=json&kind=${kind}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not prepare the summary.");
      setSummary(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async () => {
    if (!summary) return;
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([summary.html], { type: "text/html" }), "text/plain": new Blob([summary.text], { type: "text/plain" }) })]);
      } else await navigator.clipboard.writeText(summary.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Copy failed – select the preview text and copy it manually.");
    }
  };

  const mailto = summary ? `mailto:${encodeURIComponent(summary.to.join(","))}?subject=${encodeURIComponent(summary.subject)}&body=${encodeURIComponent(summary.text.slice(0, 1800))}` : "#";

  return (
    <>
      <button type="button" className={`btn btn-${tone} btn-sm`} onClick={load} title={`Prepare a short summary email with the ${attachments.replace(/ · /g, ", ")} attached`}>
        <Mail size={14} /> {label}
      </button>
      <Modal open={open} title={label} onClose={() => setOpen(false)} size="lg"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={copy} disabled={!summary}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy summary"}
            </button>
            <a className={`btn btn-secondary btn-sm ${summary ? "" : "pointer-events-none opacity-50"}`} href={mailto} title="Opens your mail app with the text summary (no attachments)">
              <Smartphone size={14} /> Open mail app (text only)
            </a>
            <a className={`btn btn-primary btn-sm ${summary ? "" : "pointer-events-none opacity-50"}`} href={`/api/email-report?format=eml&kind=${kind}`} download title="Downloads an Outlook draft with the PDF(s) attached">
              <Paperclip size={14} /> Open in Outlook with PDFs attached
            </a>
          </>
        }
      >
        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {!summary && !error && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" /> Preparing the summary…
          </div>
        )}
        {summary && (
          <div className="space-y-3">
            <div className="rounded-xl border border-line bg-slate-50 p-3 text-xs text-ink">
              <div><span className="font-semibold text-muted">To:</span> {summary.to.length ? summary.to.join(", ") : <span className="text-muted">nobody yet – add email addresses to the distribution list under Project Setup, or type them in Outlook</span>}</div>
              <div className="mt-1"><span className="font-semibold text-muted">Subject:</span> {summary.subject}</div>
              <div className="mt-1"><span className="font-semibold text-muted">Attachments:</span> {attachments}</div>
            </div>
            <div className="rounded-xl border border-line bg-white p-4" dangerouslySetInnerHTML={{ __html: summary.html }} />
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
              <b>How it works.</b> <b>Open in Outlook</b> downloads a small draft file (.eml). Open the downloaded file and Outlook shows this email, with the PDF(s) attached, ready for you to check and press Send. On a phone use <b>Open mail app</b> (text only) or <b>Copy summary</b> and paste it into a new email, then attach the PDFs downloaded with the red PDF buttons.
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
