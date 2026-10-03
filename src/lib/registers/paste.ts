import type { RegisterDef, UserInfo } from "./types";
import { createRecord, listRecords, ValidationError } from "./engine";

export interface PasteResult {
  created: number;
  skipped: number;
  /** Column headings in the pasted text that matched a field of this register. */
  matched: string[];
  /** Headings that matched nothing and were ignored. */
  ignored: string[];
  /** References changed to keep them unique ("EW-1" → "EW-1 (copy)"). */
  renamed: string[];
  errors: { row: number; message: string }[];
}

/** Splits text copied from a dashboard table or from Excel into cells: one row per line, tab-separated (or ; / , when no tab is present). */
export function splitPasted(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : lines.some((l) => l.includes(";")) ? ";" : ",";
  return lines.map((l) => l.split(sep).map((c) => c.replace(/^"([\s\S]*)"$/, "$1").trim()));
}

/**
 * Adds the rows pasted from another tracker (or from Excel) to a register. The first line is the
 * heading row: columns are matched to fields by their heading (label or key); anything else is
 * ignored, the ID included, so every pasted row becomes a new entry. A reference that already exists
 * in this project (the item number, the EW number…) gets "(copy)" added so the row still goes in.
 */
export function pasteRows(def: RegisterDef, text: string, user: UserInfo): PasteResult {
  const grid = splitPasted(text);
  if (grid.length < 2) throw new ValidationError("Paste at least a heading row and one row of values.");
  const fieldOf = (h: string) => {
    const k = h.trim().toLowerCase().replace(/\s+/g, " ");
    if (!k || k === "id") return null;
    return def.fields.find((f) => f.label.toLowerCase() === k || f.key.toLowerCase() === k || f.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === k.replace(/[^a-z0-9]+/g, " ").trim()) ?? null;
  };
  // the heading row is the first line where at least one cell names a field
  const headerAt = grid.findIndex((row) => row.some((h) => fieldOf(h)));
  if (headerAt < 0) {
    const labels = def.fields.filter((f) => !f.hideInForm && !f.readonly && !f.virtual).slice(0, 6).map((f) => f.label).join(", ");
    throw new ValidationError(`No column headings recognised. Copy the rows together with their heading row – the headings of this tracker are ${labels}…`);
  }
  // lines above the heading (a title band) are ignored
  const header = grid[headerAt];
  const cols = header.map((h) => ({ heading: h, field: fieldOf(h) }));
  const matched = cols.filter((c) => c.field).map((c) => c.heading);
  const ignored = cols.filter((c) => !c.field && c.heading).map((c) => c.heading);
  if (!matched.length) throw new ValidationError("None of the pasted headings match this tracker's columns.");

  // what is already there, per unique field, so a copy of an existing row keeps its own reference
  const uniques = def.fields.filter((f) => f.unique && (f.type === "text" || f.type === "textarea"));
  const taken = new Map<string, Set<string>>();
  if (uniques.length) {
    const rows = listRecords(def);
    for (const f of uniques) taken.set(f.key, new Set(rows.map((r) => String(r[f.key] ?? "").trim().toLowerCase()).filter(Boolean)));
  }
  const result: PasteResult = { created: 0, skipped: 0, matched, ignored, renamed: [], errors: [] };
  for (let i = headerAt + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (/^total\b/i.test(String(cells[0] ?? ""))) continue;
    const input: Record<string, unknown> = {};
    let any = false;
    cols.forEach((c, j) => {
      if (!c.field || c.field.readonly || c.field.virtual || c.field.hideInForm) return;
      const raw = String(cells[j] ?? "").trim();
      const v = raw === "—" || raw === "–" || raw === "-" ? "" : raw;
      if (v !== "") any = true;
      input[c.field.key] = v;
    });
    if (!any) {
      result.skipped++;
      continue;
    }
    for (const f of uniques) {
      const v = String(input[f.key] ?? "").trim();
      if (!v) continue;
      const set = taken.get(f.key)!;
      let candidate = v;
      let n = 1;
      while (set.has(candidate.toLowerCase())) {
        n++;
        candidate = n === 2 ? `${v} (copy)` : `${v} (copy ${n - 1})`;
      }
      if (candidate !== v) {
        input[f.key] = candidate;
        result.renamed.push(`${v} → ${candidate}`);
      }
      set.add(candidate.toLowerCase());
    }
    try {
      createRecord(def, input, user);
      result.created++;
    } catch (e) {
      const msg = e instanceof ValidationError ? `${e.message}${e.fieldErrors ? " " + Object.values(e.fieldErrors).join(" ") : ""}` : e instanceof Error ? e.message : String(e);
      result.errors.push({ row: i + 1, message: msg });
    }
  }
  return result;
}
