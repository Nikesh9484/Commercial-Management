"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Check } from "lucide-react";

export function PasswordForm() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== again) return setError("The two new passwords do not match.");
    setBusy(true);
    const r = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, next }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(j.error ?? "Could not change the password.");
    setDone(true);
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 1200);
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-5">
      <label className="block text-sm">
        <span className="text-xs font-medium text-muted">Current password</span>
        <input type="password" className="input mt-1" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </label>
      <label className="block text-sm">
        <span className="text-xs font-medium text-muted">New password</span>
        <input type="password" className="input mt-1" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} />
        <span className="mt-1 block text-[11px] text-muted">At least 10 characters with letters and numbers. Not your name or email, and not something easy to guess.</span>
      </label>
      <label className="block text-sm">
        <span className="text-xs font-medium text-muted">New password again</span>
        <input type="password" className="input mt-1" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={10} />
      </label>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {done && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <Check size={16} /> Password changed. Taking you to the dashboard…
        </div>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy || done}>
        <KeyRound size={16} /> {busy ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
