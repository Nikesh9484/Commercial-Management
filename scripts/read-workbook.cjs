/* Reads an .xlsx row by row in a separate process and writes the cell values as JSON.
   Run by src/lib/workbook/read.ts so a workbook that is too big for the memory limit
   cannot take the web server down with it.
   Usage: node read-workbook.cjs <input.xlsx> <output.json> */
const ExcelJS = require("exceljs");
const fs = require("node:fs");

const MAX_ROWS_PER_SHEET = 20000;
const [input, output] = process.argv.slice(2);
/* Options from the caller (JSON in WORKBOOK_READER_OPTS):
     preview  – keep only the first N non-empty rows of every sheet (a quick look at what the file is)
     sheets   – regular expressions (sources, case-insensitive); only sheets whose name matches are read
     maxCols  – cells past this column are dropped (helper columns at the far right of a big tracker)
   The output is one JSON value per line: {"sheet":name} … [row, cells, struck?, fills?] … {"end":true,"rowCount":n,"truncated":b} */
let opts = {};
try {
  opts = JSON.parse(process.env.WORKBOOK_READER_OPTS || "{}") || {};
} catch {
  opts = {};
}
const wanted = Array.isArray(opts.sheets) && opts.sheets.length ? opts.sheets.map((x) => new RegExp(x, "i")) : null;
const previewRows = Number(opts.preview) > 0 ? Number(opts.preview) : 0;
const maxCols = Number(opts.maxCols) > 0 ? Number(opts.maxCols) : 0;

/**
 * A monthly report workbook can carry an enormous list of defined names (one VBH report held
 * 205,000 of them – 17 MB of XML) that the reader would otherwise load whole. Only the sheet
 * values are needed, so the workbook is first re-packed without the defined names and the
 * calculation chain; the copy is small and reads in a quarter of the memory and time.
 * Returns the path to read (the original when nothing needed stripping).
 */
async function slim(file) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const entry = zip.file("xl/workbook.xml");
  if (!entry) return file;
  const wb = await entry.async("string");
  const stripped = wb.replace(/<definedNames>[\s\S]*?<\/definedNames>/, "");
  if (stripped.length === wb.length && !zip.file("xl/calcChain.xml")) return file;
  zip.file("xl/workbook.xml", stripped);
  zip.remove("xl/calcChain.xml");
  const out = `${file}.slim.xlsx`;
  // the slim copy is kept for the next pass over the same file (a preview, then the full read); the caller removes it
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  await new Promise((resolve, reject) => zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE" }).pipe(fs.createWriteStream(out)).on("finish", resolve).on("error", reject));
  return out;
}

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
  const source = await slim(input);
  if (global.gc) global.gc();
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(source, { worksheets: "emit", sharedStrings: "cache", styles: "cache", hyperlinks: "ignore", entries: "ignore" });
  const out = fs.createWriteStream(output);
  const limit = previewRows || MAX_ROWS_PER_SHEET;
  for await (const ws of reader) {
    const name = ws.name || `Sheet${ws.id}`;
    const skip = wanted && !wanted.some((re) => re.test(name));
    let kept = 0;
    let truncated = false;
    let rowCount = 0;
    if (!skip) out.write(`${JSON.stringify({ sheet: name })}\n`);
    // rows are written as they stream past, so a big sheet never sits whole in memory; a sheet that is
    // not wanted (or already previewed) is still run through so the reader moves on to the next one
    for await (const row of ws) {
      if (skip || kept >= limit) {
        if (!skip && !previewRows) truncated = true;
        continue;
      }
      let values = row.values;
      if (!Array.isArray(values)) continue;
      if (maxCols && values.length > maxCols + 1) values = values.slice(0, maxCols + 1);
      const cells = values.map(plain);
      if (!cells.some((v) => v !== null && v !== "")) continue;
      // cells struck through (a change cancelled in the tracker): their column numbers travel with the row
      const struck = [];
      // the shading the tracker gives a row (a colour code such as "FF9AE6DD"): some trackers mark a kind of entry by
      // colour – VBH's Schedule C shades its inter-asset transfers green
      const fills = new Set();
      row.eachCell((c, i) => {
        if (maxCols && i > maxCols) return;
        if (c.font && c.font.strike && c.value !== null && c.value !== undefined && c.value !== "") struck.push(i);
        const f = c.fill;
        if (f && f.type === "pattern" && f.pattern && f.pattern !== "none" && f.fgColor && typeof f.fgColor.argb === "string" && i <= 12) fills.add(f.fgColor.argb.toUpperCase());
      });
      const line = fills.size ? [row.number, cells, struck, [...fills]] : struck.length ? [row.number, cells, struck] : [row.number, cells];
      if (!out.write(`${JSON.stringify(line)}\n`)) await new Promise((r) => out.once("drain", r));
      rowCount = row.number;
      kept++;
    }
    if (!skip) out.write(`${JSON.stringify({ end: true, rowCount, truncated })}\n`);
  }
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
})().catch((e) => {
  console.error(e && e.message ? e.message : String(e));
  process.exit(2);
});
