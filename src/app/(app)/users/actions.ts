"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, posting } from "@/lib/db";
import { requirePermission, requireUser, hashPassword, verifyPassword } from "@/lib/auth";
import { ALL_PERMISSIONS, type Permission } from "@/lib/permissions";
import { formError, num, str, type FormState } from "@/lib/forms";

const userSchema = z.object({
  fullName: z.string().min(1, "Name is required."),
  phone: z.string().nullable(),
  allowLogin: z.boolean(),
  username: z.string().regex(/^[a-z0-9._-]{3,32}$/, "Username: 3–32 lowercase letters, numbers, dot, dash or underscore.").nullable(),
  password: z.string().min(8, "Password must be at least 8 characters.").nullable(),
  roleId: z.string().nullable(),
  locationIds: z.array(z.string()),
  maxDiscountPct: z.number().min(0).max(100),
  commissionKind: z.enum(["NONE", "USER", "AGENT", "BOTH"]),
});

// A person may be a login user, a commission recipient, or both (spec §4.1, AC-02).
export async function createUser(_: FormState, f: FormData): Promise<FormState> {
  const admin = await requirePermission("users.manage");
  try {
    const d = userSchema.parse({
      fullName: str(f, "fullName") ?? "", phone: str(f, "phone"), allowLogin: f.get("allowLogin") === "on",
      username: str(f, "username")?.toLowerCase() ?? null, password: str(f, "password"), roleId: str(f, "roleId"),
      locationIds: f.getAll("locationIds").map(String), maxDiscountPct: num(f, "maxDiscountPct") ?? 0,
      commissionKind: (str(f, "commissionKind") ?? "NONE") as "NONE",
    });
    if (d.allowLogin && (!d.username || !d.password || !d.roleId)) return { error: "A login needs a username, password and role." };
    if (!d.allowLogin && d.commissionKind === "NONE") return { error: "Enable login, a commission profile, or both." };
    await posting(async (tx) => {
      const person = await tx.person.create({ data: { fullName: d.fullName, phone: d.phone } });
      if (d.allowLogin) {
        const acct = await tx.loginAccount.create({
          data: { personId: person.id, username: d.username!, passwordHash: await hashPassword(d.password!), roleId: d.roleId!, maxDiscountPct: d.maxDiscountPct },
        });
        for (const locationId of d.locationIds) await tx.userLocation.create({ data: { accountId: acct.id, locationId } });
      }
      if (d.commissionKind !== "NONE") await tx.commissionProfile.create({ data: { personId: person.id, kind: d.commissionKind } });
      await tx.auditEvent.create({ data: { actorId: admin.personId, action: "USER_CREATED", subjectType: "Person", subjectId: person.id } });
    });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/users");
  redirect("/users");
}

// Deactivation keeps history and revokes sessions immediately (AC-04).
export async function setPersonActive(f: FormData) {
  const admin = await requirePermission("users.manage");
  const id = String(f.get("personId"));
  const active = f.get("active") === "true";
  if (id === admin.personId && !active) throw new Error("You cannot deactivate your own login.");
  await posting(async (tx) => {
    await tx.person.update({ where: { id }, data: { active } });
    if (!active) await tx.session.updateMany({ where: { account: { personId: id }, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditEvent.create({ data: { actorId: admin.personId, action: active ? "USER_REACTIVATED" : "USER_DEACTIVATED", subjectType: "Person", subjectId: id } });
  });
  revalidatePath("/users");
}

export async function saveRolePermissions(f: FormData) {
  const admin = await requirePermission("users.manage");
  const roleId = String(f.get("roleId"));
  const perms = f.getAll("perm").map(String).filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
  const role = await db.role.findUniqueOrThrow({ where: { id: roleId } });
  if (role.name === "Owner/Admin") throw new Error("The Owner/Admin role always keeps every permission.");
  await db.role.update({ where: { id: roleId }, data: { permissions: perms } });
  await db.auditEvent.create({ data: { actorId: admin.personId, action: "ROLE_PERMISSIONS_CHANGED", subjectType: "Role", subjectId: roleId, detail: { before: role.permissions, after: perms } } });
  revalidatePath("/users/roles");
}

export async function changeOwnPassword(_: FormState, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const current = String(f.get("current") ?? "");
  const next = String(f.get("next") ?? "");
  if (next.length < 8) return { error: "New password must be at least 8 characters." };
  if (next !== String(f.get("confirm") ?? "")) return { error: "New passwords do not match." };
  if (!(await verifyPassword(user.username, current))) return { error: "Current password is not correct." };
  await posting(async (tx) => {
    await tx.loginAccount.update({ where: { id: user.accountId }, data: { passwordHash: await hashPassword(next) } });
    // Sign out other devices; keep this session.
    await tx.session.updateMany({ where: { accountId: user.accountId, id: { not: user.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  return { ok: "Password changed. Other devices have been signed out." };
}
