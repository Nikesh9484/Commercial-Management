/* Writes a small JSON note to the backup store (GitHub repository or S3 bucket) – run synchronously by
   the server when it is being stopped or crashes, so the note is saved before the process is gone.
   The JSON comes on stdin. Usage: echo '{...}' | node put-trace.cjs */
const KEY = "import-trace.json";
const chunks = [];
process.stdin.on("data", (d) => chunks.push(d));
process.stdin.on("end", async () => {
  const body = Buffer.from(Buffer.concat(chunks).toString("utf8"));
  try {
    if (process.env.BACKUP_GITHUB_TOKEN && process.env.BACKUP_GITHUB_REPO) {
      const api = (process.env.BACKUP_GITHUB_API || "https://api.github.com").replace(/\/$/, "");
      const folder = process.env.BACKUP_GITHUB_FOLDER || "backups";
      const url = `${api}/repos/${process.env.BACKUP_GITHUB_REPO}/contents/${folder}/${KEY}`;
      const headers = { Authorization: `Bearer ${process.env.BACKUP_GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "commercial-dashboard", Accept: "application/vnd.github+json" };
      const meta = await fetch(url, { headers });
      const sha = meta.ok ? (await meta.json()).sha : undefined;
      const r = await fetch(url, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ message: `Import trace ${new Date().toISOString()}`, content: body.toString("base64"), ...(sha ? { sha } : {}) }) });
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
    } else if (process.env.BACKUP_S3_ENDPOINT && process.env.BACKUP_S3_BUCKET) {
      const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
      const s3 = new S3Client({ endpoint: process.env.BACKUP_S3_ENDPOINT, region: process.env.BACKUP_S3_REGION || "auto", forcePathStyle: true, credentials: { accessKeyId: process.env.BACKUP_S3_KEY_ID, secretAccessKey: process.env.BACKUP_S3_SECRET } });
      await s3.send(new PutObjectCommand({ Bucket: process.env.BACKUP_S3_BUCKET, Key: KEY, Body: body, ContentType: "application/json" }));
    }
    process.exit(0);
  } catch (e) {
    console.error("[trace]", e && e.message ? e.message : e);
    process.exit(1);
  }
});
