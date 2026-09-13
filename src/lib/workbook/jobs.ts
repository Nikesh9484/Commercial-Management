import type { UserInfo } from "../registers/types";
import { importWorkbook, type ImportRequest, type ImportResult } from "./import";
import { withHeavyLock } from "./heavy";
import { ValidationError } from "../registers/engine";

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
}

const jobs = new Map<string, ImportJob>();
const KEEP_MS = 60 * 60_000;

export function startImportJob(req: ImportRequest, user: UserInfo): ImportJob {
  for (const [id, j] of jobs) if (j.finishedAt && Date.now() - j.finishedAt > KEEP_MS) jobs.delete(id);
  const job: ImportJob = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, status: "running", phase: "Waiting to start", fileName: req.fileName, startedAt: Date.now() };
  jobs.set(job.id, job);
  const progress = (phase: string, done?: number, total?: number) => {
    job.phase = phase;
    job.done = done;
    job.total = total;
  };
  withHeavyLock(() => importWorkbook(req, user, progress))
    .then((result) => {
      job.status = "done";
      job.result = result;
      job.phase = "Done";
    })
    .catch((e: unknown) => {
      job.status = "failed";
      job.error = e instanceof ValidationError ? [e.message, ...Object.values(e.fieldErrors)].join(" ") : e instanceof Error ? e.message : String(e);
      job.phase = "Failed";
    })
    .finally(() => {
      job.finishedAt = Date.now();
    });
  return job;
}

export function getImportJob(id: string): ImportJob | null {
  return jobs.get(id) ?? null;
}
