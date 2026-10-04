import { getDb, getSetting, setSetting } from "../db";
import { logAudit } from "../audit";
import { formatDate, formatMoney, todayIso } from "../format";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * One-off repair (4 Oct 2026). A payment certificate letter read on its own gives this certificate's net,
 * and the cumulative certified is built as the previous certificate's cumulative plus that net. When the
 * earlier certificates came from the same pack's history in the same run, no previous figure was found
 * and the row's cumulative became the net alone (the Al Saad final certificate: 13.2M instead of
 * 547.4M). Runs once, on start: every row carrying that exact signature – a cumulative equal to the net
 * its own note states, below the previous certificate's cumulative – is set to previous + net, with an
 * audit entry and a note on the row.
 */
export function repairPaymentCumulatives(): void {
  const db = getDb();
  if (getSetting(db, "repaired_payment_cumulatives") === "1") return;
  try {
    const rows = db.prepare("SELECT id, contract_id, sr_no, application_no, month, ipc_date, application_date, cumulative_claimed, cumulative_certified, comments FROM payment_applications WHERE comments LIKE '%IPC net SAR%'").all() as { id: number; contract_id: number; sr_no: number | null; application_no: string | null; month: string | null; ipc_date: string | null; application_date: string | null; cumulative_claimed: number | null; cumulative_certified: number | null; comments: string | null }[];
    let fixed = 0;
    const tx = db.transaction(() => {
      for (const r of rows) {
        const net = Number((r.comments ?? "").match(/IPC net SAR ([\d,]+\.\d{2})/)?.[1]?.replace(/,/g, "") ?? NaN);
        if (!Number.isFinite(net) || net <= 0 || r.sr_no === null) continue;
        const prev = db.prepare("SELECT cumulative_certified, cumulative_claimed FROM payment_applications WHERE contract_id = ? AND sr_no < ? ORDER BY sr_no DESC LIMIT 1").get(r.contract_id, r.sr_no) as { cumulative_certified: number | null; cumulative_claimed: number | null } | undefined;
        const prevCum = Number(prev?.cumulative_certified ?? prev?.cumulative_claimed ?? 0) || 0;
        if (prevCum <= net) continue;
        const certifiedWrong = r.cumulative_certified !== null && Math.abs(Number(r.cumulative_certified) - net) < 0.5;
        const claimedWrong = r.cumulative_claimed !== null && Math.abs(Number(r.cumulative_claimed) - net) < 0.5;
        if (!certifiedWrong && !claimedWrong) continue;
        const cumulative = Math.round((prevCum + net) * 100) / 100;
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (certifiedWrong) changes.cumulative_certified = { from: r.cumulative_certified, to: cumulative };
        if (claimedWrong) changes.cumulative_claimed = { from: r.cumulative_claimed, to: cumulative };
        // the same reading took the month from a valuation month the letter quotes: a month more than half a
        // year before the certificate's own date is the letter's month instead
        const ipcDate = String(r.ipc_date ?? r.application_date ?? "").slice(0, 10);
        const m = String(r.month ?? "").match(/^([A-Za-z]{3})'(\d{2})$/);
        const mi = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
        const monthStart = mi >= 0 && m ? Date.UTC(2000 + Number(m[2]), mi, 1) : NaN;
        const letterMonth = /^\d{4}-\d{2}-\d{2}$/.test(ipcDate) ? `${MONTHS[Number(ipcDate.slice(5, 7)) - 1].replace(/^./, (c) => c.toUpperCase())}'${ipcDate.slice(2, 4)}` : null;
        const monthWrong = letterMonth !== null && Number.isFinite(monthStart) && Date.parse(`${ipcDate}T00:00:00Z`) - monthStart > 183 * 86400000;
        if (monthWrong) changes.month = { from: r.month, to: letterMonth };
        const note = `Corrected on ${formatDate(todayIso())}: the cumulative had been this IPC's net alone (${formatMoney(net)}); it is now the previous certificate's ${formatMoney(prevCum)} plus this IPC's ${formatMoney(net)} = ${formatMoney(cumulative)}.${monthWrong ? ` The month is the certificate's own (${letterMonth}), not the earlier valuation month the letter quotes (${r.month}).` : ""}`;
        db.prepare(`UPDATE payment_applications SET ${certifiedWrong ? "cumulative_certified = ?, " : ""}${claimedWrong ? "cumulative_claimed = ?, " : ""}${monthWrong ? "month = ?, " : ""}comments = ?, updated_at = ?, updated_by = 'system' WHERE id = ?`).run(...(certifiedWrong ? [cumulative] : []), ...(claimedWrong ? [cumulative] : []), ...(monthWrong ? [letterMonth] : []), [String(r.comments ?? "").trim(), note].filter(Boolean).join("\n"), new Date().toISOString(), r.id);
        logAudit(db, { registerKey: "payment_applications", recordId: r.id, action: "update", user: null, summary: `Corrected the cumulative of ${r.application_no ?? `application ${r.sr_no}`}: it had been this IPC's net alone`, changes });
        fixed++;
      }
    });
    tx();
    if (fixed) console.log(`[repair] payment cumulatives corrected on ${fixed} row(s)`);
    setSetting(db, "repaired_payment_cumulatives", "1");
  } catch (e) {
    console.error("[repair] payment cumulatives failed:", e);
  }
}
