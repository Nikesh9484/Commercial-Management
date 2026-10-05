"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssetRule, ProjectRules } from "@/lib/report/cross-asset-rules";

/**
 * The controls on the Cross-asset budget transfers page: "Move to" on every entry (placed by hand, kept by item number
 * so it holds through every import) and the rules panel – each project's own rules, wording and list of assets.
 */
type Where = "auto" | "out" | "into" | "confirm" | "exclude";
const WHERE: { v: Where; label: string }[] = [
  { v: "auto", label: "As the rules read it" },
  { v: "out", label: "Budget out (to other asset)" },
  { v: "into", label: "Budget in (from other asset)" },
  { v: "confirm", label: "To confirm" },
  { v: "exclude", label: "Leave out" },
];

async function send(method: "POST" | "PUT", body: unknown): Promise<string | null> {
  try {
    const res = await fetch("/api/cross-asset", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Could not save (${res.status}).`;
  } catch {
    return "Could not reach the server – try again.";
  }
}

export function MoveTo({ programmeCode, itemNo, placed, asset, assets }: { programmeCode: string; itemNo: string; placed: boolean; asset: string; assets: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [where, setWhere] = useState<Where>("auto");
  const [who, setWho] = useState(asset);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const busy = saving || refreshing;
  const [err, setErr] = useState<string | null>(null);
  const options = [...new Set([asset, ...assets].filter(Boolean))];
  if (!open && !refreshing)
    return (
      <button type="button" className="text-[11px] text-accent hover:underline" onClick={() => setOpen(true)} title="Place this entry by hand – kept through every import">
        {placed ? "Placed by hand – change" : "Move…"}
      </button>
    );
  const save = async () => {
    setSaving(true);
    setErr(null);
    const e = await send("POST", { programmeCode, itemNo, dir: where, asset: where === "auto" || where === "exclude" ? "" : who, note });
    setSaving(false);
    if (e) return setErr(e);
    setOpen(false);
    // the lists are worked out again on the server; "Saving…" stays until they are back
    startRefresh(() => router.refresh());
  };
  if (refreshing) return <span className="text-[11px] text-muted">Saving… updating the lists</span>;
  return (
    <div className="flex min-w-[14rem] flex-col gap-1 rounded border border-line bg-white p-1.5 text-[11px]">
      <select className="input h-7 text-[11px]" value={where} onChange={(e) => setWhere(e.target.value as Where)}>
        {WHERE.map((w) => (
          <option key={w.v} value={w.v}>
            {w.label}
          </option>
        ))}
      </select>
      {where !== "auto" && where !== "exclude" && (
        <select className="input h-7 text-[11px]" value={who} onChange={(e) => setWho(e.target.value)}>
          {options.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      )}
      {where !== "auto" && <input className="input h-7 text-[11px]" placeholder="Note (why) – optional" value={note} onChange={(e) => setNote(e.target.value)} />}
      {err && <div className="text-red-700">{err}</div>}
      <div className="flex gap-1">
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const DIRS: { v: string; label: string }[] = [
  { v: "out", label: "Budget out" },
  { v: "into", label: "Budget in" },
  { v: "confirm", label: "To confirm" },
  { v: "off", label: "Off" },
];

const RULES: { key: keyof ProjectRules; label: string; help: string; offAllowed?: boolean }[] = [
  { key: "contractCode", label: "Change on another asset's contract code", help: "e.g. CN.011C38 on VBH's register – Rosewood's contractor works for this project" },
  { key: "worksDone", label: "\"Works done in / under <asset>\"", help: "e.g. \"(Works done in MLH)\"" },
  { key: "worksFor", label: "Works named for another asset", help: "\"… at MLH\", \"for RSMLI\", \"MLH – …\", \"… – RSMLI\"" },
  { key: "worksForWithBtr", label: "Works for another asset with a BTR recorded as done", help: "\"BTR Approved\", \"BTR … Completed\" on the entry" },
  { key: "shared", label: "Another asset named beside this project", help: "\"Revised Hotel Rooms – MLH & VBH\"" },
  { key: "otherAssetRef", label: "BTR raised under another asset's number", help: "\"BTR Approved: AMA01005-WTRAN-…\"" },
  { key: "marked", label: "Marked inter-asset in the tracker, direction not stated", help: "green in Schedule C, or a marking category below" },
];

export function RulesPanel({ programmeCode, projectName, rules, defaults, assets, canEdit }: { programmeCode: string; projectName: string; rules: ProjectRules; defaults: ProjectRules; assets: AssetRule[]; canEdit: boolean }) {
  const router = useRouter();
  const [r, setR] = useState<ProjectRules>(rules);
  const [list, setList] = useState<AssetRule[]>(assets);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const busy = saving || refreshing;
  const [msg, setMsg] = useState<string | null>(null);
  const set = <K extends keyof ProjectRules>(k: K, v: ProjectRules[K]) => setR((x) => ({ ...x, [k]: v }));
  const changed = (k: keyof ProjectRules) => r[k] !== defaults[k];
  const save = async (body: Record<string, unknown>, done: string) => {
    setSaving(true);
    setMsg(null);
    const e = await send("PUT", { programmeCode, ...body });
    setSaving(false);
    setMsg(e ?? done);
    if (!e) startRefresh(() => router.refresh());
  };
  const area = (k: "ownAliases" | "ignoreWords" | "outPhrases" | "intoPhrases" | "confirmPhrases" | "markCategories", label: string, help: string) => (
    <label className="block">
      <span className={`text-xs font-medium ${changed(k) ? "text-accent" : "text-ink"}`}>{label}</span>
      <textarea className="input mt-1 h-16 w-full text-xs" disabled={!canEdit} value={String(r[k] ?? "")} onChange={(e) => set(k, e.target.value)} />
      <span className="text-[11px] text-muted">{help}</span>
    </label>
  );
  return (
    <details className="card p-0" data-colfilter="off">
      <summary className="cursor-pointer px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Rules for {projectName} – how this report reads the change register {canEdit ? "(click to change)" : ""}</summary>
      <div className="space-y-4 border-t border-line p-4 text-sm">
        <p className="text-xs text-muted">
          Each project words its change register its own way, so each has its own rules. They are read in this order: the wording set below, transfers an entry names (&ldquo;from AYC to VBH&rdquo;, &ldquo;BTR from RSMLI&rdquo;, &ldquo;funds to be returned from MLH&rdquo;), then the rules in the table. An entry placed by hand always stays where it was placed. A rule changed from this project&apos;s default shows in blue.
        </p>
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" disabled={!canEdit} checked={r.namedTransfers} onChange={(e) => set("namedTransfers", e.target.checked)} />
            <span className={changed("namedTransfers") ? "text-accent" : ""}>Read the transfers an entry names in its own words</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" disabled={!canEdit} checked={r.skipCancelled} onChange={(e) => set("skipCancelled", e.target.checked)} />
            <span className={changed("skipCancelled") ? "text-accent" : ""}>Leave out entries rejected, cancelled or superseded (listed under &ldquo;Left out&rdquo;)</span>
          </label>
          <label className="flex items-center gap-2 text-xs sm:col-span-2">
            <input type="checkbox" disabled={!canEdit} checked={r.markedOnly} onChange={(e) => set("markedOnly", e.target.checked)} />
            <span className={changed("markedOnly") ? "text-accent" : ""}>When the report carries the tracker&apos;s inter-asset marks (green in Schedule C), list only marked entries – the rest go under &ldquo;Left out&rdquo; with what the rules read</span>
          </label>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-muted">
              <th className="py-1 pr-3">Rule</th>
              <th className="py-1 pr-3">Example</th>
              <th className="py-1">Goes to</th>
            </tr>
          </thead>
          <tbody>
            {RULES.map((x) => (
              <tr key={x.key} className="border-t border-line">
                <td className={`py-1 pr-3 ${changed(x.key) ? "text-accent" : ""}`}>{x.label}</td>
                <td className="py-1 pr-3 text-muted">{x.help}</td>
                <td className="py-1">
                  <select className="input h-7 w-auto text-xs" disabled={!canEdit} value={String(r[x.key])} onChange={(e) => set(x.key, e.target.value as never)}>
                    {DIRS.map((d) => (
                      <option key={d.v} value={d.v}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid gap-3 sm:grid-cols-2">
          {area("outPhrases", "Wording that puts an entry in Budget out", "One per line. {asset} stands for any other asset's name, {own} for this project – e.g. \"BTR to {asset}\"")}
          {area("intoPhrases", "Wording that puts an entry in Budget in", "One per line – e.g. \"recharge to {asset}\", \"{asset} to fund\"")}
          {area("confirmPhrases", "Wording that puts an entry in To confirm", "One per line – e.g. \"INTER PROJECT ACC Steps for BTR\"")}
          {area("ignoreWords", "Wording that is not a transfer between assets", "One per line, taken out before the entry is read – e.g. The Marina's own \"ACC Steps for BTR\"")}
          {area("markCategories", "Change categories that mark an inter-asset entry", "Comma between – an entry in one of these categories that names another asset counts as marked (e.g. Back Charge)")}
          {area("ownAliases", "Other names of this project", "Comma between – names that mean this project, not another asset")}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => save({ rules: r }, "Rules saved – the lists below follow them.")}>
              Save rules for this project
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={busy}
              onClick={() => {
                setR(defaults);
                void save({ reset: true }, "Rules put back to this project's defaults.");
              }}
            >
              Put back the defaults
            </button>
            {refreshing ? <span className="text-xs text-muted">Saving… updating the lists</span> : msg && <span className="text-xs text-muted">{msg}</span>}
          </div>
        )}
        <div>
          <div className="text-xs font-medium text-ink">Assets (shared by every project)</div>
          <p className="text-[11px] text-muted">The number is the three-digit project number in contract codes and references (006 in CN.006C22). &ldquo;Also called&rdquo; lists the other names the registers use, comma between; &ldquo;Not this asset&rdquo; lists wording that only looks like it (&ldquo;Blue Wellness&rdquo; is a subcontractor).</p>
          <table className="mt-1 w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-muted">
                <th className="py-1 pr-2">Asset</th>
                <th className="py-1 pr-2">No</th>
                <th className="py-1 pr-2">Also called</th>
                <th className="py-1 pr-2">Not this asset</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((a, i) => (
                <tr key={i} className="border-t border-line">
                  {(["name", "code", "aliases", "notAliases"] as const).map((k) => (
                    <td key={k} className="py-1 pr-2">
                      <input
                        className={`input h-7 w-full text-xs ${k === "code" ? "max-w-[4rem]" : ""}`}
                        disabled={!canEdit}
                        value={String(a[k] ?? "")}
                        onChange={(e) => setList((l) => l.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))}
                      />
                    </td>
                  ))}
                  <td className="py-1">
                    {canEdit && (
                      <button type="button" className="text-[11px] text-red-700 hover:underline" onClick={() => setList((l) => l.filter((_, j) => j !== i))}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && (
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setList((l) => [...l, { name: "", code: "", aliases: "", notAliases: "" }])}>
                Add an asset
              </button>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => save({ assets: list }, "Assets saved.")}>
                Save assets
              </button>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

/** add an entry the rules did not find, by its item number */
export function AddEntry({ programmeCode, assets }: { programmeCode: string; assets: string[] }) {
  const router = useRouter();
  const [itemNo, setItemNo] = useState("");
  const [where, setWhere] = useState<Where>("out");
  const [who, setWho] = useState(assets[0] ?? "");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const busy = saving || refreshing;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium">Add an entry the rules missed:</span>
      <input className="input h-7 w-36 text-xs" placeholder="Item no (CH-006C72-9)" value={itemNo} onChange={(e) => setItemNo(e.target.value)} />
      <select className="input h-7 w-auto text-xs" value={where} onChange={(e) => setWhere(e.target.value as Where)}>
        {WHERE.filter((w) => w.v !== "auto" && w.v !== "exclude").map((w) => (
          <option key={w.v} value={w.v}>
            {w.label}
          </option>
        ))}
      </select>
      <select className="input h-7 w-auto max-w-[16rem] text-xs" value={who} onChange={(e) => setWho(e.target.value)}>
        {assets.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <input className="input h-7 w-48 text-xs" placeholder="Note – optional" value={note} onChange={(e) => setNote(e.target.value)} />
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={busy || !itemNo.trim()}
        onClick={async () => {
          setSaving(true);
          const e = await send("POST", { programmeCode, itemNo: itemNo.trim(), dir: where, asset: who, note });
          setSaving(false);
          setMsg(e ?? `${itemNo.trim()} added.`);
          if (!e) {
            setItemNo("");
            setNote("");
            startRefresh(() => router.refresh());
          }
        }}
      >
        {busy ? "Saving…" : "Add"}
      </button>
      {msg && !refreshing && <span className="text-muted">{msg}</span>}
    </div>
  );
}
