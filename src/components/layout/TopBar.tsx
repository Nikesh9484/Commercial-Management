"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Menu, LogOut, Lock, Unlock, ChevronDown } from "lucide-react";
import type { AppContext } from "@/lib/context";
import type { UserInfo } from "@/lib/registers/types";
import { ROLE_LABELS } from "@/lib/registers/types";
import { useToast } from "@/components/ui/Toast";

export function TopBar({ context, user, onMenu }: { context: AppContext; user: UserInfo; onMenu: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const canChange = user.role !== "viewer";

  async function change(patch: Record<string, number>) {
    const res = await fetch("/api/context", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast(j.error ?? "Could not change selection.", "error");
      return;
    }
    start(() => router.refresh());
  }

  const assetsForProgramme = context.assets.filter((a) => !context.programme || a.programme_id === context.programme.id);

  const selectCls =
    "w-full max-w-[13rem] truncate rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-sm text-white outline-none focus:bg-white/20 disabled:opacity-80 [&>option]:text-ink";

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-navy px-3 text-white shadow-md sm:px-4">
      <button className="rounded p-1.5 hover:bg-white/10 lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu size={20} />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto sm:gap-4">
        <Selector label="Programme">
          <select
            className={selectCls}
            value={context.programme?.id ?? ""}
            disabled={!canChange || pending}
            onChange={(e) => change({ programme_id: Number(e.target.value) })}
          >
            {context.programmes.length === 0 && <option value="">No programme yet</option>}
            {context.programmes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </Selector>
        <Selector label="Asset">
          <select className={selectCls} value={context.asset?.id ?? ""} disabled={!canChange || pending} onChange={(e) => change({ asset_id: Number(e.target.value) })}>
            {assetsForProgramme.length === 0 && <option value="">No asset yet</option>}
            {assetsForProgramme.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </Selector>
        <Selector label="Reporting period">
          <div className="flex items-center gap-1.5">
            <select className={selectCls} value={context.period?.id ?? ""} disabled={!canChange || pending} onChange={(e) => change({ period_id: Number(e.target.value) })}>
              {context.periods.length === 0 && <option value="">No period yet</option>}
              {context.periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {context.period &&
              (context.period.status === "Locked" ? (
                <span title="Locked (snapshot taken)" className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-200">
                  <Lock size={11} /> Locked
                </span>
              ) : (
                <span title="Open for editing" className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] text-amber-100">
                  <Unlock size={11} /> Open
                </span>
              ))}
          </div>
        </Selector>
      </div>

      <div className="relative">
        <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-white/10" onClick={() => setMenuOpen((o) => !o)}>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-sm font-semibold">{initials(user.name)}</span>
          <span className="hidden text-left sm:block">
            <span className="block text-sm leading-tight">{user.name}</span>
            <span className="block text-[11px] leading-tight text-blue-200/70">{ROLE_LABELS[user.role]}</span>
          </span>
          <ChevronDown size={14} className="hidden sm:block" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-line bg-white p-1 text-ink shadow-xl">
              <div className="px-3 py-2 text-xs text-muted">
                Signed in as
                <div className="truncate font-medium text-ink">{user.email}</div>
                <div>{ROLE_LABELS[user.role]}</div>
              </div>
              <form action="/api/auth/logout" method="post">
                <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-page" type="submit">
                  <LogOut size={15} /> Log out
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

function Selector({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col">
      <span className="hidden text-[10px] uppercase leading-tight tracking-wide text-blue-200/70 sm:block">{label}</span>
      {children}
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}
