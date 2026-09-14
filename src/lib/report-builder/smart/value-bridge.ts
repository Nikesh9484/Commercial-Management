import { getDb } from "../../db";
import { getRegisterDef } from "../../registers";
import { recordsForView } from "../../view-mode";
import type { RecordRow } from "../../registers/types";
import { fieldsFrom, type SmartSource } from "./index";

/**
 * The bridge from what each contract was let for to what it is worth now, and what moved it:
 * approved variations, approved claims, and the final account adjustment (on a two-stage contract,
 * the Stage 2 remeasure against the Stage 1 price). Printed as a bridge it reads down – original
 * price, then each cause, then the revised price – which is how a price movement is normally
 * presented to a board.
 *
 * The causes are the ones the dashboard actually holds. A finer split (quantity, rate, design
 * development, scope gap, instructed scope) comes from a bill-by-bill analysis of the Stage 2 BOQ
 * and is not something the dashboard can derive; where that analysis exists it belongs in the
 * contract's notes.
 */

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const valueBridge: SmartSource = {
  id: "value_bridge",
  title: "Contract value bridge (original → revised)",
  description: "What each contract was let for, what moved it – approved variations, approved claims and the final account or Stage 2 remeasure adjustment – and what it is worth now, with the movement as a percentage of the original price.",
  suggestGroupBy: "direction",
  defaultColumns: ["contract_ref", "contractor", "original_value", "approved_vos", "approved_claims", "fa_adjustment", "revised_value", "movement", "movement_pct"],
  presets: [
    { id: "moved", label: "Contracts that moved", description: "Anything with a movement against the original price." },
    { id: "up10", label: "Up more than 10%", description: "The contracts that have grown materially." },
    { id: "stage2", label: "Two-stage conversions", description: "Contracts carrying a final account / Stage 2 adjustment." },
  ],

  fields: (rows) =>
    fieldsFrom(
      [
        { key: "contract_ref", label: "Contract", type: "text", inDefault: true },
        { key: "contractor", label: "Contractor / consultant", type: "text", inDefault: true },
        { key: "package", label: "Package", type: "text", inDefault: false },
        { key: "status", label: "Contract status", type: "select", inDefault: false },
        { key: "original_value", label: "Original contract price", type: "money", numeric: true, inDefault: true },
        { key: "approved_vos", label: "Approved variations", type: "money", numeric: true, inDefault: true },
        { key: "approved_claims", label: "Approved claims", type: "money", numeric: true, inDefault: true },
        { key: "fa_adjustment", label: "Final account / Stage 2 adjustment", type: "money", numeric: true, inDefault: true },
        { key: "revised_value", label: "Revised contract price", type: "money", numeric: true, inDefault: true },
        { key: "movement", label: "Net movement", type: "money", numeric: true, inDefault: true },
        { key: "movement_pct", label: "Movement % of original", type: "percent", numeric: true, inDefault: true },
        { key: "direction", label: "Direction", type: "select", inDefault: false },
        { key: "certified", label: "Certified to date", type: "money", numeric: true, inDefault: false },
        { key: "pct_certified", label: "% certified", type: "percent", numeric: true, inDefault: false },
        { key: "note", label: "Note", type: "text", inDefault: false, help: "Carries the Stage 2 conversion detail where the monthly workbook holds it." },
      ],
      rows,
    ),

  build: (programmeId) => {
    const db = getDb();
    const contracts = recordsForView(getRegisterDef("contracts")!, db).filter((r) => Number(r.programme_id) === programmeId);

    return contracts.map((c) => {
      const original = num(c.original_contract);
      const vos = num(c.approved_vos);
      const claims = num(c.approved_claims);
      const fa = num(c.final_account_adjustment);
      const revised = num(c.revised_contract_value);
      const movement = r2(revised - original);
      const pct = original !== 0 ? r2((movement / original) * 100) : null;
      return {
        id: Number(c.id),
        contract_ref: txt(c.cost_line_id__label) || txt(c.acc_ref) || txt(c.reef_po_no) || txt(c.title),
        contractor: txt(c.contractor_id__label),
        package: txt(c.package_id__label),
        status: txt(c.current_status),
        original_value: original,
        approved_vos: vos,
        approved_claims: claims,
        fa_adjustment: fa,
        revised_value: revised,
        movement,
        movement_pct: pct,
        direction: Math.abs(movement) < 0.5 ? "No movement" : movement > 0 ? "Increase" : "Decrease",
        certified: num(c.net_cum_certified),
        pct_certified: c.pct_certified === null || c.pct_certified === undefined ? null : Number(c.pct_certified),
        note: txt(c.notes),
        movement__tone: movement > 0.5 ? "red" : movement < -0.5 ? "green" : null,
      } as RecordRow;
    }).sort((a, b) => Math.abs(num(b.movement)) - Math.abs(num(a.movement)));
  },
};

/**
 * The bridge steps for a set of contracts – what a waterfall would draw. Anchored rows sit on the
 * baseline; the causes float between them.
 */
export function bridgeSteps(rows: RecordRow[]): { label: string; value: number; kind: "anchor" | "up" | "down" }[] {
  const sum = (k: string) => r2(rows.reduce((t, r) => t + num(r[k]), 0));
  const original = sum("original_value");
  const vos = sum("approved_vos");
  const claims = sum("approved_claims");
  const fa = sum("fa_adjustment");
  return [
    { label: "Original contract price", value: original, kind: "anchor" },
    { label: "Approved variations", value: vos, kind: vos >= 0 ? "up" : "down" },
    { label: "Approved claims", value: claims, kind: claims >= 0 ? "up" : "down" },
    { label: "Final account / Stage 2 adjustment", value: fa, kind: fa >= 0 ? "up" : "down" },
    { label: "Revised contract price", value: r2(original + vos + claims + fa), kind: "anchor" },
  ];
}
