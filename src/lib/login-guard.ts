import { db } from "./db";

// Brute-force guard: 5 wrong tries for one username, or 20 from one address, inside 15 minutes locks further tries.
const WINDOW_MS = 15 * 60_000;
const MAX_PER_USER = 5;
const MAX_PER_IP = 20;

export async function loginLocked(username: string, ip: string | null) {
  const since = new Date(Date.now() - WINDOW_MS);
  const name = username.trim().toLowerCase().slice(0, 64);
  const lastOk = await db.loginAttempt.findFirst({ where: { username: name, ok: true, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const [byUser, byIp] = await Promise.all([
    db.loginAttempt.count({ where: { username: name, ok: false, createdAt: { gt: lastOk?.createdAt ?? since } } }),
    ip ? db.loginAttempt.count({ where: { ip, ok: false, createdAt: { gte: since } } }) : 0,
  ]);
  return byUser >= MAX_PER_USER || byIp >= MAX_PER_IP;
}

export async function recordLoginAttempt(username: string, ip: string | null, ok: boolean, kind: "PASSWORD" | "PIN" = "PASSWORD") {
  await db.loginAttempt.create({ data: { username: username.trim().toLowerCase().slice(0, 64), ip: ip?.slice(0, 64), ok, kind } });
}

export function clientIp(h: Headers) {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}
