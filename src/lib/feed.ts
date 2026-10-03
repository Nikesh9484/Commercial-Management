import { positioned } from "./packs/extract";
import { classifyDoc } from "./packs/extract";
import { convertToPdf, convertible } from "./packs/convert";
import { addChangesFromDocuments } from "./changes/from-docs";
import { addBondsFromDocuments } from "./bonds/from-docs";
import { addPaymentsFromDocuments } from "./payments/from-docs";
import { addLeasesFromDocuments } from "./leases/from-docs";
import type { Decisions, FromDocsResult } from "./from-docs-shared";
import type { UserInfo } from "./registers/types";

/**
 * One drop for everything: every file (or folder) is read far enough to tell what it is – a change
 * document, a bond or insurance, a payment application or certificate, or the Aconex transmittal of
 * one of those – and handed to the register it belongs to. The answers come back together, one list
 * per register; duplicates wait for their replace / keep decision as everywhere else.
 */

export interface DocFile {
  name: string;
  bytes: Buffer;
}
type Lane = "changes" | "bonds" | "payments" | "leases" | "other";
const LANE_LABEL: Record<Lane, string> = { changes: "Change Management", bonds: "Bonds & Insurance", payments: "Invoices & Payments", leases: "Accommodation leases", other: "not sorted" };

async function laneOf(f: DocFile): Promise<{ lane: Lane; why: string }> {
  const isPdf = f.bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  let pdf = isPdf ? f.bytes : null;
  if (!pdf && convertible(f.name)) {
    try {
      pdf = (await convertToPdf(f.bytes, f.name))?.pdf ?? null;
    } catch {
      pdf = null;
    }
  }
  if (!pdf) return { lane: "other", why: "not a document that can be read (a picture or an unsupported file)" };
  const pages = await positioned(pdf);
  const text = pages
    .slice(0, 4)
    .map((p) => p.rows.map((r) => r.cells.map((c) => c.s).join(" ")).join("\n"))
    .join("\n");
  const name = f.name;
  const head = text.slice(0, 8000);
  // the Aconex code in the file name says what the document is; then the mail's subject; then the text itself
  const isMail = /MAIL TYPE/i.test(head.slice(0, 1500)) && /\bTransmittal\b/i.test(head.slice(0, 1500));
  const subject = isMail ? head.slice(0, 2000) : head.slice(0, 1500);
  const PAY = /Interim Payment|Payment Application|Payment Certificate|\bIPA\b|\bIPC\b|Proposes to pay|Recommendation No\.|Payment Recommendation/i;
  const BOND = /CERTIFICATE OF INSURANCE|POLICY\s*(NUMBER|NO|SCHEDULE)|RENEWAL SCHEDULE|BANK GUARANTEE|PERFORMANCE (BOND|GUARANTEE)|ADVANCE PAYMENT (BOND|GUARANTEE)|INSURANCE|WORKMEN|INDEMNITY|LIABILITY POLICY|\bPOLICY\b/i;
  const CHANGE = /Emergency Variation Order|Request for Change|Change Decision Pack|Proposed Variation Order|Determined Variation Order|Employer.?s Instruction|Request for Approval|\b(RFC|PVO|DVO|EVO|EI|RFA)\b/i;
  const LEASE = /ACCOMMODATION\s*LEASE\s*AGREEMENT|LEASE\s*AGREEMENT/i;
  if (LEASE.test(head.slice(0, 3000))) return { lane: "leases", why: /AMENDMENT\s*No/i.test(head.slice(0, 1500)) ? "lease agreement amendment" : "accommodation lease agreement" };
  if (/-(PAY|INV|IPA|IPC|PC)-/i.test(name)) return { lane: "payments", why: "payment document (file code)" };
  if (/-(INS|BND|BOND|INSC|GTE)-/i.test(name)) return { lane: "bonds", why: "bond / insurance (file code)" };
  if (/-(RFC|CRF|PVO|DVO|EVO|EMI|EI|RFA|VOR)-/i.test(name)) return { lane: "changes", why: "change document (file code)" };
  if (PAY.test(subject)) return { lane: "payments", why: "payment application / certificate" };
  if (BOND.test(subject)) return { lane: "bonds", why: "bond / insurance" };
  const kind = classifyDoc(pages, "");
  if (["rfc", "pvo", "dvo", "rfa", "ei"].includes(kind) || CHANGE.test(subject)) return { lane: "changes", why: "change document" };
  if (PAY.test(head)) return { lane: "payments", why: "payment application / certificate" };
  if (BOND.test(head)) return { lane: "bonds", why: "bond / insurance" };
  if (CHANGE.test(head)) return { lane: "changes", why: "change document" };
  return { lane: "other", why: "not recognised as a change, bond / insurance or payment document" };
}

export async function feedDocuments(files: DocFile[], user: UserInfo, decisions: Decisions = {}): Promise<FromDocsResult> {
  const out: FromDocsResult = { entries: [], duplicates: [], needsDecision: false, files: [], periods: [], warnings: [] };
  const lanes: Record<Lane, DocFile[]> = { changes: [], bonds: [], payments: [], leases: [], other: [] };
  for (const f of files) {
    try {
      const { lane, why } = await laneOf(f);
      lanes[lane].push(f);
      if (lane === "other") out.files.push({ name: f.name, kind: "other", note: `${why} – kept out` });
    } catch (e) {
      out.files.push({ name: f.name, kind: "error", note: `could not be read: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` });
    }
  }
  const merge = (lane: Lane, r: FromDocsResult) => {
    out.entries.push(...r.entries.map((e) => ({ ...e, register: LANE_LABEL[lane] })));
    out.duplicates.push(...r.duplicates.map((d) => ({ ...d, register: LANE_LABEL[lane] })));
    out.files.push(...r.files.map((f) => ({ ...f, note: `${LANE_LABEL[lane]}: ${f.note}` })));
    out.periods.push(...r.periods);
    out.warnings.push(...r.warnings);
    if (r.needsDecision) out.needsDecision = true;
  };
  // every lane is read; one lane's duplicate never stops another lane's entries
  if (lanes.changes.length) {
    if (user.role === "admin") merge("changes", await addChangesFromDocuments(lanes.changes, user, decisions));
    else {
      out.warnings.push(`${lanes.changes.length} change document(s) were kept out: new change entries are added by an Admin.`);
      for (const f of lanes.changes) out.files.push({ name: f.name, kind: "change", note: "Change Management: an Admin adds change entries – kept out" });
    }
  }
  if (lanes.bonds.length) merge("bonds", await addBondsFromDocuments(lanes.bonds, user, decisions));
  if (lanes.payments.length) merge("payments", await addPaymentsFromDocuments(lanes.payments, user, decisions));
  if (lanes.leases.length) merge("leases", await addLeasesFromDocuments(lanes.leases, user, decisions));
  return out;
}
