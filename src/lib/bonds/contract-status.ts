/**
 * Only a contract the register says is open is open: "Open" on the Final Account Status, "Active" in
 * Payment Tracking. Anything else – closed, signed, not required, direct payment, completed,
 * terminated, suspended, or wording of the workbook's own – means the contract is finished as far as
 * its bonds and insurances are concerned. Kept free of any database import so the workbook
 * converters can share it.
 */
export function contractIsOpen(status: unknown): boolean {
  return /^\s*(open|active|ongoing|live|in progress)/i.test(String(status ?? ""));
}

/**
 * The register status for a Final Account Status cell in a monthly workbook. Only a cell that says
 * "Open" (or "Ongoing", "Active") is open – a blank cell too, since nothing has been said about it –
 * and the workbook's other wordings ("FAS Signed", "Closed", "Completed") are all closed.
 */
export function faStatusFromExcel(text: unknown): "Open" | "Closed" | "Not Required" | "Direct Payment – No FA" {
  const st = String(text ?? "").trim().toLowerCase();
  if (!st || contractIsOpen(st)) return "Open";
  if (st.startsWith("not req")) return "Not Required";
  if (st.startsWith("no fa") || st.startsWith("direct")) return "Direct Payment – No FA";
  return "Closed";
}
