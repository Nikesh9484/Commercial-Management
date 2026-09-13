/* Downloads the last cloud backup of the database before the server opens it.
   Run synchronously by src/lib/db.ts when the database file is missing (a fresh disk after a deploy
   or restart on the small hosting plan), so no request can create an empty database first.
   Usage: node restore-backup.cjs <destination.db>
   Exit codes: 0 restored · 3 no backup in the store (start fresh) · 1 failed (do not start empty). */
const fs = require("node:fs");
const path = require("node:path");

const KEY = process.env.BACKUP_S3_OBJECT || "commercial.db";
const dest = process.argv[2];
if (!dest) {
  console.error("restore-backup: destination missing");
  process.exit(1);
}

async function fromGithub() {
  const repo = process.env.BACKUP_GITHUB_REPO;
  const token = process.env.BACKUP_GITHUB_TOKEN;
  const api = (process.env.BACKUP_GITHUB_API || "https://api.github.com").replace(/\/$/, "");
  const folder = process.env.BACKUP_GITHUB_FOLDER || "backups";
  const r = await fetch(`${api}/repos/${repo}/contents/${folder}/${KEY}`, {
    headers: { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "commercial-dashboard", Accept: "application/vnd.github.raw+json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

async function fromS3() {
  const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
  const client = new S3Client({
    endpoint: process.env.BACKUP_S3_ENDPOINT,
    region: process.env.BACKUP_S3_REGION || "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.BACKUP_S3_KEY_ID, secretAccessKey: process.env.BACKUP_S3_SECRET },
  });
  try {
    const out = await client.send(new GetObjectCommand({ Bucket: process.env.BACKUP_S3_BUCKET, Key: KEY }));
    return Buffer.from(await out.Body.transformToByteArray());
  } catch (e) {
    if (e && (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404)) return null;
    throw e;
  }
}

const provider = process.env.BACKUP_GITHUB_TOKEN && process.env.BACKUP_GITHUB_REPO ? "github" : process.env.BACKUP_S3_ENDPOINT && process.env.BACKUP_S3_BUCKET ? "s3" : null;
if (!provider) process.exit(3);

(async () => {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const bytes = provider === "github" ? await fromGithub() : await fromS3();
      if (!bytes) {
        console.log("[restore] no backup in the store yet – starting with a fresh database");
        process.exit(3);
      }
      if (bytes.length < 100 || bytes.subarray(0, 15).toString("latin1") !== "SQLite format 3") throw new Error(`the downloaded file is not a SQLite database (${bytes.length} bytes)`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(`${dest}.restoring`, bytes);
      fs.renameSync(`${dest}.restoring`, dest);
      console.log(`[restore] restored ${bytes.length} bytes from the ${provider} backup (attempt ${attempt})`);
      process.exit(0);
    } catch (e) {
      lastError = e;
      console.error(`[restore] attempt ${attempt} failed: ${e && e.message ? e.message : e}`);
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
  }
  console.error(`[restore] giving up: ${lastError && lastError.message ? lastError.message : lastError}`);
  process.exit(1);
})();
