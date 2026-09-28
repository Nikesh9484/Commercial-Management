/**
 * Whether a claim is still being worked. Import-free so the page's filters, the register and the
 * reports all decide it the same way.
 */
export function claimIsOpen(row: Record<string, unknown>): boolean {
  const status = String(row.status ?? "");
  const withWhom = String(row.action_with ?? "").trim().toLowerCase();
  if (status === "Rejected") return false;
  if (withWhom === "closed") return false;
  // pending, or approved on paper but still sitting with somebody on the tracker
  return status === "Pending" || withWhom !== "";
}

/**
 * Pending on the dashboard, but the Claims Tracker says it is closed. One of the two is out of date,
 * and until it is resolved the claim is counted as open exposure in every report.
 */
export function statusOutOfStep(row: Record<string, unknown>): boolean {
  return String(row.status ?? "") === "Pending" && String(row.action_with ?? "").trim().toLowerCase() === "closed";
}
