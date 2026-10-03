"use client";

import { useEffect } from "react";
import { selectedTableRows, tableClipboard } from "@/lib/copy-rows";

/**
 * Makes Ctrl+C on rows selected in any table of the dashboard copy them as clean cells: tab-separated
 * text (so Excel lands each value in its own cell) plus an HTML table (for Word and Outlook), without
 * the edit buttons, icons and "—" placeholders the page shows.
 */
export function CopyTables() {
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, [contenteditable=true]") || target.closest("[data-rawcopy]"))) return;
      const sel = window.getSelection();
      if (!sel) return;
      const picked = selectedTableRows(sel);
      if (!picked || !picked.rows.length || !e.clipboardData) return;
      const { text, html } = tableClipboard(picked.headers, picked.rows);
      e.clipboardData.setData("text/plain", text);
      e.clipboardData.setData("text/html", html);
      e.preventDefault();
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, []);
  return null;
}
