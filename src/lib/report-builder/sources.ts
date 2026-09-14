import { allRegisters, getRegisterDef } from "../registers";
import { recordsForView } from "../view-mode";
import type { RecordRow, RegisterDef } from "../registers/types";
import type { SourceField, SourceInfo } from "./types";
import { SMART_SOURCES } from "./smart";

/**
 * What the builder can report on: every register the project keeps, plus the purpose-built "smart"
 * reports. A source hands back its rows and a description of every field, so the builder page can
 * offer a filter on each one without knowing anything about the register itself.
 */

export interface LoadedSource {
  info: SourceInfo;
  fields: SourceField[];
  rows: RecordRow[];
  /** The source's own starting column set, when it names one. */
  defaults?: string[];
}

/** Registers that are reference data rather than something you would report on. */
const SKIP = new Set(["users", "programmes", "assets", "clients", "locations", "packages", "contractors", "bond_types", "reporting_periods"]);

/** A sensible ageing field per register – the date the report counts days against. */
const AGE_FIELD: Record<string, string> = {
  changes: "date_raised",
  claims: "date_submitted",
  early_warnings: "date_raised",
  bonds: "expiry_date",
  payment_applications: "application_date",
  final_accounts: "forecast_closure_date",
  budget_transfers: "date",
  actions: "due_date",
  risks: "date_raised",
};

/** Whether the register's ageing date is something that falls due, or a date something last happened. */
const AGE_MODE: Record<string, "due" | "since"> = {
  changes: "since",
  claims: "since",
  early_warnings: "since",
  payment_applications: "since",
  budget_transfers: "since",
  risks: "since",
  bonds: "due",
  final_accounts: "due",
  actions: "due",
};

const GROUP_BY: Record<string, string> = {
  changes: "overall_status_id",
  claims: "status",
  early_warnings: "status",
  bonds: "type_id",
  contracts: "current_status",
  payment_applications: "contract_id",
  cost_lines: "category_id",
  provisional_sums: "status_id",
  final_accounts: "status",
  budget_transfers: "status",
  risks: "status",
};

function registerFields(def: RegisterDef, rows: RecordRow[]): SourceField[] {
  const out: SourceField[] = [];
  for (const f of def.fields) {
    if (f.type === "password") continue;
    if (f.key === "programme_id") continue;
    const numeric = f.type === "money" || f.type === "number" || f.type === "percent";
    let options: string[] | undefined = f.options ? [...f.options] : undefined;
    if (!options && (f.type === "lookup" || f.type === "text" || f.type === "select")) {
      // offer the values actually present as a tick-list, so every column can be filtered by choosing
      const seen = new Set<string>();
      for (const r of rows) {
        const v = f.type === "lookup" ? r[`${f.key}__label`] : r[f.key];
        if (v === null || v === undefined || v === "") continue;
        seen.add(String(v));
        if (seen.size > 40) break;
      }
      if (seen.size && seen.size <= 40) options = [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    out.push({ key: f.key, label: f.label, type: f.type, options, numeric, inDefault: !f.hideInTable, section: f.section, help: f.help });
  }
  return out;
}

function registerInfo(def: RegisterDef, fields: SourceField[]): SourceInfo {
  return {
    id: def.key,
    title: def.title,
    description: def.description ?? "",
    group: "Registers",
    ageField: AGE_FIELD[def.key],
    ageMode: AGE_MODE[def.key] ?? "due",
    suggestGroupBy: GROUP_BY[def.key],
    fields,
    presets: presetsFor(def.key),
  };
}

/** One-click starting points offered next to each register. */
function presetsFor(key: string): { id: string; label: string; description: string }[] {
  switch (key) {
    case "bonds":
      return [
        { id: "expired", label: "Expired", description: "Past the expiry date on a live contract." },
        { id: "expiring30", label: "Expiring within 30 days", description: "Renewal needed this month." },
        { id: "shortfall", label: "Below the contract requirement", description: "Cover provided is short." },
      ];
    case "changes":
      return [
        { id: "open", label: "Open changes", description: "Not approved, rejected or cancelled." },
        { id: "stale60", label: "No movement in 60 days", description: "Raised over 60 days ago and still open." },
        { id: "big", label: "Over SAR 1m", description: "The changes worth arguing about." },
      ];
    case "claims":
      return [
        { id: "open", label: "Open claims", description: "Still to be determined." },
        { id: "disputed", label: "Disputed / NOD", description: "Rejections, notices of dissatisfaction and disputes." },
      ];
    case "payment_applications":
      return [
        { id: "unpaid", label: "Certified but unpaid", description: "Certified with no payment date." },
        { id: "late", label: "Paid late", description: "Payment made after the contractual date." },
        { id: "uncertified", label: "Applied, not certified", description: "Waiting on an IPC." },
      ];
    case "early_warnings":
      return [
        { id: "open", label: "Open early warnings", description: "Still live." },
        { id: "costly", label: "Over SAR 500k", description: "The ones that move the forecast." },
      ];
    case "final_accounts":
      return [{ id: "open", label: "Open final accounts", description: "Not yet closed or agreed." }];
    case "contracts":
      return [
        { id: "active", label: "Active contracts", description: "Not closed." },
        { id: "nearly", label: "Over 90% certified", description: "Approaching the final account." },
      ];
    default:
      return [];
  }
}

/** Every source the builder offers, without loading any rows. */
export function listSources(): { id: string; title: string; description: string; group: string }[] {
  const regs = allRegisters
    .filter((d) => !SKIP.has(d.key) && d.scope === "programme")
    .map((d) => ({ id: d.key, title: d.title, description: d.description ?? "", group: "Registers" }));
  const smart = SMART_SOURCES.map((s) => ({ id: s.id, title: s.title, description: s.description, group: "Smart reports" }));
  return [...smart, ...regs];
}

/** Loads a source's rows and field descriptions. */
export function loadSource(id: string, programmeId: number): LoadedSource {
  const smart = SMART_SOURCES.find((s) => s.id === id);
  if (smart) {
    const rows = smart.build(programmeId);
    const fields = smart.fields(rows);
    return { info: { id: smart.id, title: smart.title, description: smart.description, group: "Smart reports", ageField: smart.ageField, ageMode: smart.ageMode, suggestGroupBy: smart.suggestGroupBy, fields, presets: smart.presets ?? [] }, fields, rows, defaults: smart.defaultColumns };
  }
  const def = getRegisterDef(id);
  if (!def || SKIP.has(def.key)) throw new Error(`Unknown report source "${id}".`);
  // recordsForView reads the period from the top bar; the programme is pinned here so the caller's
  // choice always wins, whatever the stored context happens to say
  const rows = recordsForView(def).filter((r) => r.programme_id === undefined || Number(r.programme_id) === programmeId);
  const fields = registerFields(def, rows);
  return { info: registerInfo(def, fields), fields, rows };
}

/** The columns a source starts with when the user has not chosen any. */
export function defaultColumns(fields: SourceField[], max = 9): string[] {
  const picked = fields.filter((f) => f.inDefault !== false && f.type !== "textarea").map((f) => f.key);
  return picked.slice(0, max);
}
