/**
 * The contract codes of the Aconex Cost check – shared by the converter (server) and the check's page
 * (browser), so this module depends on nothing.
 */
/**
 * Payments RSG makes straight to a vendor on behalf of the main contractor: Aconex opens one WBS row per
 * vendor and month ("FOM - (Mar) Direct Payment on Behalf of Saudi Arabian Baytur", 003C100 …), the cost
 * report keeps them as its own "Direct Payment – Prelims / Works" lines, one per vendor. Neither side's
 * codes meet the other's, so they are compared as one group.
 */
export const DIRECT_PAYMENT = /direct\s*(payment|works)|payment\s+on\s+behalf/i;

/**
 * The contract code in a WBS or cost report code, with the section it sits in where the code carries one:
 * "1TB01003.01.MS.003F02" and "MS.003F02" → key MS.003F02, "CN.031C02-10" → CN.031C02, "031C15" → 031C15.
 * The same contract code can occur under two sections (MS.003F02 Khatib & Alami, FFEOSE.003F02 loose
 * FF&E), so the section is part of the key; the bare code is kept for codes without a section.
 */
export function contractKey(code: unknown): { frag: string; key: string; section: string | null } | null {
  const m = String(code ?? "").toUpperCase().match(/(?:\b([A-Z&]{2,6})\.)?\b(\d{3}[A-Z]\d{2,3})\b/);
  if (!m) return null;
  return { frag: m[2], key: m[1] ? `${m[1]}.${m[2]}` : m[2], section: m[1] ?? null };
}
export function isDirectPaymentLine(code: unknown, name: unknown): boolean {
  return DIRECT_PAYMENT.test(String(code ?? "")) || DIRECT_PAYMENT.test(String(name ?? ""));
}

