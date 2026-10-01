import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { withUser } from "./api";
import { withHeavyLock } from "./workbook/heavy";
import { appendUploadPart, finishUploadParts } from "./workbook/import";
import type { Decisions, FromDocsResult } from "./from-docs-shared";
import type { UserInfo } from "./registers/types";

const BATCHES = path.join(os.tmpdir(), "commercial-dashboard-uploads", "doc-batches");
const safeId = (s: unknown) => (/^[a-z0-9]{6,40}$/.test(String(s ?? "")) ? String(s) : "");

export interface DocFile {
  name: string;
  bytes: Buffer;
}

/**
 * One POST route for every "add from documents" flow:
 *  { batch, uploadId?, name, index, count, data }  – one piece of one file of the batch (base64)
 *  { batch, apply: true, decisions? }               – read every file of the batch and write the entries;
 *                                                     decisions: { key: "replace" | "keep" } answers the duplicates
 * The files stay on disk until the apply has no duplicate left to decide.
 */
export function fromDocumentsRoute(opts: { dir: string; refuse: (user: UserInfo) => string | null; run: (files: DocFile[], user: UserInfo, decisions: Decisions) => Promise<FromDocsResult> }) {
  return async function POST(req: Request, ctx: unknown) {
    return withUser(async (user) => {
      const why = opts.refuse(user);
      if (why) return NextResponse.json({ error: why }, { status: 403 });
      const body = (await req.json().catch(() => ({}))) as { batch?: string; uploadId?: string; name?: string; index?: number; count?: number; data?: string; apply?: boolean; decisions?: Decisions };
      const batch = safeId(body.batch);
      if (!batch) return NextResponse.json({ error: "Bad batch id." }, { status: 400 });
      const dir = path.join(BATCHES, opts.dir, batch);
      if (body.apply) {
        if (!fs.existsSync(dir)) return NextResponse.json({ error: "No files were uploaded." }, { status: 400 });
        const files = fs
          .readdirSync(dir)
          .sort()
          .map((f) => ({ name: f.replace(/^\d{3}-/, ""), bytes: fs.readFileSync(path.join(dir, f)) }));
        const result = await withHeavyLock(() => opts.run(files, user, body.decisions ?? {}));
        if (!result.needsDecision) fs.rmSync(dir, { recursive: true, force: true });
        return NextResponse.json(result);
      }
      const part = Buffer.from(String(body.data ?? ""), "base64");
      const uploadId = appendUploadPart(body.uploadId || null, part);
      if ((body.index ?? 0) < (body.count ?? 1) - 1) return NextResponse.json({ uploadId });
      const bytes = finishUploadParts(uploadId);
      fs.mkdirSync(dir, { recursive: true });
      const n = fs.readdirSync(dir).length;
      const name = String(body.name ?? "file").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 150);
      fs.writeFileSync(path.join(dir, `${String(n).padStart(3, "0")}-${name}`), bytes);
      return NextResponse.json({ stored: name });
    })(req, ctx);
  };
}
