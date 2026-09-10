/* Reads an .xlsx row by row in a separate process and writes the cell values as JSON.
   Run by src/lib/workbook/read.ts so a workbook that is too big for the memory limit
   cannot take the web server down with it.
   Usage: node read-workbook.cjs <input.xlsx> <output.json> */
const ExcelJS = require("exceljs");
const fs = require("node:fs");

const MAX_ROWS_PER_SHEET = 20000;
const [input, output] = process.argv.slice(2);

function plain(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return plain(v.result);
    if ("text" in v) return String(v.text);
    if ("error" in v) return null;
    if ("hyperlink" in v) return plain(v.text);
    return null;
  }
  return v;
}

(async () => {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(input, { worksheets: "emit", sharedStrings: "cache", styles: "cache", hyperlinks: "ignore", entries: "ignore" });
  const out = fs.createWriteStream(output);
  out.write("[");
  let firstSheet = true;
  for await (const ws of reader) {
    let kept = 0;
    let truncated = false;
    let rowCount = 0;
    const rows = [];
    for await (const row of ws) {
      if (kept >= MAX_ROWS_PER_SHEET) {
        truncated = true;
        break;
      }
      const values = row.values;
      if (!Array.isArray(values)) continue;
      const cells = values.map(plain);
      if (!cells.some((v) => v !== null && v !== "")) continue;
      rows.push([row.number, cells]);
      rowCount = row.number;
      kept++;
    }
    out.write((firstSheet ? "" : ",") + JSON.stringify({ name: ws.name || `Sheet${ws.id}`, rowCount, truncated, rows }));
    firstSheet = false;
  }
  out.write("]");
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
})().catch((e) => {
  console.error(e && e.message ? e.message : String(e));
  process.exit(2);
});
