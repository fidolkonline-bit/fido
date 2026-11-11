import "server-only";

// File storage on Supabase Storage (free plan: 1 GB), reached with the service-role key from the server only.
// Buckets are private: the browser only ever gets a short-lived signed link. With no key set, storage is "off" and
// callers fall back (documents stay in the database, photos are not offered).
export const FILES_BUCKET = "fido-files";
export const BACKUP_BUCKET = "fido-backups";

const base = () => (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// Only a server key can reach private buckets: the legacy service_role JWT ("eyJ…") or a new secret key ("sb_secret_…").
// A publishable / anon key or a placeholder counts as "not set up", so the app says so instead of failing on upload.
export const storageConfigured = () => /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base()) && /^(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_secret_[\w-]{20,})$/.test(key());

export class StorageError extends Error {}

async function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  if (!storageConfigured()) throw new StorageError("File storage is not set up (NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).");
  const res = await fetch(`${base()}/storage/v1${path}`, { ...init, headers: { Authorization: `Bearer ${key()}`, apikey: key(), ...init.headers }, cache: "no-store" });
  return res;
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export async function ensureBucket(bucket: string) {
  const got = await call(`/bucket/${bucket}`);
  if (got.ok) return;
  const made = await call("/bucket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: bucket, name: bucket, public: false }) });
  if (!made.ok && made.status !== 409) throw new StorageError(`Could not create the ${bucket} bucket (${made.status}).`);
}

export async function putFile(bucket: string, path: string, bytes: Uint8Array | Buffer, mimeType: string) {
  const send = () => call(`/object/${bucket}/${enc(path)}`, { method: "POST", headers: { "Content-Type": mimeType, "x-upsert": "true" }, body: new Uint8Array(bytes) });
  let res = await send();
  if (res.status === 404 || res.status === 400) { await ensureBucket(bucket); res = await send(); }
  if (!res.ok) throw new StorageError(`Upload failed (${res.status}).`);
}

export async function getFile(bucket: string, path: string) {
  const res = await call(`/object/${bucket}/${enc(path)}`);
  if (!res.ok) throw new StorageError(`File not found in storage (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

export async function signedUrl(bucket: string, path: string, seconds = 300) {
  const res = await call(`/object/sign/${bucket}/${enc(path)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: seconds }) });
  if (!res.ok) throw new StorageError(`Could not open the file (${res.status}).`);
  const j = (await res.json()) as { signedURL?: string; signedUrl?: string };
  return `${base()}/storage/v1${j.signedURL ?? j.signedUrl}`;
}

export async function removeFiles(bucket: string, paths: string[]) {
  if (!paths.length) return;
  await call(`/object/${bucket}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths }) });
}

export type StoredFile = { name: string; size: number; at: Date | null };

export async function listFiles(bucket: string, prefix = "", limit = 200): Promise<StoredFile[]> {
  const res = await call(`/object/list/${bucket}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefix, limit, sortBy: { column: "name", order: "desc" } }) });
  if (res.status === 404 || res.status === 400) return [];
  if (!res.ok) throw new StorageError(`Could not list files (${res.status}).`);
  const rows = (await res.json()) as { name: string; id: string | null; created_at?: string; metadata?: { size?: number } }[];
  return rows.filter((r) => r.id).map((r) => ({ name: r.name, size: r.metadata?.size ?? 0, at: r.created_at ? new Date(r.created_at) : null }));
}

// Latest nightly backup, for the stale-backup warning (Settings › Backups, and the daily job).
export async function latestBackup() {
  const files = await listFiles(BACKUP_BUCKET, "", 5);
  return files[0] ?? null;
}
