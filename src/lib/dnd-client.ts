/**
 * Drag and drop of files and whole folders, for the browser. A dropped folder is walked (the File
 * System entries API) so every file inside arrives with its path kept, the way the "Add a folder"
 * picker gives it, and the uploaders treat both the same.
 */
export type DroppedFile = File & { relPath?: string };

/** The path a file came with: from a dropped folder, from a picked folder, else its name. */
export function relPathOf(f: File): string {
  return (f as DroppedFile).relPath || (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
}

interface Entry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader: () => { readEntries: (ok: (es: Entry[]) => void, err: (e: unknown) => void) => void };
}

const SKIP = /^(\.|~\$|thumbs\.db$|desktop\.ini$)/i;

/** Every file in a drop – files and folders alike – with its path. Must be called from the drop handler itself (the items are gone after the event). */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  // the entries have to be taken synchronously, before anything is awaited
  const entries = Array.from(dt.items ?? [])
    .map((i) => (i.webkitGetAsEntry?.() as unknown as Entry | null) ?? null)
    .filter((e): e is Entry => !!e);
  if (!entries.length) return Array.from(dt.files ?? []).filter((f) => !SKIP.test(f.name));
  const out: File[] = [];
  const walk = async (entry: Entry, dir: string) => {
    if (entry.isFile) {
      if (SKIP.test(entry.name)) return;
      const f = await new Promise<File>((ok, err) => entry.file(ok, err));
      Object.defineProperty(f, "relPath", { value: `${dir}${f.name}`, enumerable: false, configurable: true });
      out.push(f);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries hands back batches until an empty one
      for (;;) {
        const batch = await new Promise<Entry[]>((ok, err) => reader.readEntries(ok, err));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${dir}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

export function hasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types ?? []).includes("Files");
}
