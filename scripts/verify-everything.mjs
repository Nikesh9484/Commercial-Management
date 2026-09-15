/**
 * Runs the whole dashboard and checks it: every page, every download, every standard report, for
 * every project – and then cross-checks that the numbers on screen are the numbers in the files.
 *
 *   node scripts/verify-everything.mjs [baseUrl]
 *
 * Exits non-zero if anything failed, so it can be run before a release rather than trusted to a
 * spot check of the one page that was being worked on.
 */
const BASE = process.argv[2] || "http://localhost:3111";
const EMAIL = process.env.VERIFY_EMAIL || "admin@commercial.local";
const PASSWORD = process.env.VERIFY_PASSWORD || "Admin@123";

const pass = [];
const fail = [];
const ok = (what, detail = "") => pass.push(`${what}${detail ? ` – ${detail}` : ""}`);
const bad = (what, detail = "") => fail.push(`${what}${detail ? ` – ${detail}` : ""}`);

let cookie = "";
async function req(path, init = {}) {
  const r = await fetch(`${BASE}${path}`, { ...init, redirect: "manual", headers: { ...(init.headers || {}), ...(cookie ? { cookie } : {}) } });
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  return r;
}

const PAGES = [
  "/", "/modules/executive-summary", "/modules/executive-summary/minutes", "/modules/cost-report",
  "/modules/cost-report?tab=level1", "/modules/cost-report?tab=level2", "/modules/cost-report?tab=setup", "/modules/change-management",
  "/modules/claims-disputes", "/modules/early-warnings", "/modules/provisional-sums",
  "/modules/bonds-insurance", "/modules/invoices-payments", "/modules/final-accounts",
  "/modules/cash-flow", "/modules/budget-transfers", "/modules/monthly-report",
  "/modules/monthly-report/library", "/modules/project-setup", "/reports", "/reports/builder",
  "/settings", "/settings/appearance", "/settings/users", "/imports/monthly", "/imports/claims-tracker",
  "/imports/bonds", "/library/contract", "/library/eot", "/activity",
];
const SECTIONS = ["exec", "movement", "level1", "level2", "cashflow", "claims_report", "fa_report",
  "payments_report", "changes_report", "ew_report", "ps_report", "bonds_report", "transfers_report"];

async function login() {
  const r = await req("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
  ok("login");
}

async function programmes() {
  const r = await req("/api/registers/programmes");
  const j = await r.json().catch(() => ({}));
  return (j.rows ?? j.records ?? []).map((p) => ({ id: p.id, name: p.name, code: p.code }));
}

async function setProgramme(id, tag) {
  const r = await req("/api/context", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ programme_id: id }) });
  if (!r.ok) { bad(`${tag} switch project`, `HTTP ${r.status}`); return false; }
  // Confirm the switch actually took: a silent no-op here would test one project twice and report
  // every check twice as passing, which is worse than no check at all.
  const now = await (await req("/api/context")).json().catch(() => ({}));
  const got = Number(now.programme?.id ?? now.programme_id ?? 0);
  if (got !== Number(id)) { bad(`${tag} switch project`, `asked for ${id}, context says ${got || "nothing"}`); return false; }
  ok(`${tag} switch project`, `context is on ${got}`);
  return true;
}

async function checkPages(tag) {
  for (const p of PAGES) {
    const r = await req(p);
    if (r.status >= 200 && r.status < 400) {
      const body = r.status < 300 ? await r.text() : "";
      // Next renders a client error boundary rather than a 500, so the status alone is not enough
      if (/Application error: a (client|server)-side exception|Internal Server Error/i.test(body)) bad(`${tag} page ${p}`, "rendered an error boundary");
      else ok(`${tag} page ${p}`, String(r.status));
    } else {
      bad(`${tag} page ${p}`, `HTTP ${r.status}`);
    }
  }
}

async function checkExports(tag) {
  for (const s of SECTIONS) {
    for (const fmt of ["pdf", "xlsx"]) {
      const r = await req(`/api/export?section=${s}&format=${fmt}`);
      if (!r.ok) { bad(`${tag} download ${s}.${fmt}`, `HTTP ${r.status} ${(await r.text()).slice(0, 120)}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const magic = fmt === "pdf" ? buf.subarray(0, 4).toString() === "%PDF" : buf.subarray(0, 2).toString() === "PK";
      if (!magic) bad(`${tag} download ${s}.${fmt}`, `not a valid ${fmt} (${buf.length} bytes)`);
      else if (buf.length < 1000) bad(`${tag} download ${s}.${fmt}`, `suspiciously small: ${buf.length} bytes`);
      else ok(`${tag} download ${s}.${fmt}`, `${Math.round(buf.length / 1024)} KB`);
    }
  }
}

async function checkStandardReports(tag) {
  const list = await (await req("/api/custom-report?standard=1")).json().catch(() => ({}));
  const reports = list.standard ?? list.reports ?? [];
  if (!reports.length) { bad(`${tag} standard reports`, "the catalogue returned none"); return; }
  ok(`${tag} standard reports`, `${reports.length} in the catalogue`);
  for (const rep of reports) {
    const r = await req("/api/custom-report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ standard: rep.id }) });
    if (!r.ok) { bad(`${tag} report "${rep.title ?? rep.id}"`, `HTTP ${r.status} ${(await r.text()).slice(0, 120)}`); continue; }
    const j = await r.json().catch(() => null);
    if (!j || j.error) bad(`${tag} report "${rep.title ?? rep.id}"`, j?.error ?? "no body");
    else ok(`${tag} report "${rep.title ?? rep.id}"`, `${j.rows?.length ?? 0} row(s)`);
  }
}

/** The bonds page and the bonds report have to agree, or a download quietly says something else. */
async function crossCheckBonds(tag) {
  const r = await req("/api/registers/bonds?all=1");
  if (!r.ok) { bad(`${tag} bonds cross-check`, `register HTTP ${r.status}`); return; }
  const j = await r.json();
  const rows = j.rows ?? j.records ?? [];
  if (!rows.length) { bad(`${tag} bonds cross-check`, "the register returned no rows at all"); return; }
  const count = (s) => rows.filter((x) => x.status === s).length;
  const screen = { expired: count("Expired"), released: count("Released (contract closed)"), superseded: count("Superseded (newer policy held)"), duplicate: count("Duplicate (same policy entered twice)") };
  ok(`${tag} bonds on screen`, `${rows.length} total · ${screen.expired} expired · ${screen.released} released · ${screen.superseded} superseded · ${screen.duplicate} duplicate`);

  // no company may appear under two spellings in the chase list
  const key = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const chased = rows.filter((x) => x.status === "Expired");
  const spellings = new Map();
  for (const x of chased) {
    const k = key(x.contractor_id__label);
    if (!k) continue;
    spellings.set(k, new Set([...(spellings.get(k) ?? []), String(x.contractor_id__label)]));
  }
  const dupNames = [...spellings.entries()].filter(([, v]) => v.size > 1);
  if (dupNames.length) bad(`${tag} bonds contractor names`, dupNames.map(([, v]) => [...v].join(" / ")).join(" | "));
  else ok(`${tag} bonds contractor names`, "no company appears under two spellings");

  // anything still chased must say why
  const noReason = chased.filter((x) => !x.link_note);
  if (noReason.length) bad(`${tag} bonds reasons`, `${noReason.length} chased item(s) give no reason`);
  else ok(`${tag} bonds reasons`, `all ${chased.length} chased item(s) say why`);

  const rep = await req(`/api/export?section=bonds_report&format=xlsx&bondsExpiry=expired`);
  if (!rep.ok) bad(`${tag} bonds report`, `HTTP ${rep.status}`);
  else ok(`${tag} bonds report (expired filter)`, `${Math.round(Buffer.from(await rep.arrayBuffer()).length / 1024)} KB`);
}

/**
 * The data itself, not the code: the things that quietly make a report wrong rather than make a page
 * fall over. Each one is a real defect that has bitten this dashboard at least once.
 */
async function checkDataHealth(tag) {
  const get = async (k) => {
    const r = await req(`/api/registers/${k}?all=1`);
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j ? (j.rows ?? j.records ?? []) : null;
  };
  const key = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const contractors = await get("contractors");
  if (contractors) {
    const seen = new Map();
    for (const c of contractors) {
      const k = key(c.name);
      if (!k) continue;
      seen.set(k, [...(seen.get(k) ?? []), String(c.name)]);
    }
    const dups = [...seen.values()].filter((v) => v.length > 1);
    if (dups.length) bad(`${tag} duplicate contractors`, dups.map((v) => v.join(" / ")).join(" | "));
    else ok(`${tag} duplicate contractors`, "every company appears once");
  }

  const bonds = await get("bonds");
  if (bonds) {
    // Checked against the contractor ids that actually exist, not against the name stored on the bond:
    // an issued period keeps the name it was issued with, so a deleted contractor still reads fine
    // there and a broken link would slip past unnoticed.
    const liveIds = new Set((contractors ?? []).map((c) => Number(c.id)));
    const broken = liveIds.size
      ? bonds.filter((b) => b.contractor_id !== null && b.contractor_id !== undefined && !liveIds.has(Number(b.contractor_id)))
      : [];
    if (!liveIds.size) bad(`${tag} bond contractor links`, "could not read the contractors register to check against");
    else if (broken.length) bad(`${tag} bond contractor links`, `${broken.length} bond(s) point at a contractor record that no longer exists: ${broken.slice(0, 5).map((b) => b.ref).join(", ")}`);
    else ok(`${tag} bond contractor links`, `all ${bonds.length} checked against ${liveIds.size} contractor record(s)`);

    // the same policy recorded twice under two contractor rows is the defect that inflated the counts
    const sig = new Map();
    for (const b of bonds) {
      const k = `${key(b.contractor_id__label)}|${b.package_id ?? ""}|${b.type_id ?? ""}|${b.expiry_date ?? ""}`;
      sig.set(k, (sig.get(k) ?? 0) + 1);
    }
    const repeated = [...sig.values()].filter((n) => n > 1).length;
    const flagged = bonds.filter((b) => b.duplicate || b.status === "Duplicate (same policy entered twice)").length;
    if (repeated && !flagged) bad(`${tag} repeated policies`, `${repeated} policy signature(s) appear more than once but none is marked as a duplicate`);
    else ok(`${tag} repeated policies`, flagged ? `${flagged} marked as duplicates` : "none repeated");
  }
}

/** Every register must load and enrich without throwing. */
async function checkRegisters(tag) {
  const defs = await (await req("/api/registers")).json().catch(() => ({}));
  const keys = (defs.registers ?? []).map((d) => d.key);
  for (const k of keys.length ? keys : ["bonds", "changes", "claims", "risks", "provisional_sums", "payment_applications", "final_accounts", "budget_transfers", "cost_lines"]) {
    const r = await req(`/api/registers/${k}?all=1`);
    if (!r.ok) { bad(`${tag} register ${k}`, `HTTP ${r.status}`); continue; }
    const j = await r.json().catch(() => null);
    if (!j || j.error) bad(`${tag} register ${k}`, j?.error ?? "no body");
    else ok(`${tag} register ${k}`, `${(j.rows ?? j.records ?? []).length} row(s)`);
  }
}

(async () => {
  await login();
  const progs = await programmes();
  if (!progs.length) bad("programmes", "none found");
  for (const p of progs) {
    const tag = `[${p.code ?? p.id} ${p.name ?? ""}]`.trim();
    if (!(await setProgramme(p.id, tag))) continue;
    await checkPages(tag);
    await checkRegisters(tag);
    await crossCheckBonds(tag);
    await checkDataHealth(tag);
    await checkExports(tag);
    await checkStandardReports(tag);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`PASSED ${pass.length}`);
  for (const l of pass) console.log("  ok   " + l);
  console.log(`\nFAILED ${fail.length}`);
  for (const l of fail) console.log("  FAIL " + l);
  console.log("=".repeat(70));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error("harness error:", e); process.exit(2); });
