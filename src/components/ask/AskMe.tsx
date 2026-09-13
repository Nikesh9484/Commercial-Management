"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Copy, Check, Loader2, MessageSquareText, Eraser } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface Turn {
  role: "user" | "assistant";
  text: string;
  summary?: string;
  usage?: string;
}

const EXAMPLES = [
  "What is the anticipated final account and how has it moved since the last report?",
  "List every open early warning with its value and who raised it.",
  "Which bonds or insurances expire in the next 60 days?",
  "Summarise the EOT assessments issued to date and the days granted per contractor.",
  "Which contracts have late IPCs or late payments this period?",
  "Draft a short note for the client on the change management position this month.",
];

/** ASK ME – the assistant button in the top bar and its side panel. */
export function AskMe({ project, period }: { project: string; period: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || configured !== null) return;
    fetch("/api/ask")
      .then((r) => r.json())
      .then((j) => setConfigured(!!j.configured))
      .catch(() => setConfigured(false));
  }, [open, configured]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  async function send(q?: string) {
    const text = (q ?? question).trim();
    if (!text || busy) return;
    setQuestion("");
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((cur) => [...cur, { role: "user", text }]);
    setBusy(true);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, history }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(j.error ?? "The assistant could not answer.", "error");
        setTurns((cur) => [...cur, { role: "assistant", text: `Sorry – ${j.error ?? "the assistant could not answer."}` }]);
      } else {
        setTurns((cur) => [...cur, { role: "assistant", text: j.answer, summary: j.summary, usage: j.usage }]);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, i: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast("Could not copy – select the text and copy it by hand.", "error");
    }
  }

  const latest = [...turns].reverse().find((t) => t.role === "assistant" && t.summary);

  return (
    <>
      <button
        className="askme-btn inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-white shadow-md transition hover:brightness-110"
        onClick={() => setOpen(true)}
        title="Ask anything about this project in plain English"
      >
        <Sparkles size={15} /> <span className="hidden sm:inline">ASK ME</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-white text-ink shadow-2xl">
            <div className="askme-head flex items-center justify-between px-4 py-3 text-white">
              <div className="flex items-center gap-2">
                <Sparkles size={18} />
                <div>
                  <div className="text-sm font-semibold">ASK ME</div>
                  <div className="text-[11px] text-white/80">
                    {project}
                    {period ? ` · ${period}` : ""} · searches every register, report and library
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {turns.length > 0 && (
                  <button className="rounded p-1.5 hover:bg-white/15" onClick={() => setTurns([])} title="Start a new conversation">
                    <Eraser size={16} />
                  </button>
                )}
                <button className="rounded p-1.5 hover:bg-white/15" onClick={() => setOpen(false)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {configured === false && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  <b>ASK ME is not switched on for this server.</b> Ask the administrator to add <code>ANTHROPIC_API_KEY</code> in the hosting settings (Render → Environment) and redeploy. Until then questions cannot be answered.
                </div>
              )}
              {turns.length === 0 && (
                <div className="space-y-3 text-sm">
                  <p className="text-muted">
                    Ask a question in plain English about the project and reporting period selected in the top bar. The assistant reads the cost report, the movement, every register, the report library and the EOT and contract libraries, and answers with the figures and references, ending with a professional summary you can copy and paste.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLES.map((e) => (
                      <button key={e} className="rounded-full border border-line bg-slate-50 px-3 py-1 text-left text-xs hover:bg-slate-100" onClick={() => send(e)} disabled={busy || configured === false}>
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {turns.map((t, i) =>
                t.role === "user" ? (
                  <div key={i} className="ml-8 rounded-2xl rounded-tr-sm bg-navy/90 px-4 py-2 text-sm text-white">
                    {t.text}
                  </div>
                ) : (
                  <div key={i} className="mr-4 space-y-2">
                    <div className="rounded-2xl rounded-tl-sm border border-line bg-slate-50 px-4 py-3 text-sm">
                      <Answer text={t.summary ? t.text.replace(/\n*#*\s*summary for copy-paste[\s\S]*$/i, "").trim() : t.text} />
                    </div>
                    {t.summary && (
                      <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-3 text-sm">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                            <MessageSquareText size={13} /> Summary for copy-paste
                          </span>
                          <button className="btn btn-secondary btn-sm" onClick={() => copy(t.summary!, i)}>
                            {copied === i ? <Check size={14} /> : <Copy size={14} />} {copied === i ? "Copied" : "Copy"}
                          </button>
                        </div>
                        <div className="whitespace-pre-wrap text-ink">{t.summary}</div>
                      </div>
                    )}
                    {t.usage && <div className="text-[11px] text-muted">{t.usage}</div>}
                  </div>
                ),
              )}
              {busy && (
                <div className="mr-4 flex items-center gap-2 rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm text-muted">
                  <Loader2 size={16} className="animate-spin" /> Reading the whole project and writing the answer… this can take a minute for a large question.
                </div>
              )}
              <div ref={bottom} />
            </div>

            <div className="border-t border-line p-3">
              <div className="flex items-end gap-2">
                <textarea
                  className="input min-h-[3rem] flex-1 resize-y"
                  placeholder={latest ? "Ask a follow-up question…" : "Type your question in English…"}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  disabled={busy || configured === false}
                />
                <button className="btn btn-primary" onClick={() => send()} disabled={busy || !question.trim() || configured === false}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Ask
                </button>
              </div>
              <div className="mt-1 text-[11px] text-muted">Enter to send · Shift+Enter for a new line. Answers use the project and period in the top bar.</div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}

/** A light rendering of the assistant's text: headings, bullets, bold and simple pipe tables. */
function Answer({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  const inline = (s: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, n) => (p.startsWith("**") && p.endsWith("**") ? <b key={n}>{p.slice(2, -2)}</b> : <span key={n}>{p}</span>));
  };
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const rows: string[][] = [];
      const head = l.split("|").slice(1, -1).map((c) => c.trim());
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      out.push(
        <div key={key++} className="my-2 overflow-x-auto">
          <table className="data w-full text-xs">
            <thead>
              <tr>{head.map((h, n) => <th key={n}>{inline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, n) => (
                <tr key={n}>{r.map((c, m) => <td key={m} className={/^[-+]?[\d,.]+%?$/.test(c) ? "tnum text-right" : ""}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const h = /^\s*(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      out.push(<div key={key++} className={`mt-2 font-semibold ${h[1].length <= 2 ? "text-sm" : "text-xs uppercase tracking-wide text-muted"}`}>{inline(h[2])}</div>);
      i++;
      continue;
    }
    const b = /^\s*[-*•]\s+(.*)$/.exec(l);
    if (b) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={key++} className="my-1 list-disc space-y-0.5 pl-5">
          {items.map((it, n) => <li key={n}>{inline(it)}</li>)}
        </ul>,
      );
      continue;
    }
    const num = /^\s*(\d+)[.)]\s+(.*)$/.exec(l);
    if (num) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      out.push(
        <ol key={key++} className="my-1 list-decimal space-y-0.5 pl-5">
          {items.map((it, n) => <li key={n}>{inline(it)}</li>)}
        </ol>,
      );
      continue;
    }
    if (l.trim()) out.push(<p key={key++} className="my-1">{inline(l)}</p>);
    i++;
  }
  return <>{out}</>;
}
