import { toDate } from "../format";

export function daysBetween(fromIso: string, toIso: string): number {
  const a = toDate(fromIso);
  const b = toDate(toIso);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
