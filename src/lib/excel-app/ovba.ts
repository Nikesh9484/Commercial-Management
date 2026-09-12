import CFB from "cfb";

/**
 * Writes a vbaProject.bin (MS-OVBA) from VBA source modules, so a macro-enabled workbook can be
 * produced without Excel: the compound file, the MS-OVBA compressed "dir" and module streams,
 * the PROJECT / PROJECTwm streams and the minimal _VBA_PROJECT performance-cache header.
 */
export interface VbaModule {
  name: string;
  /** standard = .bas module; document = ThisWorkbook / a worksheet code-behind module */
  type: "standard" | "document";
  code: string;
}

/* ------------------------------------------------------------------ MS-OVBA 2.4.1 compression */

/** Compresses a buffer into an MS-OVBA CompressedContainer. */
export function compressContainer(data: Buffer): Buffer {
  const out: number[] = [0x01];
  for (let start = 0; start < data.length; start += 4096) {
    const chunk = data.subarray(start, Math.min(start + 4096, data.length));
    const packed = compressChunk(chunk);
    if (packed.length <= 4096) {
      const size = packed.length + 2; // includes the header
      const header = ((size - 3) & 0x0fff) | 0x3000 | 0x8000;
      out.push(header & 0xff, header >> 8, ...packed);
    } else {
      // incompressible: raw chunk (padded to 4096 bytes, as the format requires)
      const raw = Buffer.alloc(4096);
      chunk.copy(raw);
      const header = 0x0fff | 0x3000;
      out.push(header & 0xff, header >> 8, ...raw);
    }
  }
  return Buffer.from(out);
}

function compressChunk(chunk: Buffer): number[] {
  const out: number[] = [];
  let pos = 0;
  while (pos < chunk.length) {
    const flagIndex = out.length;
    out.push(0);
    let flags = 0;
    for (let bit = 0; bit < 8 && pos < chunk.length; bit++) {
      // copy-token geometry depends on the position within the chunk
      let bitCount = 4;
      while (1 << bitCount < pos) bitCount++;
      const lengthMask = 0xffff >> bitCount;
      const maxLength = lengthMask + 3;
      const maxOffset = 1 << (16 - bitCount);
      let bestLen = 0;
      let bestOff = 0;
      const earliest = Math.max(0, pos - maxOffset);
      for (let cand = pos - 1; cand >= earliest; cand--) {
        let len = 0;
        while (len < maxLength && pos + len < chunk.length && chunk[cand + len] === chunk[pos + len]) len++;
        if (len > bestLen) {
          bestLen = len;
          bestOff = pos - cand;
          if (len === maxLength) break;
        }
      }
      if (bestLen >= 3) {
        const token = ((bestOff - 1) << (16 - bitCount)) | (bestLen - 3);
        out.push(token & 0xff, token >> 8);
        flags |= 1 << bit;
        pos += bestLen;
      } else {
        out.push(chunk[pos]);
        pos++;
      }
    }
    out[flagIndex] = flags;
  }
  return out;
}

/** Decompresses an MS-OVBA CompressedContainer (used to self-check the writer). */
export function decompressContainer(buf: Buffer): Buffer {
  if (buf[0] !== 0x01) throw new Error("bad container signature");
  const out: number[] = [];
  let p = 1;
  while (p < buf.length) {
    const header = buf[p] | (buf[p + 1] << 8);
    const size = (header & 0x0fff) + 3;
    const compressed = (header & 0x8000) !== 0;
    const end = p + size;
    p += 2;
    const chunkStart = out.length;
    if (!compressed) {
      for (let i = 0; i < 4096 && p < end; i++, p++) out.push(buf[p]);
      continue;
    }
    while (p < end) {
      const flags = buf[p++];
      for (let bit = 0; bit < 8 && p < end; bit++) {
        if (flags & (1 << bit)) {
          const token = buf[p] | (buf[p + 1] << 8);
          p += 2;
          const posInChunk = out.length - chunkStart;
          let bitCount = 4;
          while (1 << bitCount < posInChunk) bitCount++;
          const lengthMask = 0xffff >> bitCount;
          const len = (token & lengthMask) + 3;
          const off = (token >> (16 - bitCount)) + 1;
          const from = out.length - off;
          for (let i = 0; i < len; i++) out.push(out[from + i]);
        } else out.push(buf[p++]);
      }
    }
  }
  return Buffer.from(out);
}

/* ------------------------------------------------------------------ dir stream records */

const u16 = (v: number) => Buffer.from([v & 0xff, (v >> 8) & 0xff]);
const u32 = (v: number) => Buffer.from([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);
const mbcs = (s: string) => Buffer.from(s, "latin1");
const utf16 = (s: string) => Buffer.from(s, "utf16le");
const rec = (id: number, payload: Buffer) => Buffer.concat([u16(id), u32(payload.length), payload]);

function dirStream(modules: VbaModule[], projectName: string): Buffer {
  const parts: Buffer[] = [];
  // PROJECTINFORMATION
  parts.push(rec(0x0001, u32(1))); // SYSKIND: 32-bit Windows
  parts.push(rec(0x0002, u32(0x0409))); // LCID
  parts.push(rec(0x0014, u32(0x0409))); // LCIDINVOKE
  parts.push(rec(0x0003, u16(1252))); // CODEPAGE
  parts.push(rec(0x0004, mbcs(projectName))); // NAME
  parts.push(Buffer.concat([rec(0x0005, Buffer.alloc(0)), u16(0x0040), u32(0)])); // DOCSTRING
  parts.push(Buffer.concat([rec(0x0006, Buffer.alloc(0)), u16(0x003d), u32(0)])); // HELPFILEPATH
  parts.push(rec(0x0007, u32(0))); // HELPCONTEXT
  parts.push(rec(0x0008, u32(0))); // LIBFLAGS
  parts.push(Buffer.concat([u16(0x0009), u32(4), u32(1494), u16(0)])); // VERSION
  parts.push(Buffer.concat([rec(0x000c, Buffer.alloc(0)), u16(0x003c), u32(0)])); // CONSTANTS
  // PROJECTREFERENCES: the two libraries every Excel project carries
  const reference = (name: string, libid: string) => {
    parts.push(Buffer.concat([rec(0x0016, mbcs(name)), u16(0x003e), u32(utf16(name).length), utf16(name)]));
    const lib = mbcs(libid);
    parts.push(Buffer.concat([u16(0x000d), u32(4 + lib.length + 4 + 2), u32(lib.length), lib, u32(0), u16(0)]));
  };
  reference("stdole", "*\\G{00020430-0000-0000-C000-000000000046}#2.0#0#C:\\Windows\\System32\\stdole2.tlb#OLE Automation");
  reference("Office", "*\\G{2DF8D04C-5BFA-101B-BDE5-00AA0044DE52}#2.0#0#C:\\Program Files\\Common Files\\Microsoft Shared\\OFFICE16\\MSO.DLL#Microsoft Office 16.0 Object Library");
  // PROJECTMODULES
  parts.push(rec(0x000f, u16(modules.length)));
  parts.push(rec(0x0013, u16(0xffff)));
  for (const m of modules) {
    parts.push(rec(0x0019, mbcs(m.name)));
    parts.push(rec(0x0047, utf16(m.name)));
    parts.push(Buffer.concat([rec(0x001a, mbcs(m.name)), u16(0x0032), u32(utf16(m.name).length), utf16(m.name)]));
    parts.push(Buffer.concat([rec(0x001c, Buffer.alloc(0)), u16(0x0048), u32(0)]));
    parts.push(rec(0x0031, u32(0))); // OFFSET: source starts at byte 0 of the module stream
    parts.push(rec(0x001e, u32(0))); // HELPCONTEXT
    parts.push(rec(0x002c, u16(0xffff))); // COOKIE
    parts.push(Buffer.concat([u16(m.type === "document" ? 0x0022 : 0x0021), u32(0)])); // TYPE
    parts.push(Buffer.concat([u16(0x002b), u32(0)])); // terminator
  }
  parts.push(Buffer.concat([u16(0x0010), u32(0)]));
  return Buffer.concat(parts);
}

/* ------------------------------------------------------------------ PROJECT stream */

/** MS-OVBA 2.4.3 encryption of the PROJECT stream properties (protection state, password, visibility). */
function encryptProperty(data: Buffer, projKey: number, seed: number): string {
  const versionEnc = seed ^ 2;
  const projKeyEnc = seed ^ projKey;
  const out = [seed, versionEnc, projKeyEnc];
  let ub1 = projKey;
  let eb1 = projKeyEnc;
  let eb2 = versionEnc;
  const push = (byte: number) => {
    const enc = byte ^ ((eb2 + ub1) & 0xff);
    out.push(enc);
    eb2 = eb1;
    eb1 = enc;
    ub1 = byte;
  };
  const ignored = (seed & 6) >> 1;
  for (let i = 0; i < ignored; i++) push(0);
  const len = data.length;
  push(len & 0xff);
  push((len >> 8) & 0xff);
  push((len >> 16) & 0xff);
  push((len >>> 24) & 0xff);
  for (const b of data) push(b);
  return out.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function projectStream(modules: VbaModule[], projectName: string, projectId: string): Buffer {
  const projKey = Buffer.from(projectId, "latin1").reduce((s, b) => (s + b) & 0xff, 0);
  const lines = [`ID="${projectId}"`];
  for (const m of modules) lines.push(m.type === "document" ? `Document=${m.name}/&H00000000` : `Module=${m.name}`);
  lines.push(`Name="${projectName}"`, `HelpContextID="0"`, `VersionCompatible32="393222000"`);
  lines.push(`CMG="${encryptProperty(Buffer.from([0, 0, 0, 0]), projKey, 0xf1)}"`);
  lines.push(`DPB="${encryptProperty(Buffer.from([0]), projKey, 0x8f)}"`);
  lines.push(`GC="${encryptProperty(Buffer.from([0xff]), projKey, 0x2d)}"`);
  lines.push("", "[Host Extender Info]", "&H00000001={3832D640-CF90-11CF-8E43-00A0C911005A};VBE;&H00000000", "", "[Workspace]");
  for (const m of modules) lines.push(`${m.name}=0, 0, 0, 0, C`);
  return mbcs(lines.join("\r\n") + "\r\n");
}

function projectWmStream(modules: VbaModule[]): Buffer {
  const parts: Buffer[] = [];
  for (const m of modules) parts.push(mbcs(m.name), Buffer.from([0]), utf16(m.name), Buffer.from([0, 0]));
  parts.push(Buffer.from([0, 0]));
  return Buffer.concat(parts);
}

/* ------------------------------------------------------------------ the compound file */

const DOC_BASE: Record<string, string> = { workbook: "0{00020819-0000-0000-C000-000000000046}", sheet: "0{00020820-0000-0000-C000-000000000046}" };

/** Source text of a module as VBA stores it: attribute lines first, CRLF line ends. */
function moduleSource(m: VbaModule): string {
  const body = m.code.replace(/\r?\n/g, "\r\n").replace(/^\s*\r\n/, "");
  const attrs = [`Attribute VB_Name = "${m.name}"`];
  if (m.type === "document") {
    attrs.push(
      `Attribute VB_Base = "${m.name === "ThisWorkbook" ? DOC_BASE.workbook : DOC_BASE.sheet}"`,
      "Attribute VB_GlobalNameSpace = False",
      "Attribute VB_Creatable = False",
      "Attribute VB_PredeclaredId = True",
      "Attribute VB_Exposed = True",
      "Attribute VB_TemplateDerived = False",
      "Attribute VB_Customizable = True",
    );
  }
  return attrs.join("\r\n") + "\r\n" + body + (body.endsWith("\r\n") ? "" : "\r\n");
}

export function buildVbaProject(modules: VbaModule[], opts: { projectName?: string; projectId?: string } = {}): Buffer {
  const projectName = opts.projectName ?? "VBAProject";
  const projectId = opts.projectId ?? "{6E4F2C1A-3B7D-4C55-9A0E-1D2F3A4B5C6D}";
  for (const m of modules) if (!/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(m.name)) throw new Error(`Bad VBA module name: ${m.name}`);
  const cfb = CFB.utils.cfb_new();
  const add = (path: string, content: Buffer) => CFB.utils.cfb_add(cfb, path, content);
  add("/PROJECT", projectStream(modules, projectName, projectId));
  add("/PROJECTwm", projectWmStream(modules));
  add("/VBA/_VBA_PROJECT", Buffer.from([0xcc, 0x61, 0xff, 0xff, 0x00, 0x00, 0x00]));
  add("/VBA/dir", compressContainer(dirStream(modules, projectName)));
  for (const m of modules) add(`/VBA/${m.name}`, compressContainer(mbcs(moduleSource(m))));
  // cfb adds a placeholder stream on creation; remove it
  CFB.utils.cfb_del(cfb, "/\u0001Sh33tJ5");
  const out = CFB.write(cfb, { type: "buffer" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as Uint8Array);
}
