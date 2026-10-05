/**
 * Sends files to one bond or insurance entry of the register (POST /api/bonds/documents), in pieces small
 * enough for the hosting's request limit, with a retry on a dropped connection. Runs in the browser.
 */
const CHUNK = 256 * 1024;

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("The file could not be read."));
    r.readAsDataURL(blob);
  });
}

async function post(body: Record<string, unknown>): Promise<{ uploadId?: string; ok?: boolean; document?: { id: number; name: string }; read?: string }> {
  const res = await fetch("/api/bonds/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as { error?: string; uploadId?: string; ok?: boolean; document?: { id: number; name: string }; read?: string };
  if (!res.ok) throw new Error(j.error || "Something went wrong.");
  return j;
}

/** Files one after another; onProgress gets "Uploading 2 of 5: name" before each. Returns the names filed and, per file, what was read from it. */
export async function uploadBondDocuments(bondId: number, files: File[], onProgress?: (msg: string) => void): Promise<string[] & { read?: string[] }> {
  const list = files.filter((f) => f.size > 0 && !/^(\.|~\$|thumbs\.db$|desktop\.ini$)/i.test(f.name));
  const done: string[] & { read?: string[] } = [];
  done.read = [];
  for (let n = 0; n < list.length; n++) {
    const f = list[n];
    onProgress?.(`Uploading ${n + 1} of ${list.length}: ${f.name}`);
    const count = Math.max(1, Math.ceil(f.size / CHUNK));
    let uploadId = "";
    for (let i = 0; i < count; i++) {
      const data = await toBase64(f.slice(i * CHUNK, (i + 1) * CHUNK));
      let j: { uploadId?: string; document?: { name: string }; read?: string } = {};
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          j = await post({ bondId, uploadId, name: f.name, index: i, count, data });
          break;
        } catch (e) {
          if (attempt === 3) throw e;
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      uploadId = j.uploadId ?? uploadId;
      if (j.document) done.push(j.document.name);
      if (j.read) done.read!.push(j.read);
    }
  }
  return done;
}
