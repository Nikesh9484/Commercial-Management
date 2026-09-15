/**
 * One company, however it has been spelled. Kept in its own file with no imports at all, because the
 * browser needs it too – the bonds page groups its chase lists with it – and the register that works
 * out which contracts are closed sits next to the database, where the browser cannot follow.
 *
 * "Al Saad General Contracting Co. Ltd." and "Al Saad General Contracting Co.Ltd." land on the same
 * key, and so do "Sydney Seaplanes Asia Limited" and "Sydney Seaplanes Asia Limited.".
 */
export function contractorKey(name: unknown): string {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
