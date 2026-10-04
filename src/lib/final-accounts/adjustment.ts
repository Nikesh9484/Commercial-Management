import type Database from "better-sqlite3";
import { getRegisterDef } from "../registers";
import { createRecord, deleteRecord, updateRecord } from "../registers/engine";
import type { RecordRow, UserInfo } from "../registers/types";
import { formatDate, formatMoney, nowIso, todayIso } from "../format";
import { computeContracts } from "../payments/compute";

/**
 * The final account statement's omission – "Carried from Omissions" on the Financial Account Statement
 * Form – is not a variation order, yet it belongs in column H so the cost report, the Excel report in the
 * project's own layout and Aconex agree (Aconex carries it inside the contract's approved changes). It is
 * entered once, on the contract's Final Account row, and the dashboard keeps one Change Management entry
 * in step with it: category Final Account, DVO approved for the statement's amount, on the final account's
 * cost report line. The entry follows the figure (amount, line, contractor) and goes when it is cleared.
 * The negotiation adjustment is recorded for information only: the statement's approved variations
 * already carry it.
 */
const SYSTEM: UserInfo = {
  id: 0,
  name: "system",
  email: "",
  role: "admin",
} as UserInfo;
const r2 = (x: number) => Math.round(x * 100) / 100;
const n = (v: unknown) =>
  v === null || v === undefined || v === "" ? 0 : Number(v) || 0;

function statusId(db: Database.Database, name: string): number | null {
  return (
    (
      db
        .prepare(
          "SELECT id FROM approval_statuses WHERE name = ? COLLATE NOCASE",
        )
        .get(name) as { id: number } | undefined
    )?.id ?? null
  );
}

function categoryId(db: Database.Database): number {
  const hit = db
    .prepare(
      "SELECT id FROM change_categories WHERE name LIKE 'Final Account%' COLLATE NOCASE ORDER BY id LIMIT 1",
    )
    .get() as { id: number } | undefined;
  if (hit) return hit.id;
  const stamp = nowIso();
  const max = (
    db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), 0) AS m FROM change_categories",
      )
      .get() as { m: number }
  ).m;
  return Number(
    db
      .prepare(
        "INSERT INTO change_categories(name, sort_order, active, created_at, created_by, updated_at, updated_by) VALUES('Final Account', ?, 1, ?, 'system', ?, 'system')",
      )
      .run(max + 10, stamp, stamp).lastInsertRowid,
  );
}

/** the next item number the way this project's register numbers its changes (CH-146, or CH-031C02-12 per package) */
function nextItemNo(
  db: Database.Database,
  programmeId: number,
  frag: string | null,
): string {
  const rows = db
    .prepare("SELECT item_no FROM changes WHERE programme_id = ?")
    .all(programmeId) as { item_no: string | null }[];
  const perPackage = rows.some((r) =>
    /^CH-\d{3}[A-Z]\d{2}-/i.test(String(r.item_no ?? "")),
  );
  if (perPackage && frag) {
    const used = rows.map((r) =>
      Number(
        String(r.item_no ?? "").match(
          new RegExp(`^CH-${frag}-(\\d+)$`, "i"),
        )?.[1] ?? 0,
      ),
    );
    return `CH-${frag}-${Math.max(0, ...used) + 1}`;
  }
  const used = rows.map((r) =>
    Number(String(r.item_no ?? "").match(/^CH-(\d+)$/i)?.[1] ?? 0),
  );
  const width = Math.max(
    3,
    ...rows.map(
      (r) => String(r.item_no ?? "").match(/^CH-(\d+)$/i)?.[1]?.length ?? 0,
    ),
  );
  return `CH-${String(Math.max(0, ...used) + 1).padStart(width, "0")}`;
}

/** The writes below go through the register engine, whose after-write hook calls back in here: one level is enough. */
let syncing = false;
function once<T>(empty: T, fn: () => T): T {
  if (syncing) return empty;
  syncing = true;
  try {
    return fn();
  } finally {
    syncing = false;
  }
}

/** Both syncs: the adjustment change and the settlement payment of every final account. */
export function syncFinalAccounts(db: Database.Database, programmeId?: number, user: UserInfo | null = null) {
  const out = { adjustments: syncFinalAccountAdjustments(db, programmeId, user), settlements: syncFinalAccountSettlements(db, programmeId, user) };
  // Payment Tracking's revised contract value stays on the statement's final price
  const fas = db.prepare(`SELECT * FROM final_accounts ${programmeId !== undefined ? "WHERE programme_id = ?" : ""}`).all(...(programmeId !== undefined ? [programmeId] : [])) as RecordRow[];
  once(undefined, () => rederiveContractAdjustments(db, fas, user ?? SYSTEM));
  return out;
}

/**
 * A closed final account whose final contract price the payment certificates do not reach was settled
 * outside the IPC series (a direct final payment, a recovery, a set-off). One settlement row is kept on the
 * contract's IPC log for the balance, so certified to date (column P), the IPC log and the Excel report
 * close on the statement; it follows the price and goes when the certificates catch up or the account reopens.
 */
export function syncFinalAccountSettlements(
  db: Database.Database,
  programmeId?: number,
  user: UserInfo | null = null,
): { created: number; updated: number; removed: number } {
  return once({ created: 0, updated: 0, removed: 0 }, () =>
    settlements(db, programmeId, user),
  );
}

function settlements(
  db: Database.Database,
  programmeId: number | undefined,
  user: UserInfo | null,
): { created: number; updated: number; removed: number } {
  const out = { created: 0, updated: 0, removed: 0 };
  const payDef = getRegisterDef("payment_applications");
  if (!payDef) return out;
  const cols = new Set(
    (
      db.prepare('PRAGMA table_info("payment_applications")').all() as {
        name: string;
      }[]
    ).map((c) => c.name),
  );
  if (!cols.has("fa_id")) return out;
  const who = user ?? SYSTEM;
  const fas = db
    .prepare(
      `SELECT * FROM final_accounts ${programmeId !== undefined ? "WHERE programme_id = ?" : ""}`,
    )
    .all(...(programmeId !== undefined ? [programmeId] : [])) as RecordRow[];
  const linked = db
    .prepare(
      `SELECT * FROM payment_applications WHERE fa_id IS NOT NULL ${programmeId !== undefined ? "AND programme_id = ?" : ""}`,
    )
    .all(...(programmeId !== undefined ? [programmeId] : [])) as RecordRow[];
  const byFa = new Map(linked.map((p) => [Number(p.fa_id), p]));
  for (const fa of fas) {
    const existing = byFa.get(Number(fa.id)) ?? null;
    byFa.delete(Number(fa.id));
    const price = n(fa.final_contract_price);
    const contractId = fa.contract_id ? Number(fa.contract_id) : null;
    try {
      const drop = () => {
        if (existing) {
          deleteRecord(payDef, Number(existing.id), who);
          out.removed++;
        }
      };
      if (String(fa.status ?? "") !== "Closed" || !price || !contractId) {
        drop();
        continue;
      }
      // certified through the certificates themselves (the settlement row left out)
      const certified = (db
        .prepare(
          "SELECT MAX(COALESCE(cumulative_certified, cumulative_claimed)) AS c, MAX(sr_no) AS s, MAX(COALESCE(ipc_date, application_date)) AS d FROM payment_applications WHERE contract_id = ? AND (fa_id IS NULL OR fa_id <> ?)",
        )
        .get(contractId, Number(fa.id)) as {
        c: number | null;
        s: number | null;
        d: string | null;
      }) ?? { c: null, s: null, d: null };
      const through = n(certified.c);
      const balance = r2(price - through);
      if (Math.abs(balance) < 1) {
        drop();
        continue;
      }
      // dated when the account was closed, never before the last certificate, so it stays at the end of the IPC log
      const closed = String(fa.closed_date ?? "").slice(0, 10);
      const last = String(certified.d ?? "").slice(0, 10);
      const date = [closed, last].filter(Boolean).sort().pop() ?? todayIso();
      const ref = String(fa.fa_statement_ref ?? "").trim();
      const month = date
        ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(date.slice(5, 7)) - 1]}'${date.slice(2, 4)}`
        : null;
      // who settled the balance outside the IPC series: Head Office, a direct final payment, or the final account itself
      const headOffice = /head\s*office/i.test(String(fa.settled_by ?? ""));
      const direct = /direct/i.test(String(fa.settled_by ?? ""));
      const label = headOffice ? "Head Office payment" : direct ? "Direct final payment" : "FA settlement";
      const want: Record<string, unknown> = {
        contract_id: contractId,
        application_no: label,
        month,
        application_date: date,
        ipc_no: headOffice ? "HO" : "FA",
        ipc_date: date,
        cumulative_claimed: price,
        cumulative_certified: price,
        comments: `${label}${ref ? ` (${ref})` : ""}: final contract price ${formatMoney(price)} against ${formatMoney(through)} certified through the IPCs on this log – the balance of ${formatMoney(balance)} ${balance > 0 ? "paid" : "recovered"} ${headOffice ? "by Head Office" : direct ? "as a direct final payment" : "outside the IPC series"}${fa.closed_date ? "" : " (dated with the last certificate or the day of entry: no payment date on file)"}. Kept in step with the Final Account Status row automatically.`,
      };
      if (existing) {
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(want)) {
          const old = existing[k];
          const same =
            typeof v === "number"
              ? Math.abs(Number(old ?? NaN) - v) < 0.005
              : String(old ?? "") === String(v ?? "");
          if (!same) patch[k] = v;
        }
        if (Object.keys(patch).length) {
          updateRecord(payDef, Number(existing.id), patch, who, "import", {
            bypassRoles: true,
          });
          out.updated++;
        }
      } else {
        createRecord(
          payDef,
          {
            programme_id: Number(fa.programme_id),
            fa_id: Number(fa.id),
            sr_no: (certified.s ?? 0) + 1,
            ...want,
          },
          who,
          "import",
          { bypassRoles: true },
        );
        out.created++;
      }
    } catch (e) {
      console.warn(
        `[final accounts] settlement of ${fa.acc_ref ?? fa.id} skipped:`,
        e,
      );
    }
  }
  for (const orphan of byFa.values()) {
    deleteRecord(payDef, Number(orphan.id), who);
    out.removed++;
  }
  return out;
}

export function syncFinalAccountAdjustments(
  db: Database.Database,
  programmeId?: number,
  user: UserInfo | null = null,
): { created: number; updated: number; removed: number } {
  return once({ created: 0, updated: 0, removed: 0 }, () =>
    adjustments(db, programmeId, user),
  );
}

function adjustments(
  db: Database.Database,
  programmeId: number | undefined,
  user: UserInfo | null,
): { created: number; updated: number; removed: number } {
  const out = { created: 0, updated: 0, removed: 0 };
  const changesDef = getRegisterDef("changes");
  if (!changesDef) return out;
  const cols = new Set(
    (
      db.prepare('PRAGMA table_info("changes")').all() as { name: string }[]
    ).map((c) => c.name),
  );
  const faCols = new Set(
    (
      db.prepare('PRAGMA table_info("final_accounts")').all() as {
        name: string;
      }[]
    ).map((c) => c.name),
  );
  if (!cols.has("fa_id") || !faCols.has("fa_omissions")) return out;
  const who = user ?? SYSTEM;
  const fas = db
    .prepare(
      `SELECT * FROM final_accounts ${programmeId !== undefined ? "WHERE programme_id = ?" : ""}`,
    )
    .all(...(programmeId !== undefined ? [programmeId] : [])) as RecordRow[];
  const linked = db
    .prepare(
      `SELECT * FROM changes WHERE fa_id IS NOT NULL ${programmeId !== undefined ? "AND programme_id = ?" : ""}`,
    )
    .all(...(programmeId !== undefined ? [programmeId] : [])) as RecordRow[];
  const byFa = new Map(linked.map((c) => [Number(c.fa_id), c]));
  const approved = statusId(db, "Approved");
  for (const fa of fas) {
    const amount = r2(n(fa.fa_omissions));
    const existing = byFa.get(Number(fa.id)) ?? null;
    byFa.delete(Number(fa.id));
    try {
      if (!amount || !fa.cost_line_id) {
        if (existing) {
          deleteRecord(changesDef, Number(existing.id), who);
          out.removed++;
        }
        continue;
      }
      const line = db
        .prepare(
          "SELECT code, package_id, contractor_id, asset_id FROM cost_lines WHERE id = ?",
        )
        .get(Number(fa.cost_line_id)) as
        | {
            code: string;
            package_id: number | null;
            contractor_id: number | null;
            asset_id: number | null;
          }
        | undefined;
      // the same amount already on the register as a change of its own (a DVO for the omission): nothing to add
      const twin = db
        .prepare(
          "SELECT id, item_no FROM changes WHERE programme_id = ? AND (fa_id IS NULL OR fa_id <> ?) AND cost_line_id IN (SELECT id FROM cost_lines WHERE programme_id = ? AND code LIKE ?) AND ABS(COALESCE(dvo_cr_amount, dvo_tracker_amount, 0) - ?) < 1",
        )
        .get(
          Number(fa.programme_id),
          Number(fa.id),
          Number(fa.programme_id),
          `%${String(line?.code ?? fa.acc_ref ?? "").match(/\b(\d{3}[A-Z]\d{2})\b/)?.[1] ?? "§"}%`,
          amount,
        ) as { id: number; item_no: string } | undefined;
      if (twin) {
        if (existing) {
          deleteRecord(changesDef, Number(existing.id), who);
          out.removed++;
        }
        continue;
      }
      const frag =
        String(line?.code ?? fa.acc_ref ?? "")
          .match(/\b(\d{3}[A-Z]\d{2})\b/)?.[1]
          ?.toUpperCase() ?? null;
      const parts = `carried from omissions ${formatMoney(amount)}`;
      const ref = String(fa.fa_statement_ref ?? "").trim();
      const date = String(fa.closed_date ?? "").slice(0, 10) || null;
      const description = `Final Account Statement${ref ? ` ${ref}` : ""}${date ? ` (${formatDate(date)})` : ""} – ${parts}`;
      const want: Record<string, unknown> = {
        description,
        contractor_id: fa.contractor_id ?? line?.contractor_id ?? null,
        cost_line_id: Number(fa.cost_line_id),
        package_id: line?.package_id ?? null,
        asset_id: line?.asset_id ?? null,
        change_category_id: categoryId(db),
        overall_status_id: approved,
        dvo_ref: `FA statement${ref ? ` ${ref}` : ""}`,
        dvo_date: date,
        dvo_status_id: approved,
        dvo_tracker_amount: amount,
        dvo_cr_amount: amount,
        dvo_closed: true,
        date_raised: date,
        notes:
          "Kept in step with the Final Account Status row automatically – change the statement figures there, not here.",
      };
      if (existing) {
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(want)) {
          if (!cols.has(k)) continue;
          const old = existing[k];
          const same =
            typeof v === "number"
              ? Math.abs(Number(old ?? NaN) - v) < 0.005
              : typeof v === "boolean"
                ? Boolean(old) === v
                : String(old ?? "") === String(v ?? "");
          if (!same) patch[k] = v;
        }
        if (Object.keys(patch).length) {
          updateRecord(changesDef, Number(existing.id), patch, who, "import", {
            bypassRoles: true,
          });
          out.updated++;
        }
      } else {
        const record: Record<string, unknown> = {
          programme_id: Number(fa.programme_id),
          item_no: nextItemNo(db, Number(fa.programme_id), frag),
          fa_id: Number(fa.id),
          ...want,
        };
        for (const k of Object.keys(record)) if (!cols.has(k)) delete record[k];
        createRecord(changesDef, record, who, "import", { bypassRoles: true });
        out.created++;
      }
    } catch (e) {
      console.warn(
        `[final accounts] adjustment of ${fa.acc_ref ?? fa.id} skipped:`,
        e,
      );
    }
  }
  // an adjustment whose final account row is gone
  for (const orphan of byFa.values()) {
    deleteRecord(changesDef, Number(orphan.id), who);
    out.removed++;
  }
  if (out.created || out.updated || out.removed)
    rederiveContractAdjustments(db, fas, who);
  return out;
}

/**
 * Payment Tracking holds a manual "final account adjustment" on the contract that brings its revised value
 * to the statement's final price. The Final Account change now carries part of that gap in the approved
 * variations, so the manual figure is worked out again: final price − original − approved VOs − approved claims.
 */
function rederiveContractAdjustments(
  db: Database.Database,
  fas: RecordRow[],
  who: UserInfo,
) {
  const contractsDef = getRegisterDef("contracts");
  if (!contractsDef) return;
  const byProgramme = new Map<number, ReturnType<typeof computeContracts>>();
  for (const fa of fas) {
    const price = n(fa.final_contract_price);
    if (!fa.contract_id || !price || String(fa.status ?? "") !== "Closed")
      continue;
    const pid = Number(fa.programme_id);
    if (!byProgramme.has(pid)) byProgramme.set(pid, computeContracts(db, pid));
    const comp = byProgramme.get(pid)!;
    const contract = comp.rows.find(
      (c) => Number(c.id) === Number(fa.contract_id),
    );
    const c = comp.contracts.get(Number(fa.contract_id));
    if (!contract || !c || !n(contract.original_contract)) continue;
    const adjustment = r2(
      price -
        n(contract.original_contract) -
        c.approved_vos -
        c.approved_claims,
    );
    if (Math.abs(adjustment - n(contract.final_account_adjustment)) < 0.005)
      continue;
    try {
      updateRecord(
        contractsDef,
        Number(contract.id),
        { final_account_adjustment: adjustment },
        who,
        "import",
        { bypassRoles: true },
      );
    } catch (e) {
      console.warn(
        `[final accounts] contract adjustment of ${fa.acc_ref ?? fa.id} skipped:`,
        e,
      );
    }
  }
}
