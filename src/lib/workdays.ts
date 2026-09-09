import { toDate } from "./format";

/**
 * Business-day counting. Saudi working week: Sunday–Thursday (Friday and Saturday are the weekend).
 * Public holidays are not excluded.
 */
const WEEKEND_DAYS = [5, 6]; // JS getUTCDay(): 0 = Sunday ... 5 = Friday, 6 = Saturday

/** Business days strictly after `fromIso` up to and including `toIso`. Negative when `to` is before `from`. */
export function businessDaysBetween(fromIso: string, toIso: string): number | null {
  const from = toDate(fromIso);
  const to = toDate(toIso);
  if (!from || !to) return null;
  const sign = to >= from ? 1 : -1;
  const [a, b] = sign === 1 ? [from, to] : [to, from];
  let count = 0;
  const d = new Date(a.getTime());
  d.setUTCDate(d.getUTCDate() + 1);
  while (d <= b) {
    if (!WEEKEND_DAYS.includes(d.getUTCDay())) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count * sign;
}
