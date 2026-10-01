/* Fetches one uploaded file from the cloud backup store (see src/lib/file-store.ts).
   Usage: node fetch-file.cjs <key> <destination>   exit 0 = written, 2 = not in the store */
const fs = require("node:fs");
const path = require("node:path");
const [key, dest] = process.argv.slice(2);
(async () => {
  let bytes = null;
  if (process.env.BACKUP_GITHUB_TOKEN && process.env.BACKUP_GITHUB_REPO) {
    const api = (process.env.BACKUP_GITHUB_API || "https://api.github.com").replace(/\/$/, "");
    const folder = process.env.BACKUP_GITHUB_FOLDER || "backups";
    const r = await fetch(`${api}/repos/${process.env.BACKUP_GITHUB_REPO}/contents/${folder}/${key}`, { headers: { Authorization: `Bearer ${process.env.BACKUP_GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "commercial-dashboard", Accept: "application/vnd.github.raw+json" } });
    if (r.status === 404) process.exit(2);
    if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
    bytes = Buffer.from(await r.arrayBuffer());
  } else if (process.env.BACKUP_S3_ENDPOINT && process.env.BACKUP_S3_BUCKET) {
    const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
    const s3 = new S3Client({ endpoint: process.env.BACKUP_S3_ENDPOINT, region: process.env.BACKUP_S3_REGION || "auto", forcePathStyle: true, credentials: { accessKeyId: process.env.BACKUP_S3_KEY_ID, secretAccessKey: process.env.BACKUP_S3_SECRET } });
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.BACKUP_S3_BUCKET, Key: key }));
      bytes = Buffer.from(await obj.Body.transformToByteArray());
    } catch (e) {
      if (e && (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404)) process.exit(2);
      throw e;
    }
  } else process.exit(2);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
})().catch((e) => {
  console.error(e && e.message ? e.message : String(e));
  process.exit(1);
});
