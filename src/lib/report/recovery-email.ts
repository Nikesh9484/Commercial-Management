import type { ReportData } from "./data";
import type { EmailSummary } from "./email";
import { getAccommodationSummary } from "../recovery/summary";
import { formatDate, formatMoney } from "../format";
import { APP_NAME } from "../brand";

/**
 * The one-click chase email for a contractor's accommodation charges: the position from the
 * construction village invoice tracker (invoiced, paid or recovered, outstanding, withheld) and the
 * request to settle, with a note that the balance is otherwise deducted from the next payment
 * certificate. One email per contractor; every contractor with an outstanding balance when none is
 * named.
 */
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildAccommodationEmail(data: ReportData, sender: { name: string; email?: string }, contractor?: string | null): EmailSummary {
  const acc = getAccommodationSummary(data.recovery.accommodation);
  const groups = contractor ? acc.byContractor.filter((c) => c.contractor === contractor) : acc.byContractor.filter((c) => c.totals.outstanding > 0.5);
  const one = groups.length === 1 ? groups[0] : null;
  const asOf = acc.asOf ? formatDate(acc.asOf) : "the latest tracker";
  const totals = groups.reduce((t, g) => ({ invoiced: t.invoiced + g.totals.invoiced, received: t.received + g.totals.received, outstanding: t.outstanding + g.totals.outstanding, withheld: t.withheld + g.totals.withheld }), { invoiced: 0, received: 0, outstanding: 0, withheld: 0 });
  const subject = one
    ? `${data.programme.name} (${data.programme.code}) – Construction Village accommodation charges – outstanding balance SAR ${formatMoney(one.totals.outstanding)} – ${one.contractor}`
    : `${data.programme.name} (${data.programme.code}) – Construction Village accommodation charges – outstanding balances as of ${asOf}`;
  const td = 'style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px"';
  const tdr = 'style="padding:4px 10px;border:1px solid #dfe5ee;font-size:12px;text-align:right;font-family:Consolas,monospace"';
  const rowsHtml = groups
    .flatMap((g) => g.rows)
    .map((r) => `<tr><td ${td}>${esc(r.tracker_name)}</td><td ${td}>${esc(r.asset_ref ?? "")}</td><td ${tdr}>${formatMoney(Number(r.invoiced_gross ?? 0))}</td><td ${tdr}>${formatMoney(Number(r.received_total ?? 0))}</td><td ${tdr}>${formatMoney(Number(r.withheld_in_ipc ?? 0))}</td><td ${tdr}><b>${formatMoney(Number(r.outstanding ?? 0))}</b></td></tr>`)
    .join("");
  const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#172033;line-height:1.45">
<p>Dear ${esc(one ? one.contractor : "Sir / Madam")},</p>
<p><b>Subject: ${esc(subject)}</b></p>
<p>Further to the lease agreement for staff accommodation at the AMAALA Construction Village, the invoices issued by Finance for the accommodation charges under your contract stand as follows as of ${esc(asOf)}:</p>
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:560px">
<tr><th ${td}>Lease agreement</th><th ${td}>Asset</th><th ${td}>Invoiced to date (incl. VAT)</th><th ${td}>Paid / recovered</th><th ${td}>Withheld under IPC</th><th ${td}>Outstanding</th></tr>
${rowsHtml}
<tr><td ${td} colspan="2"><b>Total</b></td><td ${tdr}><b>${formatMoney(totals.invoiced)}</b></td><td ${tdr}><b>${formatMoney(totals.received)}</b></td><td ${tdr}><b>${formatMoney(totals.withheld)}</b></td><td ${tdr}><b>${formatMoney(totals.outstanding)}</b></td></tr>
</table>
<p>The outstanding balance of <b>SAR ${formatMoney(totals.outstanding)}</b> is now due. Please arrange settlement within 14 days of this notice and share the remittance advice with the undersigned and Finance so that the receipt is recorded against the invoices listed above.</p>
<p>Please note that, in line with the lease agreement and the Contract, any balance that remains unsettled will be withheld from your next interim payment certificate and recovered by contra-charge, and any balance still open at final account will be settled within the Final Account Statement.</p>
<p>Should any of the invoices be disputed, please let us have the invoice references and the grounds within 7 days so that they can be reviewed with Finance.</p>
<p>Kind regards,</p>
<p><b>${esc(sender.name)}</b><br>Commercial Management – ${esc(data.programme.name)} (${esc(data.programme.code)})</p>
<p style="font-size:11px;color:#6b7280">Prepared with ${esc(APP_NAME)} from the accommodation invoice tracker as of ${esc(asOf)}.</p>
</div>`;
  const lines = [
    `Dear ${one ? one.contractor : "Sir / Madam"},`,
    "",
    `Subject: ${subject}`,
    "",
    `Further to the lease agreement for staff accommodation at the AMAALA Construction Village, the invoices issued by Finance for the accommodation charges under your contract stand as follows as of ${asOf}:`,
    "",
    ...groups.flatMap((g) => g.rows).map((r) => `  - ${String(r.tracker_name)}${r.asset_ref ? ` (${String(r.asset_ref)})` : ""}: invoiced ${formatMoney(Number(r.invoiced_gross ?? 0))}, paid / recovered ${formatMoney(Number(r.received_total ?? 0))}, withheld under IPC ${formatMoney(Number(r.withheld_in_ipc ?? 0))}, outstanding ${formatMoney(Number(r.outstanding ?? 0))}`),
    `  Total: invoiced ${formatMoney(totals.invoiced)}, paid / recovered ${formatMoney(totals.received)}, withheld ${formatMoney(totals.withheld)}, outstanding ${formatMoney(totals.outstanding)}`,
    "",
    `The outstanding balance of SAR ${formatMoney(totals.outstanding)} is now due. Please arrange settlement within 14 days of this notice and share the remittance advice with the undersigned and Finance so that the receipt is recorded against the invoices listed above.`,
    "",
    "Please note that, in line with the lease agreement and the Contract, any balance that remains unsettled will be withheld from your next interim payment certificate and recovered by contra-charge, and any balance still open at final account will be settled within the Final Account Statement.",
    "",
    "Should any of the invoices be disputed, please let us have the invoice references and the grounds within 7 days so that they can be reviewed with Finance.",
    "",
    "Kind regards,",
    sender.name,
    `Commercial Management – ${data.programme.name} (${data.programme.code})`,
  ];
  const tag = one ? one.contractor.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) : "All";
  return { subject, to: [], html, text: lines.join("\r\n"), fileBase: `Accommodation_Charges_${tag}_${data.programme.code}` };
}
