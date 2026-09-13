/* Reads an .xlsx row by row in a separate process and writes the cell values as JSON.
   Run by src/lib/workbook/read.ts so a workbook that is too big for the memory limit
   cannot take the web server down with it.
   Usage: node read-workbook.cjs <input.xlsx> <output.json> */
const ExcelJS = require("exceljs");
const fs = require("node:fs");

const MAX_ROWS_PER_SHEET = 20000;
const [input, output] = process.argv.slice(2);

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
  out.write("[");
  let firstSheet = true;
  for await (const ws of reader) {
    let kept = 0;
    let truncated = false;
    let rowCount = 0;
    // rows are written as they stream past, so a big sheet never sits whole in memory
    out.write((firstSheet ? "" : ",") + `{"name":${JSON.stringify(ws.name || `Sheet${ws.id}`)},"rows":[`);
    let firstRow = true;
    for await (const row of ws) {
      if (kept >= MAX_ROWS_PER_SHEET) {
        truncated = true;
        break;
      }
      const values = row.values;
      if (!Array.isArray(values)) continue;
      const cells = values.map(plain);
      if (!cells.some((v) => v !== null && v !== "")) continue;
      if (!out.write((firstRow ? "" : ",") + JSON.stringify([row.number, cells]))) await new Promise((r) => out.once("drain", r));
      firstRow = false;
      rowCount = row.number;
      kept++;
    }
    out.write(`],"rowCount":${rowCount},"truncated":${truncated}}`);
    firstSheet = false;
  }
  out.write("]");
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  if (source !== input) fs.unlinkSync(source);
})().catch((e) => {
  console.error(e && e.message ? e.message : String(e));
  process.exit(2);
});
