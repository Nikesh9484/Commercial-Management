"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileStack } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/** Starts (or opens) the PVO or DVO Document Pack of a change, straight from its row in the register. */
export function ChangePackButtons({ changeId, stage }: { changeId: number; stage: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  async function go(type: "pvo" | "dvo") {
    setBusy(type);
    try {
      const res = await fetch("/api/packs/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, sourceId: changeId, reuse: true }) });
      const j = (await res.json()) as { error?: string; case?: { id: number }; existing?: boolean };
      if (!res.ok || !j.case) throw new Error(j.error || "The pack could not be started.");
      if (j.existing) toast(`Opening the ${type.toUpperCase()} pack already started for this change.`);
      router.push(`/packs/${type}/${j.case.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong.", "error");
    } finally {
      setBusy("");
    }
  }
  const dvoNext = /^(pvo|vo|ei|dvo)$/i.test(stage);
  return (
    <>
      <button className={`btn btn-sm ${dvoNext ? "btn-ghost" : "btn-secondary"}`} disabled={!!busy} onClick={() => go("pvo")} title="Prepare the PVO pack for this change (opens the pack already started, if any)">
        <FileStack size={13} /> PVO
      </button>
      <button className={`btn btn-sm ${dvoNext ? "btn-secondary" : "btn-ghost"}`} disabled={!!busy} onClick={() => go("dvo")} title="Prepare the DVO pack for this change (opens the pack already started, if any)">
        <FileStack size={13} /> DVO
      </button>
    </>
  );
}
