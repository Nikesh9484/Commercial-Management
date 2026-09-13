import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { importWorkbook, type ImportRequest } from "@/lib/workbook/import";
import { startImportJob, getImportJob } from "@/lib/workbook/jobs";
import { AuthError } from "@/lib/auth";
import { withHeavyLock } from "@/lib/workbook/heavy";

/**
 * POST /api/workbook/import – starts the import as a background job and answers at once with { jobId };
 * the page polls GET /api/workbook/import?job=ID until it is done. Add ?sync=1 to wait for the result
 * in the same request (scripts).
 */
export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (user.role !== "admin" && user.role !== "editor") throw new AuthError("Only Editors and Admins can import a workbook.");
    const body = (await readJson(req)) as unknown as ImportRequest;
    if (new URL(req.url).searchParams.get("sync")) {
      const result = await withHeavyLock(() => importWorkbook(body, user));
      return NextResponse.json(result);
    }
    const job = startImportJob(body, user);
    return NextResponse.json({ jobId: job.id, status: job.status, phase: job.phase }, { status: 202 });
  })(req, ctx);
}

/** GET /api/workbook/import?job=ID – progress and, when finished, the result of an import job. */
export async function GET(req: Request, ctx: unknown) {
  return withUser(async () => {
    const id = new URL(req.url).searchParams.get("job") ?? "";
    const job = getImportJob(id);
    if (!job) return NextResponse.json({ error: "This import is no longer known to the server (it may have restarted). Open the report library to see whether the report was stored, then try again." }, { status: 404 });
    return NextResponse.json({ jobId: job.id, status: job.status, phase: job.phase, done: job.done, total: job.total, result: job.result, error: job.error }, { headers: { "Cache-Control": "no-store" } });
  })(req, ctx);
}
