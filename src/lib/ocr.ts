import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { pdfjsOptions } from "./packs/positioned";

/**
 * Scanned pages (a certificate of insurance, a bank guarantee) carry no text: their pages are drawn
 * and read by the OCR engine, which runs as a separate short-lived process so its memory comes back
 * when it is done. When the engine is not installed the pages are simply left unread.
 */

const LANG = path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz");
const CHILD = path.join(process.cwd(), "scripts", "ocr-child.mjs");

export function ocrAvailable(): boolean {
  return fs.existsSync(LANG) && fs.existsSync(CHILD) && fs.existsSync(path.join(process.cwd(), "node_modules", "tesseract.js"));
}

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
  if (fs.existsSync(worker)) pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
  return pdfjs;
}

/** Draws the pages asked for (1-based) as PNGs. */
export async function renderPages(bytes: Buffer, pageNos: number[], scale = 2): Promise<Map<number, Buffer>> {
  const out = new Map<number, Buffer>();
  if (!pageNos.length) return out;
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), ...pdfjsOptions() }).promise;
  try {
    for (const n of pageNos) {
      if (n < 1 || n > doc.numPages) continue;
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      await page.render({ canvasContext: canvas.getContext("2d") as never, viewport: vp, canvas: canvas as never }).promise;
      out.set(n, canvas.toBuffer("image/png"));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

/** The text of the given pages of a PDF, read by OCR. Pages that could not be read come back empty. */
export async function ocrPdfPages(bytes: Buffer, pageNos: number[], opts: { timeoutMs?: number } = {}): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!pageNos.length || !ocrAvailable()) return out;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commercial-ocr-"));
  try {
    const pngs = await renderPages(bytes, pageNos);
    for (const [n, png] of pngs) fs.writeFileSync(path.join(dir, `${String(n).padStart(4, "0")}.png`), png);
    if (!pngs.size) return out;
    const json = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--max-old-space-size=256", CHILD, dir], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("OCR took too long"));
      }, opts.timeoutMs ?? 180_000);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`OCR failed (${code}): ${stderr.slice(0, 300)}`));
      });
    });
    const parsed = JSON.parse(json) as Record<string, string>;
    for (const [f, text] of Object.entries(parsed)) out.set(Number(f.replace(/\.png$/, "")), text);
  } catch (e) {
    console.error("OCR could not read the scanned pages:", e);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return out;
}
