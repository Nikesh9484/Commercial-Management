/**
 * One palette for every table whose columns fall into groups – a register's form headings, the cost
 * report's committed / uncommitted blocks, the Aconex check's figures – so a run of columns reads at a
 * glance as one group. Header, band above it and cells each get a shade of the group's colour.
 */
export const GROUP_PALETTE: { th: string; td: string; band: string }[] = [
  { th: "bg-none! bg-sky-100!", td: "bg-sky-50/60", band: "bg-sky-200/80 text-sky-900" },
  { th: "bg-none! bg-amber-100!", td: "bg-amber-50/60", band: "bg-amber-200/80 text-amber-900" },
  { th: "bg-none! bg-emerald-100!", td: "bg-emerald-50/60", band: "bg-emerald-200/80 text-emerald-900" },
  { th: "bg-none! bg-violet-100!", td: "bg-violet-50/60", band: "bg-violet-200/80 text-violet-900" },
  { th: "bg-none! bg-rose-100!", td: "bg-rose-50/60", band: "bg-rose-200/80 text-rose-900" },
  { th: "bg-none! bg-teal-100!", td: "bg-teal-50/60", band: "bg-teal-200/80 text-teal-900" },
  { th: "bg-none! bg-orange-100!", td: "bg-orange-50/60", band: "bg-orange-200/80 text-orange-900" },
  { th: "bg-none! bg-indigo-100!", td: "bg-indigo-50/60", band: "bg-indigo-200/80 text-indigo-900" },
  { th: "bg-none! bg-lime-100!", td: "bg-lime-50/60", band: "bg-lime-200/80 text-lime-900" },
  { th: "bg-none! bg-fuchsia-100!", td: "bg-fuchsia-50/60", band: "bg-fuchsia-200/80 text-fuchsia-900" },
  { th: "bg-none! bg-cyan-100!", td: "bg-cyan-50/60", band: "bg-cyan-200/80 text-cyan-900" },
  { th: "bg-none! bg-stone-200!", td: "bg-stone-100/60", band: "bg-stone-300/80 text-stone-900" },
];

/** the colour of the i-th group of a table */
export function groupTint(i: number): { th: string; td: string; band: string } {
  return GROUP_PALETTE[((i % GROUP_PALETTE.length) + GROUP_PALETTE.length) % GROUP_PALETTE.length];
}
