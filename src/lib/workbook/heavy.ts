/**
 * Heavy workbook operations (reading and importing a monthly report) run one at a time and
 * hand memory back to the system straight afterwards. On the small hosting plan (512 MB) two
 * overlapping reads – or a run of them without a pause, as in the multi-file import – can push
 * the process over the limit and the host restarts it (the visitor sees a 502).
 */
let chain: Promise<unknown> = Promise.resolve();

export function withHeavyLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => releaseMemory(),
    () => releaseMemory(),
  );
  return run;
}

/** Runs the garbage collector when the process was started with --expose-gc (see package.json "start"). */
export function releaseMemory() {
  const g = globalThis as { gc?: () => void };
  try {
    g.gc?.();
  } catch {
    /* not exposed */
  }
}

export function memoryNote(): string {
  const m = process.memoryUsage();
  return `rss ${Math.round(m.rss / 1024 / 1024)} MB, heap ${Math.round(m.heapUsed / 1024 / 1024)} MB`;
}
