import type { ReportData } from "./data";
import type { RecordRow } from "../registers/types";
import { loadCrossAssetConfig, rulesFor, type CrossAssetConfig, type AssetRule, type Dir, type ProjectRules } from "./cross-asset-rules";

/**
 * The change entries that need budget to move between this project and another asset, in two lists – budget out of
 * this project to other assets, and budget into it from other assets – with the entries whose funding is only
 * questioned listed apart, to confirm. Read from the change register of the selected report by the rules kept for
 * the project on the dashboard (cross-asset-rules.ts): each project words its register its own way, so each has its
 * own rules, wording and entries placed by hand. Every entry carries the rule and the words that placed it, and an
 * entry the rules found but left out (rejected, cancelled, or left out by hand) is listed too, so nothing goes unseen.
 */
export type Transfer = "Transferred" | "BTR raised" | "To be transferred" | "Not stated";
export interface CrossAssetItem {
  id: number;
  itemNo: string;
  description: string;
  otherAsset: string;
  status: string;
  stage: string;
  amount: number | null;
  costLine: string;
  contractor: string;
  /** the rule that placed it ("Named transfer", "Contract code", "Placed by hand" …) */
  rule: string;
  basis: string;
  evidence: string;
  btrRef: string;
  transfer: Transfer;
  /** where the rules would place it, when it was placed by hand */
  auto?: Dir | "none";
  note?: string;
}
export interface LeftOut {
  id: number;
  itemNo: string;
  description: string;
  otherAsset: string;
  status: string;
  amount: number | null;
  reason: string;
  /** where the rules would place it */
  auto: Dir | "none";
}
export interface CrossAssetReport {
  own: { code: string; name: string; short: string };
  out: CrossAssetItem[];
  into: CrossAssetItem[];
  confirm: CrossAssetItem[];
  leftOut: LeftOut[];
  totals: { out: number; into: number; confirm: number };
  byAsset: { asset: string; out: number; into: number; items: number }[];
  rules: ProjectRules;
  assets: AssetRule[];
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** a name as a pattern: any case, spaces and hyphens either way ("Ritz Carlton" = "Ritz-Carlton") */
const namePattern = (s: string) =>
  esc(s.trim())
    .replace(/(?:\\-|\s)+/g, "[\\s-]*")
    .replace(/^(\w)/, "\\b$1")
    .replace(/(\w)$/, "$1\\b");
const splitList = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean);

/** the change's figure at its furthest stage that carries one (DVO, VO, PVO, RFC, early warning) */
function valueOf(c: RecordRow): { amount: number | null; stage: string } {
  const pick: [string, unknown[]][] = [
    ["DVO", [c.dvo_cr_amount, c.dvo_tracker_amount]],
    ["VO", [c.vo_cr_amount, c.vo_tracker_amount]],
    ["PVO", [c.pvo_cr_amount, c.pvo_tracker_amount]],
    ["RFC", [c.rfc_cr_amount, c.rfc_tracker_amount]],
    ["EW", [c.ew_cr_amount, c.ew_tracker_amount]],
  ];
  for (const [stage, vals] of pick) for (const v of vals) if (num(v) !== null && Math.abs(num(v)!) >= 0.005) return { amount: num(v), stage };
  return { amount: null, stage: "" };
}

interface Hit {
  dir: Dir;
  assets: string[];
  rule: string;
  basis: string;
  evidence: string;
}

export function buildCrossAssetReport(data: ReportData, config: CrossAssetConfig = loadCrossAssetConfig()): CrossAssetReport {
  const code = data.programme.code;
  const ownNo = code.slice(-3);
  const R = rulesFor(config, code);
  const ownShort = /\(([A-Z]{2,6})\)/.exec(data.programme.name)?.[1] ?? data.programme.name;
  const ownAsset = config.assets.find((a) => a.code && a.code === ownNo);
  const others = config.assets.filter((a) => a !== ownAsset);
  const aliasesOf = (a: AssetRule) => [a.name.replace(/\s*\([^)]*\)\s*/g, " ").trim(), /\(([^)]+)\)/.exec(a.name)?.[1] ?? "", ...splitList(a.aliases, /[,;\n]/)].filter((x) => x.length >= 2);
  const ownNames = [ownShort, data.programme.name.replace(/\s*\([^)]*\)\s*/g, " ").trim(), ...(ownAsset ? aliasesOf(ownAsset) : []), ...splitList(R.ownAliases, /[,;\n]/)].filter((x) => x.length >= 2);
  const ownSrc = ownNames.map(namePattern).join("|") || "$^";
  const ownRe = new RegExp(ownSrc, "i");
  const assetRes = others.map((a) => ({ a, re: new RegExp(aliasesOf(a).map(namePattern).join("|") || "$^", "i"), not: splitList(a.notAliases ?? "", /[,;\n]/).map((w) => new RegExp(namePattern(w), "gi")) }));
  const otherSrc = others.flatMap(aliasesOf).map(namePattern).join("|") || "$^";
  /** the other assets a stretch of text names ("RSMLI/ MH3" → RSMLI, MH-3) */
  const named = (t: string) => {
    const spans = assetRes
      .map((x) => {
        // wording that names something else ("Blue Wellness") is blanked out, keeping the positions
        const own = x.not.reduce((u, re) => u.replace(re, (w) => " ".repeat(w.length)), t);
        return { name: x.a.name, at: [...own.matchAll(new RegExp(x.re.source, "gi"))].map((m) => [m.index, m.index + m[0].length]) };
      })
      .filter((x) => x.at.length);
    // a name inside a longer one is not a second asset: "the Marina" in "the Marina Village Wide"
    const inside = (s: number[], name: string) => spans.some((o) => o.name !== name && o.at.some((q) => q[0] <= s[0] && q[1] >= s[1] && q[1] - q[0] > s[1] - s[0]));
    return spans.filter((x) => x.at.some((s) => !inside(s, x.name))).map((x) => x.name);
  };
  const byNo = new Map(others.filter((a) => a.code).map((a) => [a.code, a.name]));
  /** a phrase as written on the page: {asset} any other asset (captured), {own} this project, spaces any spacing */
  const phrase = (p: string) => new RegExp(esc(p.trim()).replace(/\\\{asset\\\}/gi, `(${otherSrc})`).replace(/\\\{own\\\}/gi, `(?:${ownSrc})`).replace(/\s+/g, "\\s*"), "i");
  const phrases = (dir: Dir, s: string) => splitList(s, /\n/).flatMap((p) => {
    try {
      return [{ dir, p, re: phrase(p) }];
    } catch {
      return [];
    }
  });
  const userPhrases = [...phrases("out", R.outPhrases), ...phrases("into", R.intoPhrases), ...phrases("confirm", R.confirmPhrases)];
  const ignore = splitList(R.ignoreWords, /\n/).sort((a, b) => b.length - a.length).map((w) => new RegExp(esc(w).replace(/\s+/g, "\\s*"), "gi"));
  const lineCode = new Map(data.costReport.lines.map((l) => [l.id, l.code]));
  const overrides = config.overrides[code] ?? {};
  const say = (m: RegExpExecArray | null) => (m ? m[0].replace(/\s+/g, " ").trim() : "");
  const OWN = ownSrc;

  // the transfers an entry names in its own words
  const namedRules: { re: RegExp; dir: Dir; who: (m: RegExpExecArray, text: string) => string[]; basis: string }[] = [
    {
      re: /budget\s+transfer\s+to\s+(1TB\d{5}[\w.]*)/i,
      dir: "out",
      who: (m, text) => {
        if (m[1].startsWith(code)) return [];
        // "Budget Transfer to 1TB04030.02.CN.98 – CN Budget Hold …" → "1TB04030.02.CN.98 (CN Budget Hold)"
        const what = /^\s*[–-]\s*([^|\n]*?budget\s+hold)/i.exec(text.slice(m.index + m[0].length))?.[1];
        return [`${m[1].replace(/\.$/, "")}${what ? ` (${what.trim()})` : ""}`];
      },
      basis: "a budget transfer from this project's budget the entry names",
    },
    { re: new RegExp(`\\bfrom\\s+(?:the\\s+)?(?:${OWN})\\s+(?:asset\\s+|project\\s+)?to\\s+([^|.;]{2,40})`, "i"), dir: "out", who: (m) => named(m[1]), basis: "the entry names a transfer from this project to another asset" },
    { re: new RegExp(`\\bfrom\\s+([^|.;]{2,40}?)\\s+to\\s+(?:the\\s+)?(?:${OWN})`, "i"), dir: "into", who: (m) => named(m[1]), basis: "the entry names a transfer from another asset to this project" },
    // "Supply Skilled Manpower for Village Boutique Hotel – From Wellness": another asset's resources supplied here, paid from this project's budget
    // (the matching "– Back charge to <contractor>" line is a recovery from this project's contractor, read below)
    { re: new RegExp(`\\bfor\\s+(?:the\\s+)?(?:${OWN})[^|]{0,40}?[–-]\\s*from\\s+(?:the\\s+)?([^|.;–-]{2,40})`, "i"), dir: "out", who: (m, text) => (/back[\s-]?charge/i.test(text.split("|")[0]) ? [] : named(m[1])), basis: "resources from another asset supplied to this project – this project's budget goes to that asset" },
    // "Marina Village asks to transfer funds to VBH": the asset the entry names gives its budget here
    { re: new RegExp(`\\btransfer(?:red)?\\s+(?:the\\s+)?(?:funds?|budget)\\s+(?:back\\s+)?to\\s+(?:the\\s+)?(?:${OWN})`, "i"), dir: "into", who: (_m, text) => named(text), basis: "the entry names budget to be transferred to this project from the other asset it names" },
    { re: /\btransfer(?:red)?\s+(?:the\s+)?(?:funds?|budget)\s+(?:back\s+)?to\s+(?:the\s+)?([^|.;\n]{2,40})/i, dir: "out", who: (m) => named(m[1]), basis: "the entry names budget to be transferred from this project to another asset" },
    { re: /\bBTR\s+(?:is\s+|to\s+be\s+(?:done|raised)\s+)?from\s+([^|.;\n]{2,40})/i, dir: "into", who: (m) => named(m[1]), basis: "a BTR from another asset the entry names" },
    { re: /\bBTR\s+(?:is\s+|to\s+be\s+(?:done|raised)\s+)?to\s+([^|.;\n]{2,40})/i, dir: "out", who: (m) => named(m[1]), basis: "a BTR to another asset the entry names" },
    { re: /(?:transferred|transfer|returned|retruned)\s+back\s+from\s+([^|.;]{2,40})/i, dir: "into", who: (m) => named(m[1]), basis: "budget to come back from another asset" },
    { re: /funds?\s+(?:to\s+be\s+|are\s+|is\s+)?(?:returned|retruned|transferred|recovered)\s+from\s+([^|.;]{2,40})/i, dir: "into", who: (m) => named(m[1]), basis: "funds to be returned from another asset" },
    { re: new RegExp(`(?:\\bBTR\\b|transfer)[^|]{0,60}?\\bback\\s+to\\s+(?:${OWN})`, "i"), dir: "into", who: (_m, text) => named(text), basis: "a budget transfer back to this project for works done for another asset" },
    { re: /(?:funding|budget|funds?)[^|]{0,80}?\b(?:coming|come)\s+from\s+([^|.;]{2,40})/i, dir: "confirm", who: (m) => named(m[1]), basis: "the funding source is questioned in the entry – to confirm" },
  ];
  const btrDone = /\bBTR\b[^|\n]{0,40}?\b(?:completed|approved|done)\b/i;

  const detect = (c: RecordRow, raw: string, text: string, desc: string, notes: string, lineNo: string, lineLabel: string): Hit | null => {
    // 1. the project's own wording, read before anything is taken out
    for (const u of userPhrases) {
      const m = u.re.exec(raw);
      if (!m) continue;
      const who = m[1] ? named(m[1]) : named(raw);
      return { dir: u.dir, assets: who.length ? who : ["Not named"], rule: "Project wording", basis: `the entry carries the wording set for this project: "${u.p}"`, evidence: say(m) };
    }
    // 2. transfers the entry names
    if (R.namedTransfers)
      for (const r of namedRules) {
        const m = r.re.exec(text);
        if (!m) continue;
        const who = r.who(m, text);
        if (!who.length) continue;
        return { dir: r.dir, assets: who, rule: "Named transfer", basis: r.basis, evidence: say(m) };
      }
    // 3. a change on another asset's contract code
    if (R.contractCode !== "off" && lineNo && lineNo !== ownNo && byNo.has(lineNo)) {
      const a = byNo.get(lineNo)!;
      return {
        dir: R.contractCode,
        assets: [a],
        rule: "Contract code",
        basis: `the change sits on ${a}'s contract code (${lineLabel}) – that asset's contractor works for this project${R.contractCode === "out" ? `, so this project's budget goes to ${a}` : ""}`,
        evidence: lineLabel,
      };
    }
    // 4. works done in another asset
    if (R.worksDone !== "off") {
      const m = new RegExp(`works?\\s+(?:done|doen|carried\\s+out|executed)\\s+(?:in|under|at|for|within)\\s+(?:the\\s+)?(${otherSrc})`, "i").exec(`${desc} | ${notes}`);
      const who = m ? named(m[1]) : [];
      if (m && who.length) return { dir: R.worksDone, assets: who, rule: "Works done in another asset", basis: `works done in ${who.join(" / ")} under this project's contract – ${who.join(" / ")}'s budget should come here`, evidence: say(m) };
    }
    // 4b. a back charge to this project's own contractor for another asset's resources: a recovery, not a transfer
    // the party charged is the name right after "back charge to" ("REEM" in "Back Charge to REEM deploy of BAFKO Labour Rosewood")
    const bc = /back[\s-]?charge[sd]?\s+(?:to\s+)?([A-Za-z&.]+(?:\s+[A-Z][\w&.]*){0,2})/i.exec(desc);
    if (bc && !named(bc[1] ?? "").length) {
      const who = named(desc);
      if (who.length) return { dir: "confirm", assets: who, rule: "Back charge to contractor", basis: `a back charge to this project's contractor for ${who.join(" / ")}'s resources – a recovery from the contractor, not a budget transfer; it pairs with the transfer to ${who.join(" / ")}, so check it is not counted twice`, evidence: say(bc) };
    }
    // 5. works named for another asset (in the description), alone or beside this project
    const forRe = new RegExp(`\\b(?:at|for|within)\\s+(?:the\\s+)?(${otherSrc})|^\\s*(${otherSrc})\\s*[–:-]|[–-]\\s*(${otherSrc})|\\((${otherSrc})\\)`, "i");
    const fm = forRe.exec(desc);
    const forWho = fm ? named(fm[1] ?? fm[2] ?? fm[3] ?? fm[4] ?? "") : [];
    const ownToo = ownRe.test(desc);
    if (ownToo && R.shared !== "off") {
      const who = named(desc.replace(new RegExp(ownSrc, "gi"), " "));
      if (who.length) return { dir: R.shared, assets: who, rule: "Shared with another asset", basis: `the change covers ${who.join(" / ")} as well as this project – confirm the share each asset funds`, evidence: desc.slice(0, 120) };
    }
    if (fm && forWho.length && !ownToo) {
      // a BTR raised under that asset's own number (AMA01005-WTRAN-… for RSMLI): its budget came here
      const ref = /\bBTR\b[^|\n]{0,30}?\b(?:AMA|1TB)01(\d{3})-(?:WTRAN|RBTR|BTR)-\d+/i.exec(text);
      if (ref && ref[1] !== ownNo && forWho.includes(byNo.get(ref[1]) ?? "")) return { dir: "into", assets: forWho, rule: "Works for another asset, its BTR", basis: `works for ${forWho.join(" / ")} under this project's contract, with a BTR raised under ${forWho.join(" / ")}'s number – its budget comes here`, evidence: `${say(fm)} · ${say(ref)}` };
      const withBtr = btrDone.exec(text);
      if (withBtr && R.worksForWithBtr !== "off") return { dir: R.worksForWithBtr, assets: forWho, rule: "Works for another asset, BTR recorded", basis: `works for ${forWho.join(" / ")} under this project's contract, with a BTR the entry records as done – ${forWho.join(" / ")}'s budget comes here`, evidence: `${say(fm)} · ${say(withBtr)}` };
      if (R.worksFor !== "off") return { dir: R.worksFor, assets: forWho, rule: "Works for another asset", basis: `works for ${forWho.join(" / ")} under this project's contract, with no transfer named – confirm whether ${forWho.join(" / ")}'s budget should come here`, evidence: say(fm) };
    }
    // 6. a BTR raised under another asset's number
    if (R.otherAssetRef !== "off") {
      const m = /\bBTR\b[^|\n]{0,30}?\b(?:AMA|1TB)01(\d{3})-(?:WTRAN|RBTR|BTR)-\d+/i.exec(text);
      if (m && m[1] !== ownNo && byNo.has(m[1])) return { dir: R.otherAssetRef, assets: [byNo.get(m[1])!], rule: "Other asset's BTR reference", basis: `the BTR reference is raised under ${byNo.get(m[1])}'s number`, evidence: say(m) };
    }
    void c;
    return null;
  };

  const out: CrossAssetItem[] = [];
  const into: CrossAssetItem[] = [];
  const confirm: CrossAssetItem[] = [];
  const leftOut: LeftOut[] = [];
  const isMarked = (c: RecordRow) => c.inter_asset === true || c.inter_asset === 1 || c.inter_asset === "1";
  const rows = data.registers.changes?.rows ?? [];
  // the report carries the tracker's marks (an older import does not): then the marks decide what is listed
  const hasMarks = rows.some(isMarked);
  // a change category that marks an inter-asset entry ("Back Charge") – when the entry names another asset or sits on its contract code
  const cats = new Set(splitList(R.markCategories, /[,;\n]/).map((x) => x.toLowerCase()));
  const byCategory = (c: RecordRow, desc: string, notes: string, lineNo: string) =>
    cats.has(String(c.change_category_id__label ?? "").trim().toLowerCase()) && (named(`${desc} | ${notes}`).length > 0 || (!!lineNo && lineNo !== ownNo && byNo.has(lineNo)));
  for (const c of rows) {
    const itemNo = String(c.item_no ?? c.id);
    const desc = String(c.description ?? "");
    const notes = String(c.notes ?? "");
    const funding = [c.funding_btr, c.funding_pvo, c.funding_dvo, c.funding_contingency].filter((x) => x !== null && x !== undefined && x !== "").join(" ");
    const raw = `${desc} | ${notes} | ${funding}`;
    let text = raw;
    for (const re of ignore) text = text.replace(re, " ");
    const lineLabel = lineCode.get(Number(c.cost_line_id)) ?? String(c.cost_line_id__label ?? "");
    const lineNo = /(\d{3})[A-Z]#?\d{1,3}\b/.exec(lineLabel)?.[1] ?? "";
    let hit = detect(c, raw, text, desc, notes, lineNo, lineLabel);
    const marked = isMarked(c) || byCategory(c, desc, notes, lineNo);
    if (marked && R.marked !== "off") {
      if (hit) hit = { ...hit, rule: `${hit.rule} · ${isMarked(c) ? "green in Schedule C" : String(c.change_category_id__label ?? "marked")}` };
      else {
        const who = named(`${desc} | ${notes}`);
        hit = { dir: R.marked, assets: who.length ? who : ["Not named"], rule: isMarked(c) ? "Green in Schedule C" : "Back charge category", basis: `${isMarked(c) ? "marked green (inter-asset) in Schedule C" : `change category "${String(c.change_category_id__label ?? "")}" naming another asset`}${who.length ? ` – ${who.join(" / ")} named in the entry` : " – the other asset is not named in the entry"}; the direction is not stated – confirm`, evidence: isMarked(c) ? "green in Schedule C" : String(c.change_category_id__label ?? "") };
      }
    }
    const ov = overrides[itemNo];
    if (!hit && !ov) continue;
    const { amount, stage } = valueOf(c);
    const status = String(c.overall_status_id__label ?? "");
    const btrRef = /\b\d{3}[A-Z]\d{2,3}-BTR-\d{3,4}\b|\b(?:AMA|1TB)\d{5}-R?BTR-\d{3,6}\b|\bBTR[- ]?\d{3,6}\b/i.exec(text)?.[0] ?? /\bBTR\b[^|\n]{0,20}?\b((?:AMA|1TB)\d{5}-WTRAN-\d+)/i.exec(text)?.[1] ?? "";
    const transfer: Transfer = /budget\s+transferred|transfer(?:red)?\s+(?:done|completed|processed)|\btransferred\s+in\s+\w+/i.test(text) || btrDone.test(text)
      ? "Transferred"
      : btrRef
        ? "BTR raised"
        : /to\s+be\s+(?:done|transferred|returned|retruned)|required|upon\s+approval|should/i.test(text)
          ? "To be transferred"
          : "Not stated";
    const base = { id: Number(c.id), itemNo, description: desc, status, amount };
    if (ov?.dir === "exclude") {
      leftOut.push({ ...base, otherAsset: ov.asset || hit?.assets.join(" / ") || "", reason: `Left out by hand${ov.by ? ` (${ov.by}${ov.at ? `, ${ov.at.slice(0, 10)}` : ""})` : ""}${ov.note ? ` – ${ov.note}` : ""}`, auto: hit?.dir ?? "none" });
      continue;
    }
    // an entry rejected, cancelled or superseded moves no budget – unless it was placed by hand
    const dead = /^(rejected|cancelled|superseded)$/i.test(status) || /excel\s+status:\s*[^|]*?(?:reject|cancel|supersed)/i.test(notes);
    if (!ov && R.skipCancelled && dead) {
      leftOut.push({ ...base, otherAsset: hit!.assets.join(" / "), reason: `${status || "Cancelled"} – ${/excel\s+status:\s*([^|]*)/i.exec(notes)?.[1]?.trim() || "rejected, cancelled or superseded"}`, auto: hit!.dir });
      continue;
    }
    if (!ov && R.markedOnly && hasMarks && R.marked !== "off" && !marked) {
      leftOut.push({ ...base, otherAsset: hit!.assets.join(" / "), reason: `Not marked inter-asset in Schedule C (green${R.markCategories.trim() ? `, or ${R.markCategories.trim()} naming another asset` : ""}) – the rules read: ${hit!.rule.toLowerCase()} (${hit!.basis})`, auto: hit!.dir });
      continue;
    }
    const item: CrossAssetItem = {
      ...base,
      otherAsset: ov?.asset || hit?.assets.join(" / ") || "Not named",
      stage,
      costLine: lineLabel,
      contractor: String(c.contractor_id__label ?? ""),
      rule: ov ? "Placed by hand" : hit!.rule,
      basis: ov ? `placed here by ${ov.by || "hand"}${ov.at ? ` on ${ov.at.slice(0, 10)}` : ""}${ov.note ? ` – ${ov.note}` : ""}${hit ? ` (the rules read: ${hit.basis})` : ""}` : hit!.basis,
      evidence: hit?.evidence ?? "",
      btrRef,
      transfer,
      ...(ov ? { auto: hit?.dir ?? "none", note: ov.note } : {}),
    };
    const dir = ov ? (ov.dir as Dir) : hit!.dir;
    (dir === "out" ? out : dir === "into" ? into : confirm).push(item);
  }
  const sum = (xs: CrossAssetItem[]) => Math.round(xs.reduce((t, x) => t + (x.amount ?? 0), 0) * 100) / 100;
  const order = <T extends { otherAsset: string; amount: number | null }>(xs: T[]) => xs.sort((a, b) => a.otherAsset.localeCompare(b.otherAsset) || Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0));
  const assets = new Map<string, { out: number; into: number; items: number }>();
  for (const [list, k] of [[out, "out"], [into, "into"]] as const)
    for (const x of list) {
      const e = assets.get(x.otherAsset) ?? { out: 0, into: 0, items: 0 };
      e[k] = Math.round((e[k] + (x.amount ?? 0)) * 100) / 100;
      e.items++;
      assets.set(x.otherAsset, e);
    }
  return {
    own: { code, name: data.programme.name, short: ownShort },
    out: order(out),
    into: order(into),
    confirm: order(confirm),
    leftOut: order(leftOut),
    totals: { out: sum(out), into: sum(into), confirm: sum(confirm) },
    byAsset: [...assets.entries()].map(([asset, v]) => ({ asset, ...v })).sort((a, b) => a.asset.localeCompare(b.asset)),
    rules: R,
    assets: config.assets,
  };
}
