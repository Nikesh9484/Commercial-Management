import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { importWorkbook, type ImportRequest } from "@/lib/workbook/import";
import { startImportJob, getImportJob, traceFor } from "@/lib/workbook/jobs";
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
    if (!job) {
      // the job list lives in memory: an unknown id means the server restarted while it ran – say where it got to
      const t = await traceFor(id);
      const where = t
        ? ` The server restarted while importing${t.fileName ? ` "${t.fileName}"` : ""}: the last step recorded was "${t.phase}${t.total ? ` (${t.done ?? 0} of ${t.total} rows)` : ""}" with ${t.rssMb} MB of memory in use at ${String(t.at).slice(11, 19)} UTC.${t.ended ? ` How it ended: ${t.ended.split("\n")[0]}` : " No shutdown signal or error was recorded before it stopped, which on Render usually means the instance was killed for exceeding its memory."}`
        : "";
      return NextResponse.json({ error: `This import is no longer known to the server (it restarted).${where} Open the report library to see whether the report was stored, then try again.`, trace: t ?? undefined }, { status: 404 });
    }
    return NextResponse.json({ jobId: job.id, status: job.status, phase: job.phase, done: job.done, total: job.total, rssMb: job.rssMb, result: job.result, error: job.error }, { headers: { "Cache-Control": "no-store" } });
  })(req, ctx);
}
