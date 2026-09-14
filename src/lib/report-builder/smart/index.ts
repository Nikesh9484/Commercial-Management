import type { RecordRow } from "../../registers/types";
import type { SourceField } from "../types";
import { paymentsDue } from "./payments-due";
import { eotTracker } from "./eot-tracker";
import { attention } from "./attention";
import { scorecard } from "./scorecard";
import { valueBridge } from "./value-bridge";

/**
 * A "smart report" is a purpose-built set of rows worked out across several registers – the kind of
 * thing a commercial manager keeps in a side spreadsheet. Each one behaves like any other source in
 * the builder: it hands back rows and field descriptions, and every column can then be filtered,
 * grouped, sorted and printed.
 */
export interface SmartSource {
  id: string;
  title: string;
  description: string;
  /** Date column the ageing block counts against. */
  ageField?: string;
  ageMode?: "due" | "since";
  /** The columns this report starts with – overrides the generic "first nine" rule. */
  defaultColumns?: string[];
  suggestGroupBy?: string;
  presets?: { id: string; label: string; description: string }[];
  fields: (rows: RecordRow[]) => SourceField[];
  build: (programmeId: number) => RecordRow[];
}

export const SMART_SOURCES: SmartSource[] = [paymentsDue, eotTracker, attention, scorecard, valueBridge];

/** Helper for the smart sources: turns a column list into SourceFields, filling the tick-lists. */
export function fieldsFrom(cols: { key: string; label: string; type: SourceField["type"]; numeric?: boolean; inDefault?: boolean; help?: string }[], rows: RecordRow[]): SourceField[] {
  return cols.map((c) => {
    let options: string[] | undefined;
    if (c.type === "select" || c.type === "text") {
      const seen = new Set<string>();
      for (const r of rows) {
        const v = r[c.key];
        if (v === null || v === undefined || v === "") continue;
        seen.add(String(v));
        if (seen.size > 40) break;
      }
      if (seen.size && seen.size <= 40) options = [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return { ...c, options };
  });
}
