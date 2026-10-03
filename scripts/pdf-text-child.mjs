// Reads the selectable text of a (large) PDF: the file path given, printed as JSON { text, total }.
// Runs as its own process, with its own memory cap, so a very large contract pack cannot take the
// server down – if it fails, the document is still kept, only its text goes unread.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const file = process.argv[2];
const max = Number(process.argv[3] || 600000);
const { PDFParse } = require("pdf-parse");
const parser = new PDFParse({ data: fs.readFileSync(file) });
try {
  const r = await parser.getText();
  process.stdout.write(JSON.stringify({ text: String(r.text ?? "").slice(0, max), total: r.total ?? 0 }));
} finally {
  await parser.destroy?.();
}
