import type { ReportData } from "./data";
import type { EmailSummary } from "./email";
import type { RecordRow } from "../registers/types";
import { filterBonds, bondCategory, type BondsExpiry } from "../bonds/filter";
import { contractorKey } from "../bonds/name-key";
import { formatDate, formatMoney, todayIso } from "../format";
import { contractTermsFor, contractFrag, cite, under, citedList, type ContractTerms } from "../contracts/clauses";

/**
 * The notice emails of the Bonds & Insurance page – one per category (expired, expiring within 30
 * days, expiring within 60 days), for every contractor in it or for one contractor: each bond or
 * policy with its reference, type, policy number, issuer, contract, cover held against the contract
 * requirement, start and expiry dates, days expired or left, and what is asked for by when.
 */
export type BondsNoticeBucket = Extract<BondsExpiry, "expired" | "d30" | "d60">;

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const td = 'style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px;vertical-align:top"';
const tdr = 'style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px;text-align:right;font-family:Consolas,monospace;vertical-align:top"';
const th = 'style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px;background:#f3f5f8;text-align:left"';
const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const fileTag = (name: string) => name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
const plusDays = (iso: string, days: number) => {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const BUCKET_TEXT: Record<BondsNoticeBucket, { title: string; what: string; ask: string; replyDays: number }> = {
  expired: {
    title: "Expired bonds and insurance policies – replacement required",
    what: "has passed its expiry date while the Contract remains in force. The Contractor is in breach of its obligation to maintain the security / insurance for the duration of the Contract",
    ask: "a replacement or extension, effective from the original expiry date so that no gap in cover remains, issued in the Employer's favour on the Contract terms",
    replyDays: 7,
  },
  d30: {
    title: "Bonds and insurance policies expiring within 30 days – renewal required",
    what: "runs out within the next 30 days while the Contract remains in force",
    ask: "the renewal or extension, issued before the expiry date so that cover is continuous",
    replyDays: 7,
  },
  d60: {
    title: "Bonds and insurance policies expiring within 60 days – renewal to be arranged",
    what: "runs out within the next 60 days while the Contract remains in force",
    ask: "confirmation of the renewal arrangements, with the renewed instrument issued before the expiry date",
    replyDays: 14,
  },
};

interface Group {
  key: string;
  contractor: string;
  items: RecordRow[];
}

function groupByContractor(items: RecordRow[]): Group[] {
  const groups: Group[] = [];
  for (const r of items) {
    const name = String(r.contractor_id__label ?? "").trim();
    const key = contractorKey(name) || "__none__";
    const g = groups.find((x) => x.key === key);
    if (g) {
      g.items.push(r);
      if (name.length > g.contractor.length) g.contractor = name;
    } else groups.push({ key, contractor: name || "(no contractor on the row)", items: [r] });
  }
  return groups.sort((a, b) => b.items.length - a.items.length || a.contractor.localeCompare(b.contractor));
}

const kindOf = (r: RecordRow) => (bondCategory(r.type_id__label) === "bond" ? "bond / guarantee" : bondCategory(r.type_id__label) === "insurance" ? "insurance policy" : "instrument");
const addMonths = (iso: string, months: number, days = 0) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** the contract code behind a bond: its reference ("G-006C64-3"), else its cost report line */
const codeOf = (r: RecordRow) => contractFrag(r.ref) || contractFrag(r.cost_line_id__label) || contractFrag(r.package_id__label);

/** Where the contract's defects period ends for a contractor's contract, from the register's completion dates and the contract's own Defects Notification Period. */
function defectsDates(data: ReportData, code: string, terms: ContractTerms | null): { completion: string; dnpEnd: string; defectsCompletion: string } | null {
  const contracts = data.registers.contracts?.rows ?? [];
  const c = contracts.find((x) => contractFrag(x.acc_ref) === code);
  const completion = String(c?.revised_completion_date ?? "") || (c?.original_completion_date ? addMonths(String(c.original_completion_date), 0, Number(c.eot_granted_days ?? 0)) : "");
  const months = terms?.dnpMonths ?? null;
  if (!completion || !months) return null;
  const dnpEnd = addMonths(completion, months);
  return { completion, dnpEnd, defectsCompletion: addMonths(dnpEnd, 0, 14) };
}

/** What the contract says about how long each instrument must run – the sentence put under the contractor's table. */
function contractualPosition(code: string, terms: ContractTerms | null, dates: ReturnType<typeof defectsDates>): string[] {
  const out: string[] = [];
  if (!terms) {
    out.push(`The Performance Bond and the Professional Indemnity insurance are to remain valid until the end of the Defects Liability Period of the Contract, and every other insurance until the Performance Certificate is issued; please check the Contract's security and insurance clauses and the Particulars for the periods that apply.`);
    return out;
  }
  const perf = terms.refs.performance_security;
  if (perf || terms.perfBondUntil) {
    const dlpGloss = terms.perfBondUntil && /Performance Certificate|Defects Completion/i.test(terms.perfBondUntil) ? " – that is, to the end of the Defects Liability Period" : "";
    const untilText = terms.perfBondUntil ? `until ${terms.perfBondUntil}${dlpGloss}` : "until the end of the Defects Liability Period";
    out.push(`${perf ? cite(perf) : "The Contract"}${perf ? "" : ""}: the Performance Bond is to be kept in effect at all times ${untilText}${terms.bondExtensionBusinessDays ? `; where it would expire earlier, its validity is to be extended no later than ${terms.bondExtensionBusinessDays} Business Days before its expiry, to a date no earlier than the anticipated end of the defects period` : ""}.`);
  }
  const dnp = terms.refs.dnp;
  if (terms.dnpMonths) {
    out.push(`${dnp ? cite(dnp) : "The Particulars"}: the Defects Notification Period runs for ${terms.dnpMonths} months from taking over${dates ? ` – for Contract ${code}, completion on ${formatDate(dates.completion)} takes it to ${formatDate(dates.dnpEnd)}, so the Defects Completion Date falls on or about ${formatDate(dates.defectsCompletion)}` : ""}.`);
  }
  const ins = terms.refs.insurance_schedule ?? terms.refs.insurance;
  const bits: string[] = [];
  if (terms.insurancePeriod) bits.push(`every insurance is to be maintained from the Commencement Date until ${terms.insurancePeriod}`);
  if (terms.piYearsAfterCompletion) bits.push(`the Professional Indemnity insurance for the duration of the Works and ${terms.piYearsAfterCompletion} years after completion`);
  if (!bits.length) bits.push(`the insurances are to be maintained until the Performance Certificate is issued, the Professional Indemnity insurance throughout the Defects Liability Period and the period the Contract states thereafter`);
  out.push(`${ins ? cite(ins) : "The insurance schedule of the Contract"}: ${bits.join("; ")}.`);
  return out;
}

/** The contractors with something in a category – one notice each. */
export function bondsNoticeContractors(data: ReportData, bucket: BondsNoticeBucket): string[] {
  const rows = data.registers.bonds?.rows ?? [];
  return groupByContractor(filterBonds(rows, { expiry: bucket, category: "all", contractor: "" }))
    .filter((g) => g.key !== "__none__")
    .map((g) => g.contractor);
}

export function buildBondsNoticeEmail(data: ReportData, sender: { name: string; email?: string }, bucket: BondsNoticeBucket, contractor?: string | null): EmailSummary {
  const rows = data.registers.bonds?.rows ?? [];
  const programmeId = Number((data.programme as { id?: number }).id ?? 0);
  const termsOf = (r: RecordRow) => (programmeId ? contractTermsFor(programmeId, { contractCode: codeOf(r), contractorId: r.contractor_id ? Number(r.contractor_id) : null }) : null);
  const cited: (ReturnType<typeof cite> extends string | null ? Parameters<typeof cite>[0] : never)[] = [];
  const items = filterBonds(rows, { expiry: bucket, category: "all", contractor: contractor ?? "" }).sort((a, b) => n(a.days_to_expiry) - n(b.days_to_expiry));
  const groups = groupByContractor(items);
  const one = groups.length === 1 ? groups[0] : null;
  const t = BUCKET_TEXT[bucket];
  const today = todayIso();
  const replyBy = formatDate(plusDays(today, t.replyDays));
  const cover = items.reduce((s, r) => s + n(r.amount_provided), 0);
  const subject = `${data.programme.name} (${data.programme.code}) – ${t.title}${one ? ` – ${one.contractor}` : ""} – ${items.length} item(s), SAR ${formatMoney(cover)} of cover`;
  const html: string[] = [];
  const text: string[] = [];
  const both = (h: string, tx: string | string[]) => {
    html.push(h);
    text.push(...(Array.isArray(tx) ? tx : [tx]));
  };
  both(`<p>Dear ${esc(one ? one.contractor : "Sir / Madam")},</p>`, [`Dear ${one ? one.contractor : "Sir / Madam"},`, "", `Subject: ${subject}`, ""]);
  html.push(`<p><b>Subject: ${esc(subject)}</b></p>`);
  const plural = items.length !== 1;
  const what = plural ? t.what.replace(/^has passed its expiry date/, "have passed their expiry dates").replace(/^runs out/, "run out") : t.what;
  const intro = one
    ? `Our records of the bonds and insurance policies held under your Contract(s) on ${data.programme.name} show that the ${plural ? `${items.length} instruments` : "instrument"} listed below ${what}.`
    : `Our records of the bonds and insurance policies held under the Contracts on ${data.programme.name} show that the ${items.length} instruments listed below, across ${groups.length} contractor(s), ${what.replace("The Contractor is", "each Contractor concerned is")}.`;
  both(`<p>${esc(intro)}</p>`, [intro, ""]);
  if (!items.length) both(`<p>There is nothing in this category at present.</p>`, "There is nothing in this category at present.");
  for (const g of groups) {
    if (!one) both(`<h3 style="margin:14px 0 4px;font-size:13px">${esc(g.contractor)} – ${g.items.length} item(s)</h3>`, ["", `${g.contractor} – ${g.items.length} item(s)`]);
    html.push(`<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:900px"><tr><th ${th}>Ref</th><th ${th}>Type</th><th ${th}>Policy / bond no</th><th ${th}>Issued by</th><th ${th}>Contract / package</th><th ${th}>Cover held (SAR)</th><th ${th}>Required by contract (SAR)</th><th ${th}>Start</th><th ${th}>Expiry</th><th ${th}>Position</th><th ${th}>Required</th></tr>`);
    text.push("  Ref | Type | Policy / bond no | Issued by | Contract / package | Cover held | Required by contract | Start | Expiry | Position | Required");
    for (const r of g.items) {
      const days = n(r.days_to_expiry);
      const position = days < 0 ? `Expired ${-days} day(s) ago` : days === 0 ? "Expires today" : `Expires in ${days} day(s)`;
      const contract = [r.cost_line_id__label, r.package_id__label].filter(Boolean).map(String).filter((v, i, a) => a.indexOf(v) === i).join(" · ") || "–";
      const required = n(r.required_amount);
      const short = required && n(r.amount_provided) < required - 0.004 ? ` – cover is SAR ${formatMoney(required - n(r.amount_provided))} short of the contract requirement` : "";
      const terms = termsOf(r);
      const dates = defectsDates(data, codeOf(r), terms);
      const type = String(r.type_id__label ?? "");
      const cat = bondCategory(type);
      let runTo = "";
      let ref = null as Parameters<typeof cite>[0];
      if (cat === "bond" && /performance/i.test(type)) {
        runTo = `valid until ${terms?.perfBondUntil ? `${terms.perfBondUntil} (the end of the Defects Liability Period)` : "the Defects Completion Date (the end of the Defects Liability Period)"}${dates ? `, expected ${formatDate(dates.defectsCompletion)}` : ""}`;
        ref = terms?.refs.performance_security;
      } else if (cat === "bond" && /advance/i.test(type)) {
        runTo = "valid until the advance payment has been fully repaid";
        ref = terms?.refs.performance_security;
      } else if (cat === "bond" && /retention/i.test(type)) {
        runTo = `valid until the end of the Defects Notification Period${dates ? ` (${formatDate(dates.dnpEnd)})` : ""}`;
        ref = terms?.refs.performance_security;
      } else if (cat === "insurance" && /professional indemnity|\bPI\b/i.test(type)) {
        runTo = `maintained for the duration of the Works and ${terms?.piYearsAfterCompletion ? `${terms.piYearsAfterCompletion} years` : "the period the Contract states"} after completion, and in any case throughout the Defects Liability Period${dates ? ` (to ${formatDate(dates.dnpEnd)} at least)` : ""}`;
        ref = terms?.refs.professional_indemnity ?? terms?.refs.insurance_schedule ?? terms?.refs.insurance;
      } else if (cat === "insurance") {
        runTo = `period insured to ${terms?.insurancePeriod ?? "the issue of the Performance Certificate, including the Defects Notification Period"}${dates ? ` (${formatDate(dates.dnpEnd)} at least)` : ""}`;
        ref = terms?.refs.insurance_schedule ?? terms?.refs.insurance;
      }
      if (ref) cited.push(ref);
      const clause = cite(ref);
      const need = `${days < 0 ? `Replacement / extension ${kindOf(r)} effective ${formatDate(String(r.expiry_date ?? ""))}` : `Renewal / extension ${kindOf(r)} issued before ${formatDate(String(r.expiry_date ?? ""))}`}${runTo ? `, ${runTo}` : ""}${clause ? ` – ${clause}` : ""}${short}`;
      html.push(`<tr${days < 0 ? ' style="background:#fff7f7"' : ""}><td ${td}><b>${esc(r.ref)}</b></td><td ${td}>${esc(r.type_id__label)}</td><td ${td}>${esc(r.policy_no ?? "–")}</td><td ${td}>${esc(r.issuer ?? "–")}</td><td ${td}>${esc(contract)}</td><td ${tdr}>${formatMoney(n(r.amount_provided))}</td><td ${tdr}>${required ? formatMoney(required) : "–"}</td><td ${td}>${esc(formatDate(String(r.start_date ?? "")) || "–")}</td><td ${td}>${esc(formatDate(String(r.expiry_date ?? "")))}</td><td ${td}${days < 0 ? ' style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px;color:#b91c1c;font-weight:bold;vertical-align:top"' : ""}>${esc(position)}</td><td ${td}>${esc(need)}</td></tr>`);
      text.push(`  ${r.ref} | ${r.type_id__label ?? ""} | ${r.policy_no ?? "–"} | ${r.issuer ?? "–"} | ${contract} | ${formatMoney(n(r.amount_provided))} | ${required ? formatMoney(required) : "–"} | ${formatDate(String(r.start_date ?? "")) || "–"} | ${formatDate(String(r.expiry_date ?? ""))} | ${position} | ${need}`);
    }
    const gCover = g.items.reduce((s, r) => s + n(r.amount_provided), 0);
    html.push(`<tr><td ${td} colspan="5"><b>Total cover affected</b></td><td ${tdr}><b>${formatMoney(gCover)}</b></td><td ${td} colspan="5"></td></tr></table>`);
    text.push(`  Total cover affected: SAR ${formatMoney(gCover)}`);
    // the contractual position, per contract of the contractor
    const codes = [...new Set(g.items.map(codeOf).filter(Boolean))];
    const positions: string[] = [];
    for (const code of codes.length ? codes : [""]) {
      const sample = g.items.find((r) => codeOf(r) === code) ?? g.items[0];
      const terms = termsOf(sample);
      const lines = contractualPosition(code, terms, defectsDates(data, code, terms));
      if (terms) for (const r of [terms.refs.performance_security, terms.refs.dnp, terms.refs.insurance_schedule ?? terms.refs.insurance, terms.refs.professional_indemnity, terms.refs.employer_claims, terms.refs.set_off]) if (r) cited.push(r);
      positions.push(`${code ? `<b>Contract ${esc(code)}</b>${terms ? ` (${esc(terms.docTitle)})` : ""}: ` : ""}${lines.map(esc).join(" ")}`);
    }
    if (positions.length) {
      both(`<p><b>Contractual position.</b></p><ul>${positions.map((x) => `<li>${x}</li>`).join("")}</ul>`, ["", "Contractual position:", ...positions.map((x) => `  - ${x.replace(/<[^>]+>/g, "")}`)]);
    }
  }
  if (items.length) {
    const firstTerms = termsOf(items[0]);
    const rights = [firstTerms?.refs.set_off, firstTerms?.refs.employer_claims].filter(Boolean) as NonNullable<Parameters<typeof cite>[0]>[];
    const rightsClause = rights.length ? ` ${under(rights[0])}${rights[1] ? ` and ${cite(rights[1])}` : ""}` : "";
    const asks = [
      `Provide ${t.ask}, for each item listed, by <b>${esc(replyBy)}</b>; the original instrument is to be delivered to the Employer's Representative and a scanned copy sent to the commercial team on issue.`,
      `Where a bond or guarantee is concerned, it is to be issued by a bank acceptable to the Employer, on the Contract's prescribed wording, for the required amount and with an expiry date no earlier than the Contract requires.`,
      `Where an insurance policy is concerned, the renewal certificate is to name the Employer as required by the Contract and confirm the limits of indemnity; a copy of the premium payment receipt is to be provided with it.`,
      bucket === "expired"
        ? `Until the replacement is in place the Employer reserves all its rights under the Contract, including the right to withhold payment${rightsClause}, to effect the insurance itself and recover the premium, and to treat the breach as a matter for the next payment certificate.`
        : `Should the renewal not be in place by the expiry date, the Employer will treat the instrument as lapsed and reserve its rights under the Contract, including the right to withhold payment${rightsClause} and to effect the insurance itself and recover the premium.`,
    ];
    both(`<p>We therefore request that:</p><ol>${asks.map((a) => `<li>${a}</li>`).join("")}</ol>`, ["", "We therefore request that:", ...asks.map((a, i) => `  ${i + 1}. ${a.replace(/<\/?b>/g, "")}`)]);
    both(`<p>Please confirm receipt of this notice and the date by which each instrument will be delivered. This notice is issued without prejudice to the Employer's rights under the Contract.</p>`, ["", "Please confirm receipt of this notice and the date by which each instrument will be delivered. This notice is issued without prejudice to the Employer's rights under the Contract."]);
    const list = citedList(cited);
    if (list) both(`<p style="font-size:12px;color:#555">Contract provisions referred to: ${esc(list)}.</p>`, `Contract provisions referred to: ${list}.`);
  }
  both(`<p>Kind regards,</p>`, ["", "Kind regards,"]);
  const tag = bucket === "expired" ? "Expired" : bucket === "d30" ? "Expiring_30_days" : "Expiring_60_days";
  return { subject, to: [], html: `<div style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#172033;line-height:1.45">${html.join("\n")}</div>`, text: text.join("\r\n"), fileBase: `Bonds_Insurance_Notice_${tag}_${one ? fileTag(one.contractor) : "All"}_${data.programme.code}` };
}
