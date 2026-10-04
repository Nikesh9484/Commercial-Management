import type { ReportData } from "./data";
import type { EmailSummary } from "./email";
import type { RecordRow } from "../registers/types";
import { getAccommodationSummary, getCustomsSummary } from "../recovery/summary";
import { getDb } from "../db";
import { contractorKey } from "../bonds/name-key";
import { formatDate, formatMoney, formatMonthYear } from "../format";
import { APP_NAME } from "../brand";

/**
 * The one-click chase emails of the Cost Recovery module – one per contractor, every contractor
 * with a balance when none is named:
 *  - accommodation: the invoices still unpaid under the construction village lease agreements, one
 *    table per lease agreement (invoice, occupancy period, dates, amount, unpaid, days overdue), the
 *    assessed-not-yet-invoiced note, the late-settlement history and the requests;
 *  - customs: the customs declarations RSG paid on the contractor's imports, the DVO already
 *    recorded for the recovery and the balance still to recover.
 */
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const td = 'style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px"';
const tdr = 'style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px;text-align:right;font-family:Consolas,monospace"';
const th = 'style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px;background:#f3f5f8;text-align:left"';
const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const sameCo = (a: unknown, b: unknown) => {
  const ka = contractorKey(a);
  const kb = contractorKey(b);
  return !!ka && !!kb && (ka === kb || ka.includes(kb) || kb.includes(ka));
};
/** The cost report lines of the programme with their package, for naming a contract in a letter. */
function costLinesOf(programmeId: number): Map<number, { code: string; name: string; package: string }> {
  try {
    const rows = getDb().prepare("SELECT l.id, l.code, l.name, p.name AS package FROM cost_lines l LEFT JOIN packages p ON p.id = l.package_id WHERE l.programme_id = ?").all(programmeId) as { id: number; code: string | null; name: string | null; package: string | null }[];
    return new Map(rows.map((r) => [r.id, { code: String(r.code ?? ""), name: String(r.name ?? ""), package: String(r.package ?? "") }]));
  } catch {
    return new Map();
  }
}
/** The lease agreements of a contractor on the lease tracker, with their amendments. */
function leasesOf(programmeId: number, contractor: string): { lease: Record<string, unknown>; amendments: Record<string, unknown>[] }[] {
  try {
    const db = getDb();
    const leases = db.prepare("SELECT l.*, k.name AS contractor_name FROM lease_agreements l LEFT JOIN contractors k ON k.id = l.contractor_id WHERE l.programme_id = ?").all(programmeId) as Record<string, unknown>[];
    const mine = leases.filter((l) => sameCo(l.contractor_name, contractor));
    return mine.map((lease) => ({ lease, amendments: db.prepare("SELECT * FROM lease_amendments WHERE agreement_id = ? ORDER BY amendment_no, amendment_date").all(lease.id) as Record<string, unknown>[] }));
  } catch {
    return [];
  }
}
const plusDays = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const fileTag = (name: string) => name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export function buildAccommodationEmail(data: ReportData, sender: { name: string; email?: string }, contractor?: string | null): EmailSummary {
  const acc = getAccommodationSummary(data.recovery.accommodation, data.recovery.accommodationInvoices);
  const groups = contractor ? acc.byContractor.filter((c) => c.contractor === contractor) : acc.byContractor.filter((c) => c.totals.outstanding > 0.5);
  const one = groups.length === 1 ? groups[0] : null;
  const asOfIso = acc.asOf ?? data.period.period_end;
  const asOf = formatDate(asOfIso);
  const outstanding = groups.reduce((t, g) => t + g.totals.outstanding, 0);
  const payBy = formatDate(plusDays(asOfIso, 7));
  const subject = one
    ? `${data.programme.name} (${data.programme.code}) – Construction Village accommodation charges – overdue balance SAR ${formatMoney(one.totals.outstanding)} – ${one.contractor}`
    : `${data.programme.name} (${data.programme.code}) – Construction Village accommodation charges – overdue balances as at ${asOf}`;
  const leaseNames = groups.flatMap((g) => g.rows.map((r) => `${String(r.tracker_name)}${r.asset_ref ? ` (${String(r.asset_ref)})` : ""}`));

  const html: string[] = [];
  const text: string[] = [];
  const both = (h: string, t: string) => {
    html.push(h);
    text.push(t);
  };
  both(`<p>Dear ${esc(one ? one.contractor : "Sir / Madam")},</p>`, `Dear ${one ? one.contractor : "Sir / Madam"},`);
  text.push("", `Subject: ${subject}`, "");
  html.push(`<p><b>Subject: ${esc(subject)}</b></p>`);
  both(
    `<p>Further to the Lease Agreement${leaseNames.length === 1 ? "" : "s"} for accommodation at the AMAALA Construction Village, our records as at ${esc(asOf)} show an overdue balance of <b>SAR ${formatMoney(outstanding)}</b> (inclusive of VAT) against the ${esc(leaseNames.join(", "))} account${leaseNames.length === 1 ? "" : "s"}. The account is set out below, lease by lease and invoice by invoice; the unpaid invoices remain open beyond the 14-day settlement period stated in the lease.</p>`,
    `Further to the Lease Agreement${leaseNames.length === 1 ? "" : "s"} for accommodation at the AMAALA Construction Village, our records as at ${asOf} show an overdue balance of SAR ${formatMoney(outstanding)} (inclusive of VAT) against the ${leaseNames.join(", ")} account${leaseNames.length === 1 ? "" : "s"}. The account is set out below, lease by lease and invoice by invoice; the unpaid invoices remain open beyond the 14-day settlement period stated in the lease.`,
  );
  const notYet: string[] = [];
  const late: number[] = [];
  const programmeId = Number((data.programme as { id?: number }).id ?? 0);
  const thr = th.replace('text-align:left', "text-align:right");
  for (const g of groups) {
    // 1. the lease agreement(s) behind the account, from the lease tracker
    const leases = programmeId ? leasesOf(programmeId, g.contractor) : [];
    for (const { lease: l, amendments } of leases) {
      const terms = [
        `Lease Agreement ${esc(l.agreement_no)}${l.agreement_date ? ` dated ${formatDate(String(l.agreement_date))}` : ""}`,
        l.contract_code ? `works contract ${esc(l.contract_code)}` : "",
        l.commencement_date ? `commencement ${formatDate(String(l.commencement_date))}` : "",
        l.term_months ? `term ${String(l.term_months)} months` : "",
        l.expiry_date ? `expiry ${formatDate(String(l.expiry_date))}` : "",
        n(l.lease_fee) ? `lease fee SAR ${formatMoney(n(l.lease_fee))}` : "",
        n(l.security_deposit) ? `security deposit SAR ${formatMoney(n(l.security_deposit))}${l.deposit_received ? " (received)" : " (not yet received)"}` : "",
      ].filter(Boolean);
      const amend = amendments.map((a) => `Amendment No ${String(a.amendment_no ?? "?")}${a.amendment_date ? ` of ${formatDate(String(a.amendment_date))}` : ""}${n(a.new_fee) ? `: lease fee SAR ${formatMoney(n(a.new_fee))}` : ""}${a.new_expiry ? `, expiry ${formatDate(String(a.new_expiry))}` : ""}`);
      const current = [n(l.current_fee) ? `current lease fee SAR ${formatMoney(n(l.current_fee))}` : "", l.current_expiry ? `current expiry ${formatDate(String(l.current_expiry))}` : ""].filter(Boolean).join(", ");
      both(
        `<p><b>${terms[0]}</b>${terms.length > 1 ? ` – ${terms.slice(1).join(", ")}` : ""}.${amend.length ? ` ${esc(amend.join("; "))}.` : ""}${current ? ` ${esc(current.charAt(0).toUpperCase() + current.slice(1))}.` : ""}</p>`,
        `${terms.map((t) => t.replace(/<[^>]+>/g, "")).join(", ")}.${amend.length ? ` ${amend.join("; ")}.` : ""}${current ? ` ${current}.` : ""}`,
      );
    }
    for (const lease of g.rows) {
      const leaseKey = String(lease.tracker_key ?? "").split("|").slice(1).join("|") || String(lease.tracker_key ?? "");
      const all = g.detail.invoices.filter((i) => String(i.lease_key ?? "") === leaseKey || String(i.tracker_name ?? "") === String(lease.tracker_name ?? ""));
      const mine = all.filter((i) => i.status === "Unpaid" || i.status === "Part-paid");
      const heading = `${String(lease.tracker_name)}${lease.program_name ? ` – ${String(lease.program_name)}` : ""}${lease.asset_ref ? ` (asset ${String(lease.asset_ref)})` : ""} – outstanding SAR ${formatMoney(n(lease.outstanding))}`;
      html.push(`<p><b>${esc(heading)}</b></p>`);
      text.push("", heading);
      // 2. the account as the tracker holds it, line by line
      const build: [string, number][] = [
        ["Lease agreement sum", n(lease.lease_sum)],
        ["Assessed to date (net of VAT)", n(lease.assessment_to_date)],
        ["Invoiced to date (excl. VAT)", n(lease.invoiced_net)],
        ["Assessed, not yet invoiced", n(lease.not_yet_invoiced)],
        ["Invoiced to date (incl. VAT)", n(lease.invoiced_gross)],
        ["Received and recovered", n(lease.received_total)],
        ["Of which confirmed by Finance", n(lease.confirmed_by_finance)],
        ["Awaiting Finance confirmation", n(lease.awaiting_confirmation)],
        ["Offset through an IPC", n(lease.offset_via_ipc)],
        [`Withheld under IPC${lease.ipc_ref ? ` (${String(lease.ipc_ref)})` : ""}`, n(lease.withheld_in_ipc)],
        ["Outstanding (incl. VAT)", n(lease.outstanding)],
        ["To be settled in the final account", n(lease.deemed_settled_fa)],
      ];
      const shown = build.filter(([, v], i) => Math.abs(v) > 0.004 || i === 4 || i === 5 || i === 10);
      html.push(`<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:420px"><tr><th ${th}>Account position as at ${esc(asOf)}</th><th ${thr}>SAR</th></tr>${shown.map(([l, v]) => `<tr><td ${td}>${esc(l)}</td><td ${tdr}>${l.startsWith("Outstanding") ? `<b>${formatMoney(v)}</b>` : formatMoney(v)}</td></tr>`).join("")}</table>`);
      text.push(`  Account position as at ${asOf}:`, ...shown.map(([l, v]) => `    ${l}: ${formatMoney(v)}`));
      if (lease.note) both(`<p style="font-size:12px;color:#555">Tracker note: ${esc(lease.note)}</p>`, `  Tracker note: ${String(lease.note)}`);
      // 3. every invoice issued under the lease, the unpaid ones in bold
      if (!all.length) {
        both(`<p style="font-size:12px;color:#555">The invoice-by-invoice list (invoice number, occupancy period, dates, amount, received, unpaid, days overdue) is added to this letter once the accommodation invoice tracker has been uploaded again – its invoice sets are read into the dashboard.</p>`, "  (The invoice-by-invoice list is added once the accommodation invoice tracker has been uploaded again.)");
        continue;
      }
      const unpaidSum = mine.reduce((t, i) => t + n(i.balance_due), 0);
      const credit = g.detail.overpaid;
      html.push(`<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:640px"><tr><th ${th}>Set</th><th ${th}>Invoice no.</th><th ${th}>Occupancy period</th><th ${th}>Invoice date</th><th ${th}>Issued on</th><th ${th}>Due date</th><th ${thr}>Excl. VAT (SAR)</th><th ${thr}>Incl. VAT (SAR)</th><th ${thr}>Received (SAR)</th><th ${thr}>Offset / withheld (SAR)</th><th ${thr}>Unpaid (SAR)</th><th ${th}>Status</th><th ${th}>Settled on</th><th ${thr}>Days overdue</th></tr>`);
      text.push("  Set | Invoice no | Occupancy period | Invoice date | Issued on | Due date | Excl. VAT | Incl. VAT | Received | Offset / withheld | Unpaid | Status | Settled on | Days overdue");
      for (const i of all) {
        const open = i.status === "Unpaid" || i.status === "Part-paid";
        const b = (x: string) => (open ? `<b>${x}</b>` : x);
        const days = n(i.days_overdue) > 0 ? String(n(i.days_overdue)) : open ? "due" : "";
        const offset = n(i.offset_via_ipc) + n(i.withheld_in_ipc);
        html.push(`<tr${open ? ' style="background:#fff7f7"' : ""}><td ${td}>${esc(i.set_no)}</td><td ${td}>${b(esc(i.invoice_no))}</td><td ${td}>${esc(formatMonthYear(i.invoice_period as string))}</td><td ${td}>${esc(formatDate(i.invoice_date as string))}</td><td ${td}>${esc(formatDate(i.issued_date as string))}</td><td ${td}>${esc(formatDate(i.due_date as string))}</td><td ${tdr}>${formatMoney(n(i.amount_net))}</td><td ${tdr}>${formatMoney(n(i.amount_gross))}</td><td ${tdr}>${formatMoney(n(i.received))}</td><td ${tdr}>${offset ? formatMoney(offset) : "–"}</td><td ${tdr}>${b(formatMoney(n(i.balance_due)))}</td><td ${td}>${esc(i.status)}</td><td ${td}>${i.actual_settlement_date ? esc(formatDate(String(i.actual_settlement_date))) : "–"}</td><td ${tdr}>${days}</td></tr>`);
        text.push(`  ${String(i.set_no ?? "")} | ${String(i.invoice_no ?? "")} | ${formatMonthYear(i.invoice_period as string)} | ${formatDate(i.invoice_date as string)} | ${formatDate(i.issued_date as string)} | ${formatDate(i.due_date as string)} | ${formatMoney(n(i.amount_net))} | ${formatMoney(n(i.amount_gross))} | ${formatMoney(n(i.received))} | ${offset ? formatMoney(offset) : "–"} | ${formatMoney(n(i.balance_due))} | ${String(i.status ?? "")} | ${i.actual_settlement_date ? formatDate(String(i.actual_settlement_date)) : "–"} | ${days}`);
      }
      const sum = (k: string) => all.reduce((t, i) => t + n(i[k]), 0);
      const totalNote = credit > 0.5 ? `${formatMoney(unpaidSum)} less SAR ${formatMoney(credit)} overpaid = <b>${formatMoney(unpaidSum - credit)}</b>` : `<b>${formatMoney(unpaidSum)}</b>`;
      html.push(`<tr><td ${td} colspan="6"><b>Total – ${all.length} invoice(s), ${mine.length} unpaid</b></td><td ${tdr}><b>${formatMoney(sum("amount_net"))}</b></td><td ${tdr}><b>${formatMoney(sum("amount_gross"))}</b></td><td ${tdr}><b>${formatMoney(sum("received"))}</b></td><td ${tdr}>${formatMoney(sum("offset_via_ipc") + sum("withheld_in_ipc"))}</td><td ${tdr}>${totalNote}</td><td ${td} colspan="3"></td></tr></table>`);
      text.push(`  Total – ${all.length} invoice(s), ${mine.length} unpaid: incl. VAT ${formatMoney(sum("amount_gross"))}, received ${formatMoney(sum("received"))}, unpaid ${credit > 0.5 ? `${formatMoney(unpaidSum)} less SAR ${formatMoney(credit)} overpaid = ${formatMoney(unpaidSum - credit)}` : formatMoney(unpaidSum)}`);
    }
    if (g.detail.notYetInvoiced > 0.5) notYet.push(`SAR ${formatMoney(g.detail.notYetInvoiced)} (${g.contractor})`);
    if (g.detail.lateHistory.count) late.push(g.detail.lateHistory.min, g.detail.lateHistory.max);
  }
  if (notYet.length) both(`<p>In addition, we have assessed further occupancy at ${esc(notYet.join(" and "))}, net of VAT; these invoices will follow shortly.</p>`, `In addition, we have assessed further occupancy at ${notYet.join(" and ")}, net of VAT; these invoices will follow shortly.`);
  const lateText = late.length ? (Math.min(...late) === Math.max(...late) ? `${Math.max(...late)} days late` : `between ${Math.min(...late)} and ${Math.max(...late)} days late`) : "";
  if (late.length) both(`<p>We note that earlier invoices${groups.length > 1 ? " on these accounts" : ""} were settled ${esc(lateText)}. Timely settlement of accommodation charges is a condition of the Lease Agreement and is separate from, and not contingent on, the progress of Interim Payment Certificates under the main contract.</p>`, `We note that earlier invoices${groups.length > 1 ? " on these accounts" : ""} were settled ${lateText}. Timely settlement of accommodation charges is a condition of the Lease Agreement and is separate from, and not contingent on, the progress of Interim Payment Certificates under the main contract.`);
  both(
    `<p>We request that:</p><ol><li>The full overdue amount of <b>SAR ${formatMoney(outstanding)}</b> is remitted by <b>${esc(payBy)}</b>, with the remittance advice sent to the commercial team and Finance so the receipt is recorded against the invoices listed above.</li><li>Any invoice you consider disputed is raised in writing within 7 days, quoting the invoice number and the grounds, so it can be reviewed with Finance.</li><li>Failing settlement by that date, the balance will be withheld from your next Interim Payment Certificate and recovered by contra-charge in line with the Lease Agreement and the Contract, and any balance still open at final account will be settled within the Final Account Statement.</li></ol>`,
    ["We request that:", `  1. The full overdue amount of SAR ${formatMoney(outstanding)} is remitted by ${payBy}, with the remittance advice sent to the commercial team and Finance so the receipt is recorded against the invoices listed above.`, "  2. Any invoice you consider disputed is raised in writing within 7 days, quoting the invoice number and the grounds, so it can be reviewed with Finance.", "  3. Failing settlement by that date, the balance will be withheld from your next Interim Payment Certificate and recovered by contra-charge in line with the Lease Agreement and the Contract, and any balance still open at final account will be settled within the Final Account Statement."].join("\n"),
  );
  both(`<p>Kind regards,</p><p><b>${esc(sender.name)}</b><br>Commercial Management – ${esc(data.programme.name)} (${esc(data.programme.code)})</p>`, ["", "Kind regards,", sender.name, `Commercial Management – ${data.programme.name} (${data.programme.code})`].join("\n"));
  html.push(`<p style="font-size:11px;color:#6b7280">Prepared with ${esc(APP_NAME)} from the accommodation invoice tracker as at ${esc(asOf)}.</p>`);
  return { subject, to: [], html: `<div style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#172033;line-height:1.45">${html.join("\n")}</div>`, text: text.join("\r\n"), fileBase: `Accommodation_Charges_${one ? fileTag(one.contractor) : "All"}_${data.programme.code}` };
}

export function buildCustomsEmail(data: ReportData, sender: { name: string; email?: string }, contractor?: string | null): EmailSummary {
  const cus = getCustomsSummary(data.recovery.customs, data.registers.changes?.rows ?? [], data.recovery.customsDeclarations);
  const groups = contractor ? cus.byContractor.filter((c) => c.contractor === contractor) : cus.byContractor.filter((c) => c.totals.stillToRecover > 0.5);
  const one = groups.length === 1 ? groups[0] : null;
  const asOfIso = cus.asOf ?? data.period.period_end;
  const asOf = formatDate(asOfIso);
  const replyBy = formatDate(plusDays(asOfIso, 7));
  const still = groups.reduce((t, g) => t + g.totals.stillToRecover, 0);
  const subject = one
    ? `${data.programme.name} (${data.programme.code}) – Customs duties paid by RSG on your imports – SAR ${formatMoney(one.totals.stillToRecover)} to recover – ${one.contractor}`
    : `${data.programme.name} (${data.programme.code}) – Customs duties paid by RSG – recovery position as at ${asOf}`;
  const html: string[] = [];
  const text: string[] = [];
  const both = (h: string, t: string) => {
    html.push(h);
    text.push(t);
  };
  both(`<p>Dear ${esc(one ? one.contractor : "Sir / Madam")},</p>`, `Dear ${one ? one.contractor : "Sir / Madam"},`);
  text.push("", `Subject: ${subject}`, "");
  html.push(`<p><b>Subject: ${esc(subject)}</b></p>`);
  const programmeId = Number((data.programme as { id?: number }).id ?? 0);
  const lines = programmeId ? costLinesOf(programmeId) : new Map();
  const thr = th.replace('text-align:left', "text-align:right");
  for (const g of groups) {
    const contracts = [...new Set(g.rows.map((r) => String(r.contract_code ?? "")).filter(Boolean))].join(", ");
    const payer = g.payer || "the Contractor";
    // where the imports belong: programme, asset codes, contracts with their cost report line and package
    const where = g.rows.map((r) => {
      const line = r.cost_line_id ? lines.get(Number(r.cost_line_id)) : undefined;
      return [r.contract_code ? `contract ${String(r.contract_code)}` : "", line ? `${line.code} ${line.name}`.trim() : "", line?.package ? `package ${line.package}` : "", r.asset_ref ? `asset ${String(r.asset_ref)}` : "", r.other_contract_note ? String(r.other_contract_note) : ""].filter(Boolean).join(" · ");
    }).filter(Boolean);
    both(
      `<p>Programme ${esc(data.programme.code)} – ${esc(data.programme.name)}${where.length ? `; ${esc(where.join("; "))}` : ""}.</p>`,
      `Programme ${data.programme.code} – ${data.programme.name}${where.length ? `; ${where.join("; ")}` : ""}.`,
    );
    both(
      `<p>Under ${contracts ? `Contract ${esc(contracts)}` : "your Contract"} the customs duties on imported goods are borne by ${esc(payer)}. Our records as at ${esc(asOf)} show that RSG / AMAALA has paid customs duties of <b>SAR ${formatMoney(g.totals.rsgPaid)}</b> on ${esc(g.contractor)}'s imports${g.rsgPaidList.length ? `, on the ${g.rsgPaidList.length} customs declaration${g.rsgPaidList.length === 1 ? "" : "s"} listed below` : ""}.</p>`,
      `Under ${contracts ? `Contract ${contracts}` : "your Contract"} the customs duties on imported goods are borne by ${payer}. Our records as at ${asOf} show that RSG / AMAALA has paid customs duties of SAR ${formatMoney(g.totals.rsgPaid)} on ${g.contractor}'s imports${g.rsgPaidList.length ? `, on the ${g.rsgPaidList.length} customs declaration${g.rsgPaidList.length === 1 ? "" : "s"} listed below` : ""}.`,
    );
    if (g.declarations.length) {
      // every customs declaration on the contractor's imports, the ones RSG paid in bold
      both(`<p>Customs declarations on ${esc(g.contractor)}'s imports, from the customs recovery tracker (${g.declarations.length} declaration(s), ${g.rsgPaidList.length} paid by RSG):</p>`, `Customs declarations on ${g.contractor}'s imports (${g.declarations.length}, ${g.rsgPaidList.length} paid by RSG):`);
      html.push(`<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:640px"><tr><th ${th}>Payment date</th><th ${th}>Bayan no.</th><th ${th}>Port</th><th ${th}>Statement</th><th ${th}>Customs broker</th><th ${th}>Supplier / manufacturer</th><th ${th}>Invoice no.</th><th ${thr}>Goods value (SAR)</th><th ${thr}>VAT (SAR)</th><th ${thr}>Customs duty (SAR)</th><th ${th}>Who paid</th><th ${thr}>Paid by RSG (SAR)</th><th ${thr}>Paid by contractor (SAR)</th><th ${th}>SNB status</th><th ${th}>Remarks</th></tr>`);
      text.push("  Payment date | Bayan no | Port | Statement | Customs broker | Supplier | Invoice no | Goods value | VAT | Customs duty | Who paid | Paid by RSG | Paid by contractor | SNB status | Remarks");
      for (const d of g.declarations) {
        const rsg = d.paid_by === "RSG" || n(d.rsg_paid) > 0;
        const b = (x: string) => (rsg ? `<b>${x}</b>` : x);
        html.push(`<tr${rsg ? ' style="background:#fff7f7"' : ""}><td ${td}>${esc(formatDate((d.payment_date ?? d.statement_date) as string))}</td><td ${td}>${b(esc(d.bayan_no))}</td><td ${td}>${esc(d.port)}</td><td ${td}>${esc(d.statement_type)}</td><td ${td}>${esc(d.broker)}</td><td ${td}>${esc(d.supplier)}</td><td ${td}>${esc(d.invoice_no)}</td><td ${tdr}>${formatMoney(n(d.goods_value))}</td><td ${tdr}>${formatMoney(n(d.vat_amount))}</td><td ${tdr}>${formatMoney(n(d.customs_duty))}</td><td ${td}>${esc(d.paid_by)}</td><td ${tdr}>${b(formatMoney(n(d.rsg_paid) || (d.paid_by === "RSG" ? n(d.customs_duty) : 0)))}</td><td ${tdr}>${formatMoney(n(d.contractor_paid))}</td><td ${td}>${esc(d.snb_status)}</td><td ${td}>${esc(d.remarks)}</td></tr>`);
        text.push(`  ${formatDate((d.payment_date ?? d.statement_date) as string)} | ${String(d.bayan_no ?? "")} | ${String(d.port ?? "")} | ${String(d.statement_type ?? "")} | ${String(d.broker ?? "")} | ${String(d.supplier ?? "")} | ${String(d.invoice_no ?? "")} | ${formatMoney(n(d.goods_value))} | ${formatMoney(n(d.vat_amount))} | ${formatMoney(n(d.customs_duty))} | ${String(d.paid_by ?? "")} | ${formatMoney(n(d.rsg_paid) || (d.paid_by === "RSG" ? n(d.customs_duty) : 0))} | ${formatMoney(n(d.contractor_paid))} | ${String(d.snb_status ?? "")} | ${String(d.remarks ?? "")}`);
      }
      html.push(`<tr><td ${td} colspan="9"><b>Total</b></td><td ${tdr}><b>${formatMoney(g.declarations.reduce((t, d) => t + n(d.customs_duty), 0))}</b></td><td ${td}></td><td ${tdr}><b>${formatMoney(g.rsgPaidListed)}</b></td><td ${tdr}><b>${formatMoney(g.declarations.reduce((t, d) => t + n(d.contractor_paid), 0))}</b></td><td ${td} colspan="2"></td></tr></table>`);
      text.push(`  Total: customs duty ${formatMoney(g.declarations.reduce((t, d) => t + n(d.customs_duty), 0))}, paid by RSG ${formatMoney(g.rsgPaidListed)}, paid by contractor ${formatMoney(g.declarations.reduce((t, d) => t + n(d.contractor_paid), 0))}`);
    }
    // how the amount is made up, contract by contract, from the tracker's own columns – so the figure
    // is never a bare total, even before the declaration-level Breakdown sheet is uploaded
    const cols: [string, (r: RecordRow) => number][] = [
      ["Customs (Fasah)", (r) => n(r.customs_fasah)],
      ["Customs (Naif)", (r) => n(r.customs_naif)],
      ["VAT deferred", (r) => n(r.vat_deferred)],
      ["VAT definitive", (r) => n(r.vat_definitive)],
      ["Paid by RSG", (r) => n(r.customs_rsg_paid)],
      ["Paid by contractor", (r) => n(r.customs_contractor_paid)],
      ["To recover", (r) => n(r.to_recover)],
      ["Unrecoverable", (r) => n(r.unrecoverable)],
      ["Recovered by DVO", (r) => n(r.recovered_by_dvo)],
      ["Still to recover", (r) => n(r.still_to_recover)],
    ];
    const used = cols.filter(([, f]) => g.rows.some((r) => Math.abs(f(r)) > 0.004));
    both(`<p>How the amount is made up, per contract, from the customs recovery tracker${asOf ? ` as at ${esc(asOf)}` : ""} (SAR, excl. VAT unless stated):</p>`, `How the amount is made up, per contract, from the customs recovery tracker${asOf ? ` as at ${asOf}` : ""} (SAR):`);
    html.push(`<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:640px"><tr><th ${th}>Contract</th><th ${th}>Scope / note</th>${used.map(([l]) => `<th ${th}>${esc(l)}</th>`).join("")}</tr>`);
    text.push(`  Contract | Scope / note | ${used.map(([l]) => l).join(" | ")}`);
    for (const r of g.rows) {
      const note = [r.other_contract_note, r.customs_payer ? `customs per contract: ${r.customs_payer}` : "", r.pvo_ref ? `PVO ${r.pvo_ref}` : "", r.ewn_ref ? `EWN ${r.ewn_ref}` : ""].filter(Boolean).join(" · ");
      html.push(`<tr><td ${td}>${esc(r.contract_code ?? r.asset_ref ?? "–")}</td><td ${td}>${esc(note)}</td>${used.map(([, f]) => `<td ${tdr}>${formatMoney(f(r))}</td>`).join("")}</tr>`);
      text.push(`  ${String(r.contract_code ?? r.asset_ref ?? "–")} | ${note} | ${used.map(([, f]) => formatMoney(f(r))).join(" | ")}`);
    }
    if (g.rows.length > 1) {
      html.push(`<tr><td ${td} colspan="2"><b>Total</b></td>${used.map(([, f]) => `<td ${tdr}><b>${formatMoney(g.rows.reduce((t, r) => t + f(r), 0))}</b></td>`).join("")}</tr>`);
      text.push(`  Total | | ${used.map(([, f]) => formatMoney(g.rows.reduce((t, r) => t + f(r), 0))).join(" | ")}`);
    }
    html.push("</table>");
    if (!g.rsgPaidList.length) {
      both(
        `<p style="font-size:12px;color:#555">The declaration-by-declaration list (Bayan number, port, supplier, invoice, duty paid) is added to this letter once the Breakdown sheet of the customs recovery tracker is uploaded; the figures above are the tracker's own per-contract totals.</p>`,
        "  (The declaration-by-declaration list – Bayan number, port, supplier, invoice, duty paid – is added once the Breakdown sheet of the customs recovery tracker is uploaded.)",
      );
    }
    const parts = [`amount to recover SAR ${formatMoney(g.totals.toRecover)}`];
    if (g.totals.recoveredByDvo > 0.5) parts.push(`less SAR ${formatMoney(g.totals.recoveredByDvo)} already recovered through ${g.dvoNote || "the DVO recorded"}`);
    if (g.totals.unrecoverable > 0.5) parts.push(`SAR ${formatMoney(g.totals.unrecoverable)} treated as unrecoverable`);
    both(`<p>Recovery position: ${esc(parts.join("; "))} – <b>balance still to recover SAR ${formatMoney(g.totals.stillToRecover)}</b>.</p>`, `Recovery position: ${parts.join("; ")} – balance still to recover SAR ${formatMoney(g.totals.stillToRecover)}.`);
  }
  both(
    `<p>We request that:</p><ol><li>You confirm the declarations and amounts above, or raise any item you consider disputed in writing with the Bayan number and the grounds, by <b>${esc(replyBy)}</b>.</li><li>The balance of <b>SAR ${formatMoney(still)}</b> is recovered through a Determined Variation Order and deducted from your next Interim Payment Certificate, in line with the Contract; any balance still open at final account will be settled within the Final Account Statement.</li></ol>`,
    ["We request that:", `  1. You confirm the declarations and amounts above, or raise any item you consider disputed in writing with the Bayan number and the grounds, by ${replyBy}.`, `  2. The balance of SAR ${formatMoney(still)} is recovered through a Determined Variation Order and deducted from your next Interim Payment Certificate, in line with the Contract; any balance still open at final account will be settled within the Final Account Statement.`].join("\n"),
  );
  both(`<p>Kind regards,</p><p><b>${esc(sender.name)}</b><br>Commercial Management – ${esc(data.programme.name)} (${esc(data.programme.code)})</p>`, ["", "Kind regards,", sender.name, `Commercial Management – ${data.programme.name} (${data.programme.code})`].join("\n"));
  html.push(`<p style="font-size:11px;color:#6b7280">Prepared with ${esc(APP_NAME)} from the customs recovery tracker as at ${esc(asOf)}.</p>`);
  return { subject, to: [], html: `<div style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#172033;line-height:1.45">${html.join("\n")}</div>`, text: text.join("\r\n"), fileBase: `Customs_Duties_${one ? fileTag(one.contractor) : "All"}_${data.programme.code}` };
}

/**
 * The management summary of the customs duty recovery: the position per contractor, the Change
 * Management entry behind each recovery (RFC / EI → PVO → VO → DVO) with its references and values,
 * what is still to recover and the next action. Sent with the cost recovery report attached.
 */
export function buildCustomsManagementEmail(data: ReportData, sender: { name: string; email?: string }): EmailSummary {
  const cus = getCustomsSummary(data.recovery.customs, data.registers.changes?.rows ?? [], data.recovery.customsDeclarations);
  const asOfIso = cus.asOf ?? data.period.period_end;
  const asOf = formatDate(asOfIso);
  const subject = `${data.programme.name} (${data.programme.code}) – Customs duty recovery – management summary as at ${asOf}: SAR ${formatMoney(cus.totals.stillToRecover)} still to recover`;
  const html: string[] = [];
  const text: string[] = [];
  const both = (h: string, t: string | string[]) => {
    html.push(h);
    text.push(...(Array.isArray(t) ? t : [t]));
  };
  both(`<p>Dear all,</p>`, ["Dear all,", "", `Subject: ${subject}`, ""]);
  html.push(`<p><b>Subject: ${esc(subject)}</b></p>`);
  const t = cus.totals;
  both(
    `<p>Position of the customs duties RSG / AMAALA paid on contractors' imports under ${esc(data.programme.name)}, from the customs recovery tracker as at <b>${esc(asOf)}</b>:</p><ul><li>Customs paid by RSG: <b>SAR ${formatMoney(t.rsgPaid)}</b> (${t.rows} contract / vendor row(s))</li><li>To recover from contractors: <b>SAR ${formatMoney(t.toRecover)}</b>${t.contractorPaid > 0.5 ? ` – SAR ${formatMoney(t.contractorPaid)} was paid by the contractors themselves` : ""}</li><li>Recovered through determined variation orders: <b>SAR ${formatMoney(t.recoveredByDvo)}</b></li><li>Still to recover: <b style="color:#b91c1c">SAR ${formatMoney(t.stillToRecover)}</b>${t.unrecoverable > 0.5 ? ` (SAR ${formatMoney(t.unrecoverable)} treated as unrecoverable)` : ""}</li></ul>`,
    [`Position of the customs duties RSG / AMAALA paid on contractors' imports under ${data.programme.name}, from the customs recovery tracker as at ${asOf}:`, `  - Customs paid by RSG: SAR ${formatMoney(t.rsgPaid)} (${t.rows} contract / vendor row(s))`, `  - To recover from contractors: SAR ${formatMoney(t.toRecover)}`, `  - Recovered through determined variation orders: SAR ${formatMoney(t.recoveredByDvo)}`, `  - Still to recover: SAR ${formatMoney(t.stillToRecover)}`, ""],
  );
  const groups = [...cus.byContractor].sort((a, b) => b.totals.stillToRecover - a.totals.stillToRecover);
  both(`<p>Per contractor – the recovery is processed in Change Management as RFC / EI → PVO → VO → DVO; the entry behind each recovery and where it stands:</p>`, "Per contractor (the recovery is processed in Change Management as RFC / EI → PVO → VO → DVO):");
  html.push(`<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:900px"><tr><th ${th}>Contractor</th><th ${th}>Contract(s)</th><th ${th}>Paid by RSG</th><th ${th}>To recover</th><th ${th}>Change item · stage</th><th ${th}>RFC / EI</th><th ${th}>PVO</th><th ${th}>VO</th><th ${th}>DVO</th><th ${th}>Recovered by DVO</th><th ${th}>Still to recover</th><th ${th}>Remaining to pay (contract)</th><th ${th}>Next action</th></tr>`);
  text.push("  Contractor | Contract(s) | Paid by RSG | To recover | Change item · stage | RFC / EI | PVO | VO | DVO | Recovered by DVO | Still to recover | Remaining to pay | Next action");
  for (const g of groups) {
    const contracts = [...new Set(g.rows.map((r) => String(r.contract_code ?? "")).filter(Boolean))].join(", ") || "–";
    const ch = g.change;
    const item = ch ? `${ch.item_no} · ${ch.stage}${ch.explicit ? "" : " (by wording)"}` : "none yet";
    const rfc = ch ? [ch.rfc_ref ? `RFC ${ch.rfc_ref}` : "", ch.ei_ref ? `EI ${ch.ei_ref}` : ""].filter(Boolean).join(" / ") || "–" : "–";
    const pvo = ch && (ch.pvo_ref || ch.pvo_value) ? `${ch.pvo_ref}${ch.pvo_value ? ` SAR ${formatMoney(ch.pvo_value)}` : ""}${ch.pvo_status ? ` (${ch.pvo_status})` : ""}${ch.pvo_date ? ` ${formatDate(ch.pvo_date)}` : ""}`.trim() : "–";
    const vo = ch && ch.vo_ref ? `${ch.vo_ref}${ch.vo_date ? ` ${formatDate(ch.vo_date)}` : ""}` : "–";
    const dvo = ch && (ch.dvo_ref || ch.dvo_value) ? `${ch.dvo_ref}${ch.dvo_value ? ` SAR ${formatMoney(ch.dvo_value)}` : ""}${ch.dvo_status ? ` (${ch.dvo_status})` : ""}${ch.dvo_date ? ` ${formatDate(ch.dvo_date)}` : ""}`.trim() : "–";
    const still = g.totals.stillToRecover;
    html.push(`<tr${still > 0.5 ? "" : ' style="color:#6b7280"'}><td ${td}><b>${esc(g.contractor)}</b>${g.payer ? `<br><span style="font-size:11px;color:#6b7280">customs per contract: ${esc(g.payer)}</span>` : ""}</td><td ${td}>${esc(contracts)}</td><td ${tdr}>${formatMoney(g.totals.rsgPaid)}</td><td ${tdr}>${formatMoney(g.totals.toRecover)}</td><td ${td}>${esc(item)}</td><td ${td}>${esc(rfc)}</td><td ${td}>${esc(pvo)}</td><td ${td}>${esc(vo)}</td><td ${td}>${esc(dvo)}</td><td ${tdr}>${formatMoney(g.totals.recoveredByDvo)}</td><td ${tdr}${still > 0.5 ? ' style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px;text-align:right;font-family:Consolas,monospace;color:#b91c1c;font-weight:bold"' : ""}>${formatMoney(still)}</td><td ${tdr}>${formatMoney(g.totals.remainingToPay)}</td><td ${td}>${esc(g.nextAction)}</td></tr>`);
    text.push(`  ${g.contractor} | ${contracts} | ${formatMoney(g.totals.rsgPaid)} | ${formatMoney(g.totals.toRecover)} | ${item} | ${rfc} | ${pvo} | ${vo} | ${dvo} | ${formatMoney(g.totals.recoveredByDvo)} | ${formatMoney(still)} | ${formatMoney(g.totals.remainingToPay)} | ${g.nextAction}`);
  }
  html.push(`<tr><td ${td} colspan="2"><b>Total</b></td><td ${tdr}><b>${formatMoney(t.rsgPaid)}</b></td><td ${tdr}><b>${formatMoney(t.toRecover)}</b></td><td ${td} colspan="5"></td><td ${tdr}><b>${formatMoney(t.recoveredByDvo)}</b></td><td ${tdr}><b>${formatMoney(t.stillToRecover)}</b></td><td ${tdr}><b>${formatMoney(t.remainingToPay)}</b></td><td ${td}></td></tr></table>`);
  text.push(`  Total | | ${formatMoney(t.rsgPaid)} | ${formatMoney(t.toRecover)} | | | | | | ${formatMoney(t.recoveredByDvo)} | ${formatMoney(t.stillToRecover)} | ${formatMoney(t.remainingToPay)} |`, "");
  const noLink = groups.filter((g) => !g.change && g.totals.stillToRecover > 0.5);
  if (noLink.length) both(`<p><b>Without a Change Management entry yet:</b> ${esc(noLink.map((g) => `${g.contractor} (SAR ${formatMoney(g.totals.stillToRecover)})`).join("; "))} – the RFC / EI for the recovery is to be raised and linked on the Cost Recovery page.</p>`, `Without a Change Management entry yet: ${noLink.map((g) => `${g.contractor} (SAR ${formatMoney(g.totals.stillToRecover)})`).join("; ")} – the RFC / EI for the recovery is to be raised and linked on the Cost Recovery page.`);
  if (cus.noFigures.length) both(`<p style="font-size:12px;color:#555">${cus.noFigures.length} contract(s) are annotated on the tracker without customs figures yet: ${esc(cus.noFigures.map((r) => String(r.contract_code ?? r.vendor ?? "")).join(", "))}.</p>`, `(${cus.noFigures.length} contract(s) are annotated on the tracker without customs figures yet.)`);
  both(`<p>The attached cost recovery report carries the contractor tables and the declaration-by-declaration lists (Bayan number, port, broker, supplier, invoice, duty paid) behind these figures.</p>`, ["", "The attached cost recovery report carries the contractor tables and the declaration-by-declaration lists behind these figures."]);
  both(`<p>Kind regards,</p><p><b>${esc(sender.name)}</b><br>Commercial Management – ${esc(data.programme.name)} (${esc(data.programme.code)})</p>`, ["", "Kind regards,", sender.name, `Commercial Management – ${data.programme.name} (${data.programme.code})`]);
  html.push(`<p style="font-size:11px;color:#6b7280">Prepared with ${esc(APP_NAME)} from the customs recovery tracker as at ${esc(asOf)} and the Change Management Tracker.</p>`);
  return { subject, to: [], html: `<div style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#172033;line-height:1.45">${html.join("\n")}</div>`, text: text.join("\r\n"), fileBase: `Customs_Recovery_Management_Summary_${data.programme.code}` };
}

export type { RecordRow };
