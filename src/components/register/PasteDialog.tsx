"use client";

import { useEffect, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { FieldDef } from "@/lib/registers/types";

interface Result {
  created: number;
  skipped: number;
  matched: string[];
  ignored: string[];
  renamed: string[];
  errors: { row: number; message: string }[];
}

/** Which pasted headings this tracker understands – worked out on the page so the user sees it before adding. */
function preview(text: string, fields: FieldDef[]): { rows: number; matched: string[]; ignored: string[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return { rows: 0, matched: [], ignored: [] };
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : lines.some((l) => l.includes(";")) ? ";" : ",";
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const known = new Set(fields.flatMap((f) => [norm(f.label), norm(f.key)]));
  const headerAt = lines.findIndex((l) => l.split(sep).some((h) => known.has(norm(h))));
  if (headerAt < 0) return { rows: lines.length - 1, matched: [], ignored: lines[0].split(sep).map((h) => h.trim()).filter(Boolean) };
  const heads = lines[headerAt].split(sep).map((h) => h.trim()).filter(Boolean);
  return { rows: lines.length - headerAt - 1, matched: heads.filter((h) => known.has(norm(h)) && norm(h) !== "id"), ignored: heads.filter((h) => !known.has(norm(h)) || norm(h) === "id") };
}

export function PasteDialog({ registerKey, title, singular, fields, open, initialText, onClose, onDone }: { registerKey: string; title: string; singular: string; fields: FieldDef[]; open: boolean; initialText: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- the box takes the text the paste arrived with each time it opens */
  useEffect(() => {
    if (!open) return;
    setText(initialText);
    setResult(null);
    setError(null);
    if (!initialText && navigator.clipboard?.readText) navigator.clipboard.readText().then((t) => t && /\t|\n/.test(t) && setText(t)).catch(() => {});
  }, [open, initialText]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const p = preview(text, fields);

  async function run() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch(`/api/registers/${registerKey}/paste`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error ?? "The rows could not be added.");
    setResult(j);
    if (j.created) onDone();
  }

  return (
    <Modal
      open={open}
      title={`Paste rows into ${title}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" onClick={run} disabled={!text.trim() || busy || (p.rows > 0 && !p.matched.length)}>
            <ClipboardPaste size={16} /> {busy ? "Adding…" : `Add ${p.rows || ""} ${p.rows === 1 ? singular.toLowerCase() : `${singular.toLowerCase()}s`}`.replace(/\s+/g, " ")}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          Copy rows from any tracker (the Copy button, the copy icon on a row, or select the rows and press Ctrl+C) or from Excel – together with their heading row – and paste them here. Columns are matched by their heading; the ID is ignored, so every row is added as a new {singular.toLowerCase()}. A reference that already exists gets &ldquo;(copy)&rdquo; added so you can renumber it.
        </p>
        <textarea className="input min-h-[10rem] w-full font-mono text-xs" data-rawcopy value={text} onChange={(e) => setText(e.target.value)} placeholder={"Paste here (Ctrl+V)…"} spellCheck={false} />
        {text.trim() && (
          <div className="rounded-md border border-line bg-page px-3 py-2 text-xs">
            <div>
              <span className="font-medium text-ink">{p.rows}</span> row(s) to add.{" "}
              {p.matched.length ? (
                <>
                  Columns recognised: <span className="text-ink">{p.matched.join(", ")}</span>.
                </>
              ) : (
                <span className="text-red-700">No heading row recognised – copy the rows together with their headings.</span>
              )}
            </div>
            {p.ignored.length > 0 && <div className="text-muted">Ignored: {p.ignored.join(", ")}.</div>}
          </div>
        )}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        {result && (
          <div className="rounded-md border border-line bg-page p-3">
            <div className="font-medium text-ink">
              Done: {result.created} added, {result.skipped} empty row(s) skipped, {result.errors.length} error(s).
            </div>
            {result.renamed.length > 0 && <div className="mt-1 text-xs text-muted">Renamed to stay unique: {result.renamed.join("; ")}</div>}
            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-48 list-disc space-y-0.5 overflow-auto pl-5 text-xs text-red-700">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
