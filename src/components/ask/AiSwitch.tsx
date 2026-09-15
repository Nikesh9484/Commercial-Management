"use client";

import { useEffect, useState } from "react";
import { Plug, PlugZap, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/**
 * Connect / disconnect the AI service, in the top bar beside ASK ME because that is where the spend
 * happens. Off, the dashboard keeps working in full – every report, figure and written summary is
 * produced by its own rules – and only the three things that call out stop: reading a document into a
 * library, ASK ME, and drafting a Claim EAR.
 */
export function AiSwitch({ canChange }: { canChange: boolean }) {
  const toast = useToast();
  const [state, setState] = useState<{ enabled: boolean; keyPresent: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/ai-switch")
      .then((r) => r.json())
      .then((j) => setState({ enabled: !!j.enabled, keyPresent: !!j.keyPresent }))
      .catch(() => undefined);
  }, []);

  if (!state) return null;
  const on = state.enabled && state.keyPresent;

  async function toggle() {
    if (!canChange || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ai-switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !state!.enabled }) });
      const j = await res.json();
      if (!res.ok) return toast(j.error ?? "Could not change it.", "error");
      setState({ enabled: !!j.enabled, keyPresent: !!j.keyPresent });
      toast(j.enabled ? "AI connected. ASK ME, document reading and Claim EAR are available again." : "AI disconnected. Nothing else changes – every report and summary is produced without it.");
    } finally {
      setBusy(false);
    }
  }

  const title = !state.keyPresent
    ? "No AI key is set on this server, so the AI features cannot run. Add ANTHROPIC_API_KEY in the hosting settings."
    : state.enabled
      ? "AI is connected. Click to disconnect – ASK ME, document reading and Claim EAR stop, and nothing is charged. Reports are unaffected."
      : "AI is disconnected. Click to connect ASK ME, document reading and Claim EAR.";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!canChange || busy || !state.keyPresent}
      title={title}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${
        on ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/25" : "border-white/25 bg-white/10 text-blue-100/80 hover:bg-white/20"
      } ${!canChange || !state.keyPresent ? "cursor-default opacity-70" : ""}`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : on ? <PlugZap size={14} /> : <Plug size={14} />}
      <span className="hidden lg:inline">{!state.keyPresent ? "AI: no key" : on ? "AI on" : "AI off"}</span>
    </button>
  );
}
