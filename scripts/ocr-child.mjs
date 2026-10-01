// Reads the text of scanned pages: one PNG per page in the directory given, printed as JSON { "file.png": "text" }.
// Runs as its own process so the OCR engine's memory is handed back when it finishes.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dir = process.argv[2];
const root = process.cwd();
const { createWorker } = require("tesseract.js");
const langPath = path.join(root, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int");
const out = {};
const worker = await createWorker("eng", 1, { langPath, gzip: true, cacheMethod: "none", logger: () => {} });
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".png")).sort()) {
  try {
    const { data } = await worker.recognize(fs.readFileSync(path.join(dir, f)));
    out[f] = data.text;
  } catch (e) {
    out[f] = "";
    process.stderr.write(`${f}: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}
await worker.terminate();
process.stdout.write(JSON.stringify(out));
