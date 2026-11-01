import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { can, type Permission } from "./permissions";

export { can };

const COOKIE = "fido_session";
const SESSION_DAYS = 14;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function verifyPassword(username: string, password: string) {
  const account = await db.loginAccount.findUnique({
    where: { username: username.trim().toLowerCase() },
    include: { person: true },
  });
  // Compare even when the user is missing so timing does not reveal valid usernames.
  const ok = await bcrypt.compare(password, account?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
  if (!account || !ok || !account.allowLogin || !account.person.active) return null;
  return account;
}

export const hashPassword = (p: string) => bcrypt.hash(p, 10);

export async function startSession(accountId: string, userAgent?: string | null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const firstLocation = await db.userLocation.findFirst({ where: { accountId }, select: { locationId: true } });
  await db.session.create({
    data: { tokenHash: hashToken(token), accountId, expiresAt, userAgent: userAgent?.slice(0, 200), locationId: firstLocation?.locationId },
  });
  await db.loginAccount.update({ where: { id: accountId }, data: { lastLoginAt: new Date() } });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } });
  jar.delete(COOKIE);
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof loadUser>>>;

async function loadUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      account: {
        include: { person: true, role: true, locations: { include: { location: true } } },
      },
    },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  const { account } = session;
  if (!account.allowLogin || !account.person.active) return null;

  const isOwner = account.role.permissions.includes("settings.manage");
  const locations = isOwner
    ? await db.location.findMany({ where: { active: true }, orderBy: { name: "asc" } })
    : account.locations.map((l) => l.location).filter((l) => l.active);
  const location = locations.find((l) => l.id === session.locationId) ?? locations[0] ?? null;

  return {
    sessionId: session.id,
    accountId: account.id,
    personId: account.personId,
    name: account.person.fullName,
    username: account.username,
    role: account.role.name,
    permissions: new Set(account.role.permissions),
    maxDiscountPct: account.maxDiscountPct,
    locations,
    location,
  };
}

export const getUser = cache(loadUser);

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export class PermissionError extends Error {
  constructor(p: Permission) {
    super(`You don't have permission for this action (${p}).`);
  }
}

// Page guard: renders the permission-denied state via the nearest error boundary.
export async function requirePermission(p: Permission) {
  const user = await requireUser();
  if (!can(user, p)) throw new PermissionError(p);
  return user;
}

export async function requireLocation(user: CurrentUser) {
  if (!user.location) throw new Error("No business location is assigned to your login.");
  return user.location;
}

export async function setSessionLocation(locationId: string) {
  const user = await requireUser();
  if (!user.locations.some((l) => l.id === locationId)) throw new Error("Location not permitted.");
  await db.session.update({ where: { id: user.sessionId }, data: { locationId } });
}
