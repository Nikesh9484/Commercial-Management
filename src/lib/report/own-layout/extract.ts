import JSZip from "jszip";
import type { XWorkbook } from "./xlsx";

/**
 * One tab of the project's report workbook as a workbook of its own – the sheet exactly as it is in the
 * template (its formulas, its formatting, its comments and drawings), with the sheets its formulas look
 * at kept beside it, hidden, so every formula still finds what it refers to. The thousands of defined
 * names, the other tabs and their parts stay behind: the file opens in a moment.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** the sheet names a sheet's formulas refer to: 'Data Input'!B3, SCHD B!A1 */
function referencedSheets(xml: string, names: string[]): string[] {
  const out = new Set<string>();
  const formulas = xml.match(/<f\b[^>]*>[^<]*<\/f>|<definedName\b[^>]*>[^<]*<\/definedName>|<(?:conditionalFormatting|dataValidation)\b[\s\S]*?<\/(?:conditionalFormatting|dataValidation)>/g)?.join("\n") ?? "";
  for (const n of names) {
    const quoted = `'${n.replace(/'/g, "''")}'!`;
    if (formulas.includes(esc(quoted)) || formulas.includes(quoted)) out.add(n);
    else if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(n) && new RegExp(`(?<![A-Za-z0-9_.'])${n}!`).test(formulas)) out.add(n);
  }
  return [...out];
}

/** Formulas that reach one of the sheets named lose their formula and keep their last value (shared formulas with their dependants). */
function freezeOutside(xml: string, gone: string[]): string {
  if (!gone.length) return xml;
  const reaches = (f: string) => referencedSheets(`<f>${f}</f>`, gone).length > 0;
  const frozenShared = new Set<string>();
  for (const m of xml.matchAll(/<f\b([^>]*)>([^<]*)<\/f>/g)) {
    const si = m[1].match(/\bsi="(\d+)"/)?.[1];
    if (si !== undefined && /t="shared"/.test(m[1]) && reaches(m[2])) frozenShared.add(si);
  }
  return xml.replace(/<f\b([^>]*)>([^<]*)<\/f>|<f\b([^>]*)\/>/g, (whole, a1?: string, text?: string, a2?: string) => {
    const attrs = a1 ?? a2 ?? "";
    const si = attrs.match(/\bsi="(\d+)"/)?.[1];
    if (si !== undefined && frozenShared.has(si)) return "";
    if (text && reaches(text)) return "";
    return whole;
  });
}

function resolve(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

export async function extractSheets(wb: XWorkbook, keep: string[]): Promise<Buffer> {
  wb.flush();
  const src = wb.zip;
  const names = wb.sheets.map((s) => s.name);
  const workbookXml = (await src.file("xl/workbook.xml")?.async("string")) ?? "";
  // the sheets kept: the ones asked for, with every sheet their formulas (and dropdown lists) refer to
  // beside them, hidden. Those helper sheets keep their own formulas where they refer to a sheet that is
  // kept, and hold their last calculated value where they would reach a sheet that is not – so the
  // tracker's own tab is exactly the template's, and nothing in the file points at a sheet that is gone.
  const kept: string[] = [];
  const xmlOf = new Map<string, string>();
  for (const n of keep) {
    const s = wb.sheet(n);
    if (!s || kept.includes(s.name)) continue;
    kept.push(s.name);
    xmlOf.set(s.name, (await src.file(s.path)?.async("string")) ?? "");
  }
  for (const n of [...kept]) for (const ref of referencedSheets(xmlOf.get(n)!, names)) {
    const s = wb.sheet(ref);
    if (!s || kept.includes(s.name)) continue;
    kept.push(s.name);
    xmlOf.set(s.name, (await src.file(s.path)?.async("string")) ?? "");
  }
  if (!kept.length) throw new Error("The sheet to extract is not in the workbook.");
  const helpers = kept.slice(keep.length);
  for (const n of helpers) xmlOf.set(n, freezeOutside(xmlOf.get(n)!, names.filter((x) => !kept.includes(x))));

  const out = new JSZip();
  const copied = new Set<string>();
  const copy = async (path: string) => {
    if (copied.has(path)) return;
    const f = src.file(path);
    if (!f) return;
    copied.add(path);
    out.file(path, await f.async("nodebuffer"));
    // the part's own relationships: its drawing, comments, charts, images, printer settings …
    const dir = path.split("/").slice(0, -1).join("/");
    const relPath = `${dir}/_rels/${path.split("/").pop()}.rels`;
    const rels = await src.file(relPath)?.async("string");
    if (!rels) return;
    copied.add(relPath);
    out.file(relPath, rels);
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = m[0];
      if (/TargetMode="External"/.test(tag)) continue;
      const target = tag.match(/\bTarget="([^"]+)"/)?.[1];
      if (!target) continue;
      const type = tag.match(/\bType="[^"]*\/([a-zA-Z]+)"/)?.[1] ?? "";
      if (type === "worksheet" || type === "externalLink" || type === "pivotCacheDefinition") continue;
      await copy(resolve(path, target));
    }
  };
  for (const n of kept) await copy(wb.sheet(n)!.path);
  for (const n of helpers) out.file(wb.sheet(n)!.path, xmlOf.get(n)!);
  // the workbook-level parts every sheet needs
  const wbRels = (await src.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const shared: { type: string; target: string }[] = [];
  for (const m of wbRels.matchAll(/<Relationship\b[^>]*>/g)) {
    const type = m[0].match(/\bType="([^"]+)"/)?.[1] ?? "";
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1] ?? "";
    if (/\/(styles|theme|sharedStrings|sheetMetadata|person)$/.test(type) && target) {
      shared.push({ type, target });
      await copy(resolve("xl/workbook.xml", target));
    }
  }
  // workbook.xml afresh: the sheets kept (the first one visible, the rest hidden), the defined names of those sheets
  const sheetIdx = new Map(names.map((n, i) => [n, i]));
  const keptIdx = new Map(kept.map((n, i) => [sheetIdx.get(n)!, i]));
  const definedNames: string[] = [];
  const identifiers = new Set<string>();
  for (const xml of xmlOf.values()) for (const m of xml.matchAll(/<f\b[^>]*>([^<]*)<\/f>/g)) for (const id of m[1].matchAll(/(?<![A-Za-z0-9_.!'])([A-Za-z_][A-Za-z0-9_.]{1,})(?![A-Za-z0-9_.(!])/g)) identifiers.add(id[1]);
  for (const m of workbookXml.matchAll(/<definedName\b([^>]*)>([^<]*)<\/definedName>/g)) {
    const attrs = m[1];
    const name = attrs.match(/\bname="([^"]+)"/)?.[1] ?? "";
    const local = attrs.match(/\blocalSheetId="(\d+)"/)?.[1];
    const refersTo = m[2];
    if (/#REF!/.test(refersTo)) continue;
    const refs = referencedSheets(`<definedName>${refersTo}</definedName>`, names);
    if (refs.some((r) => !kept.includes(r))) continue;
    if (local !== undefined) {
      const idx = keptIdx.get(Number(local));
      if (idx === undefined) continue;
      definedNames.push(`<definedName${attrs.replace(/\blocalSheetId="\d+"/, `localSheetId="${idx}"`)}>${refersTo}</definedName>`);
    } else if (identifiers.has(name) && refs.length) definedNames.push(`<definedName${attrs}>${refersTo}</definedName>`);
  }
  const workbookPr = workbookXml.match(/<workbookPr\b[^>]*\/>/)?.[0]?.replace(/\s*codeName="[^"]*"/, "") ?? "<workbookPr/>";
  const sheetsXml = kept.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}"${i ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("");
  out.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${workbookPr}<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews><sheets>${sheetsXml}</sheets>${definedNames.length ? `<definedNames>${definedNames.join("")}</definedNames>` : ""}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
  );
  const sheetRels = kept.map((n, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${wb.sheet(n)!.path.replace(/^xl\//, "")}"/>`);
  const otherRels = shared.map((r, i) => `<Relationship Id="rId${kept.length + i + 1}" Type="${r.type}" Target="${r.target}"/>`);
  out.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[...sheetRels, ...otherRels].join("")}</Relationships>`);
  out.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  // content types: the defaults as they were, an override only for a part that is in the file
  const ct = (await src.file("[Content_Types].xml")?.async("string")) ?? "";
  const defaults: string[] = ct.match(/<Default\b[^>]*\/>/g) ?? [];
  const overrides = (ct.match(/<Override\b[^>]*\/>/g) ?? []).filter((o) => {
    const part = o.match(/\bPartName="([^"]+)"/)?.[1] ?? "";
    return !!out.file(part.replace(/^\//, ""));
  });
  const needed = new Set(defaults.map((d) => d.match(/Extension="([^"]+)"/)?.[1]?.toLowerCase()));
  for (const ext of ["rels", "xml"]) if (!needed.has(ext)) defaults.push(ext === "rels" ? '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' : '<Default Extension="xml" ContentType="application/xml"/>');
  if (!overrides.some((o) => o.includes('PartName="/xl/workbook.xml"'))) overrides.push('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>');
  out.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join("")}${overrides.join("")}</Types>`);
  return Buffer.from(await out.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
}
