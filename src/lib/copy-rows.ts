"use client";

/** Text for one cell when rows are copied: plain, single-line, no placeholders. */
function clean(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/\s*\n\s*/g, " ").trim();
  return s === "—" || s === "–" ? "" : s;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Tab-separated text and an HTML table for the same rows, so a paste lands in cells in Excel and reads as a table in Word / Outlook. */
export function tableClipboard(headers: string[], rows: unknown[][]): { text: string; html: string } {
  const text = [headers, ...rows].map((r) => r.map((c) => clean(c).replace(/\t/g, " ")).join("\t")).join("\n");
  const html =
    `<table border="1" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:10pt"><thead><tr>` +
    headers.map((h) => `<th style="background:#e2e9f4;text-align:left;padding:2px 6px">${esc(clean(h))}</th>`).join("") +
    `</tr></thead><tbody>` +
    rows.map((r) => `<tr>${r.map((c) => `<td style="padding:2px 6px">${esc(clean(c))}</td>`).join("")}</tr>`).join("") +
    `</tbody></table>`;
  return { text, html };
}

/** Puts text (and, where the browser allows it, HTML) on the clipboard. */
export async function writeClipboard(text: string, html?: string): Promise<boolean> {
  try {
    if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the hidden textarea */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** The rows of a table that a text selection touches, as cell text without the buttons and icons. */
export function selectedTableRows(sel: Selection): { headers: string[]; rows: string[][] } | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const table = start?.closest("table");
  if (!table) return null;
  // a heading keeps the label inside its sort button; a body cell drops its buttons (edit, history…) and icons
  const cellText = (cell: Element, heading = false) => {
    const copy = cell.cloneNode(true) as Element;
    copy.querySelectorAll(heading ? "svg, [data-nocopy], input" : "button, svg, [data-nocopy], input[type=checkbox]").forEach((n) => n.remove());
    return clean(copy.textContent ?? "");
  };
  const trs = [...table.querySelectorAll("tr")].filter((tr) => range.intersectsNode(tr));
  const body = trs.filter((tr) => !tr.closest("thead"));
  if (!body.length) return null;
  const rows = body.map((tr) => [...tr.querySelectorAll("th, td")].filter((c) => !(c as HTMLElement).dataset.nocopy && !c.querySelector("input[type=checkbox]:only-child")).map((c) => cellText(c)));
  const headTr = table.querySelector("thead tr:last-child");
  const headers = headTr ? [...headTr.querySelectorAll("th, td")].filter((c) => !(c as HTMLElement).dataset.nocopy && !c.querySelector("input[type=checkbox]:only-child")).map((c) => cellText(c, true)) : [];
  // drop the trailing Actions column (buttons only) when it is empty on every row
  const width = Math.max(...rows.map((r) => r.length));
  const trimmed = rows.map((r) => r.slice(0, width));
  return { headers: headers.slice(0, width), rows: trimmed };
}
