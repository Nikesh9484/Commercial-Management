import type { UserInfo } from "../registers/types";
import { importWorkbook, type ImportRequest, type ImportResult } from "./import";
import { withHeavyLock } from "./heavy";
import { ValidationError } from "../registers/engine";
import fs from "node:fs";
import path from "node:path";
import { getDb, getSetting } from "../db";
import { putTrace, getTrace } from "../cloud-backup";

/** The last step an import reached, kept in the database so it survives a restart of the server. */
export interface ImportTrace {
  jobId: string;
  fileName?: string;
  phase: string;
  done?: number;
  total?: number;
  rssMb: number;
  heapMb: number;
  at: string;
  status: "running" | "done" | "failed";
}

/** The local trace lives in a small file next to the database, so tracing does not count as a database change. */
function traceFile(): string {
  return path.join(path.dirname(process.env.DB_PATH || path.join(process.cwd(), "data", "commercial.db")), "import-trace.json");
}

export function lastImportTrace(): ImportTrace | null {
  try {
    if (fs.existsSync(traceFile())) return JSON.parse(fs.readFileSync(traceFile(), "utf8")) as ImportTrace;
    const raw = getSetting(getDb(), "import_trace");
    return raw ? (JSON.parse(raw) as ImportTrace) : null;
  } catch {
    return null;
  }
}

/** The trace of a job: the local one when it matches, else the copy kept in the backup store. */
export async function traceFor(jobId: string): Promise<(ImportTrace & { ended?: string }) | null> {
  const local = lastImportTrace();
  const remote = (await getTrace()) as (ImportTrace & { ended?: string }) | null;
  const r = remote && remote.jobId === jobId ? remote : null;
  const l = local && local.jobId === jobId ? (local as ImportTrace & { ended?: string }) : null;
  if (!l && !r) return null;
  // the store's copy carries how the process ended; the local copy may be the more recent step
  return { ...(r ?? {}), ...(l ?? {}), ended: r?.ended ?? l?.ended } as ImportTrace & { ended?: string };
}

/**
 * An import runs as a background job: the request returns at once with the job id and the page polls
 * for progress. On the small hosting plan (0.1 CPU) an import can take a couple of minutes, longer than
 * the host's proxy waits for one answer – so a request that waited for the whole import came back as a
 * 502 even though the import itself went through, and the site looked down while it ran.
 */
export interface ImportJob {
  id: string;
  status: "running" | "done" | "failed";
  phase: string;
  done?: number;
  total?: number;
  fileName?: string;
  startedAt: number;
  finishedAt?: number;
  result?: ImportResult;
  error?: string;
  /** memory in use at the last step (MB) */
  rssMb?: number;
}

const jobs = new Map<string, ImportJob>();
const KEEP_MS = 60 * 60_000;

export function startImportJob(req: ImportRequest, user: UserInfo): ImportJob {
  for (const [id, j] of jobs) if (j.finishedAt && Date.now() - j.finishedAt > KEEP_MS) jobs.delete(id);
  const job: ImportJob = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, status: "running", phase: "Waiting to start", fileName: req.fileName, startedAt: Date.now() };
  jobs.set(job.id, job);
  const trace = (status: ImportTrace["status"]) => {
    const m = process.memoryUsage();
    const t: ImportTrace = { jobId: job.id, fileName: job.fileName, phase: job.phase, done: job.done, total: job.total, rssMb: Math.round(m.rss / 1048576), heapMb: Math.round(m.heapUsed / 1048576), at: new Date().toISOString(), status };
    job.rssMb = t.rssMb;
    console.log(`[import ${job.id}] ${status} · ${t.phase}${t.total ? ` ${t.done ?? 0}/${t.total}` : ""} · rss ${t.rssMb} MB, heap ${t.heapMb} MB`);
    try {
      fs.writeFileSync(traceFile(), JSON.stringify(t));
    } catch {
      /* the trace is best effort */
    }
    // mirrored to the backup store (survives a wiped disk), at most every 8 seconds while running
    (globalThis as { __cdImportTrace?: Record<string, unknown> }).__cdImportTrace = status === "running" ? { ...t } : undefined;
    if (status !== "running" || Date.now() - lastRemote > 8000) {
      lastRemote = Date.now();
      void putTrace(t as unknown as Record<string, unknown>);
    }
  };
  let lastRemote = 0;
  const progress = (phase: string, done?: number, total?: number) => {
    job.phase = phase;
    job.done = done;
    job.total = total;
    trace("running");
  };
  withHeavyLock(() => importWorkbook(req, user, progress))
    .then((result) => {
      job.status = "done";
      job.result = result;
      job.phase = "Done";
      trace("done");
    })
    .catch((e: unknown) => {
      job.status = "failed";
      job.error = e instanceof ValidationError ? [e.message, ...Object.values(e.fieldErrors)].join(" ") : e instanceof Error ? e.message : String(e);
      job.phase = "Failed";
      trace("failed");
    })
    .finally(() => {
      job.finishedAt = Date.now();
    });
  return job;
}

export function getImportJob(id: string): ImportJob | null {
  return jobs.get(id) ?? null;
}
