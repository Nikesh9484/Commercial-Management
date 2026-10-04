import { getDb, getSetting, setSetting } from "../db";
import { getRegisterDef } from "../registers";
import { updateRecord } from "../registers/engine";
import type { RecordRow } from "../registers/types";
import { syncFinalAccounts } from "../final-accounts/adjustment";

/**
 * One-off (4 Oct 2026): the Final Account statements already filed in the Contract Library are read again
 * for the statement's breakdown – construction work price, provisional sums, carried from variation orders,
 * omissions, claims, negotiation adjustment – and the figures go on the contract's Final Account Status
 * row where it still lacks them. The omissions and the negotiation adjustment then drive the Final Account
 * change the dashboard keeps in Change Management (column H, the Level 2 report, the Excel report, Aconex).
 */
const MONEY = String.raw`\(?-?[\d,]{1,}\.\d{2}\)?`;
const money = (t: string) => {
  const neg = t.startsWith("(") || t.startsWith("-");
  const v = Number(t.replace(/[(),-]/g, ""));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
};
const after = (text: string, label: RegExp) => {
  const m = new RegExp(`${label.source}\\s*:?\\s*(${MONEY})`, "i").exec(text);
  return m ? money(m[1]) : null;
};

export function readStatementBreakdown(text: string): Record<string, number | null> {
  const form = text.slice(0, 20_000);
  return {
    fa_construction_price: after(form, /Construction\s*Works?\s*Price/),
    fa_provisional_sums: after(form, /Provisional\s*Sums?\s*Price/) ?? after(form, /Optional\s*(?:Marine\s*)?Works?\s*Price/),
    fa_variation_orders: after(form, /Carried\s*from\s*Variation\s*Orders?/),
    fa_omissions: after(form, /Carried\s*from\s*Omissions?/),
    fa_claims: after(form, /Carried\s*from\s*Claims?/),
    fa_negotiation: after(form, /\bOthers?\s*[–-]?\s*Negotiation\s*Adjustments?/) ?? after(form, /Negotiation\s*Adjustments?/),
    final_contract_price: after(form, /Final\s*Contract\s*Price/),
  };
}

const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
/**
 * Closed contracts whose final figure is known from outside the dashboard's own documents (handed over 4 Oct 2026):
 * the Five Oceans coral relocation (031C05) closed on its final Aconex Cost payment certificate, and the two
 * Al Rajhi Takaful insurance contracts (031C16 CAR, 031C17 OCIP) paid by Head Office at their contract value.
 */
const KNOWN_FINAL_CERTIFICATES: { programme: string; acc: string; price: number; date: string | null; ref: string; settledBy: string; note: string }[] = [
  { programme: "1TB01031", acc: "031C05", price: 5618903.0, date: "2023-11-21", ref: "Payment Certificate# 20 – invoice 031C05-PC-51", settledBy: "Final account settlement", note: "Closed on the final payment certificate (Payment Certificate# 20, invoice 031C05-PC-51 of 21-Nov-23, budget fully spent): certified to date 5,618,903.00" },
  { programme: "1TB01031", acc: "031C16", price: 460420.44, date: null, ref: "", settledBy: "Head Office", note: "Paid by Head Office at the contract value 460,420.44 (CAR insurance, Al Rajhi Takaful)" },
  { programme: "1TB01031", acc: "031C17", price: 201748.63, date: null, ref: "", settledBy: "Head Office", note: "Paid by Head Office at the contract value 201,748.63 (OCIP insurance, Al Rajhi Takaful)" },
];

export function repairFinalAccountBreakdown(): void {
  const db = getDb();
  if (getSetting(db, "repaired_fa_breakdown") === "1") return;
  try {
    const def = getRegisterDef("final_accounts");
    const faCols = new Set((db.prepare('PRAGMA table_info("final_accounts")').all() as { name: string }[]).map((c) => c.name));
    if (!def || !faCols.has("fa_omissions")) return;
    const docs = db.prepare("SELECT id, programme_id, contract_id, contract_code, name, text FROM library_docs WHERE library = 'contract' AND doc_type LIKE 'Final Account%' AND text LIKE '%Final Contract Price%'").all() as { id: number; programme_id: number; contract_id: number | null; contract_code: string | null; name: string; text: string }[];
    const fas = db.prepare("SELECT * FROM final_accounts").all() as RecordRow[];
    const frag = (s: unknown) => String(s ?? "").match(/\b(\d{3}[A-Z]\d{2})\b/)?.[1]?.toUpperCase() ?? null;
    let filled = 0;
    for (const d of docs) {
      const b = readStatementBreakdown(d.text);
      if (!Object.values(b).some((v) => v !== null)) continue;
      const f = frag(d.contract_code) ?? frag(d.name);
      const fa = fas.find((r) => Number(r.programme_id) === Number(d.programme_id) && ((d.contract_id && Number(r.contract_id) === Number(d.contract_id)) || (f && frag(r.acc_ref) === f)));
      if (!fa) continue;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(b)) if (v !== null && (fa[k] === null || fa[k] === undefined || fa[k] === "" || Number(fa[k]) === 0)) patch[k] = v;
      if (!Object.keys(patch).length) continue;
      patch.comments = [String(fa.comments ?? "").trim(), `Statement breakdown read from ${d.name} on start-up (4 Oct 2026): ${Object.entries(patch).filter(([k]) => k !== "comments").map(([k, v]) => `${k.replace("fa_", "").replace(/_/g, " ")} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`).join(", ")}.`].filter(Boolean).join("\n");
      updateRecord(def, Number(fa.id), patch, { id: 0, name: "system", email: "", role: "admin" } as never, "import", { bypassRoles: true });
      filled++;
    }
    // the contracts closed on a figure handed over outside the library (see KNOWN_FINAL_CERTIFICATES)
    for (const k of KNOWN_FINAL_CERTIFICATES) {
      const fa = fas.find((r) => String(r.acc_ref ?? "").toUpperCase().endsWith(k.acc) && !n(r.final_contract_price));
      if (!fa) continue;
      const programme = db.prepare("SELECT code FROM programmes WHERE id = ?").get(Number(fa.programme_id)) as { code: string } | undefined;
      if (!programme || !String(programme.code ?? "").includes(k.programme)) continue;
      const patch: Record<string, unknown> = { final_contract_price: k.price, status: "Closed", settled_by: k.settledBy };
      if (!fa.closed_date && k.date) patch.closed_date = k.date;
      if (!fa.fa_statement_ref && k.ref) patch.fa_statement_ref = k.ref;
      patch.comments = [String(fa.comments ?? "").trim(), `${k.note} – entered on start-up (4 Oct 2026).`].filter(Boolean).join("\n");
      updateRecord(def, Number(fa.id), patch, { id: 0, name: "system", email: "", role: "admin" } as never, "import", { bypassRoles: true });
      filled++;
    }
    if (filled) console.log(`[repair] final account breakdown filled on ${filled} row(s)`);
    syncFinalAccounts(db);
    setSetting(db, "repaired_fa_breakdown", "1");
  } catch (e) {
    console.error("[repair] final account breakdown failed:", e);
  }
}
