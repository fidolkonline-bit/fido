"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formError, str, num, type FormState } from "@/lib/forms";

const schema = z.object({
  name: z.string().min(1, "Name is required.").max(160),
  company: z.string().max(160).nullable(),
  phone: z.string().max(40).nullable(),
  email: z.email("Email is not valid.").nullable(),
  address: z.string().max(500).nullable(),
  taxNumber: z.string().max(60).nullable(),
  groupId: z.string().nullable(),
  creditLimit: z.number().min(0).nullable(),
  payTermDays: z.number().int().min(0).nullable(),
  openingBalance: z.number(),
  isCustomer: z.boolean(),
  isSupplier: z.boolean(),
});

export async function saveContact(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("contacts.manage");
  const id = str(f, "id");
  let savedId: string;
  try {
    const data = schema.parse({
      name: str(f, "name") ?? "", company: str(f, "company"), phone: str(f, "phone"), email: str(f, "email"),
      address: str(f, "address"), taxNumber: str(f, "taxNumber"), groupId: str(f, "groupId"),
      creditLimit: num(f, "creditLimit"), payTermDays: num(f, "payTermDays"), openingBalance: num(f, "openingBalance") ?? 0,
      isCustomer: f.get("isCustomer") === "on", isSupplier: f.get("isSupplier") === "on",
    });
    if (!data.isCustomer && !data.isSupplier) return { error: "Mark the contact as a customer, a supplier, or both." };
    const c = id ? await db.contact.update({ where: { id }, data }) : await db.contact.create({ data });
    savedId = c.id;
    await db.auditEvent.create({ data: { actorId: user.personId, action: id ? "CONTACT_UPDATED" : "CONTACT_CREATED", subjectType: "Contact", subjectId: c.id } });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/contacts");
  redirect(`/contacts/${savedId}`);
}

// Quick add from POS: name + phone only.
export async function quickAddCustomer(name: string, phone: string | null) {
  await requirePermission("contacts.manage");
  const n = name.trim();
  if (!n) throw new Error("Customer name is required.");
  const c = await db.contact.create({ data: { name: n, phone: phone?.trim() || null, isCustomer: true } });
  return { id: c.id, name: c.name, phone: c.phone };
}

export async function addGroup(_: FormState, f: FormData): Promise<FormState> {
  await requirePermission("contacts.manage");
  const name = str(f, "name");
  if (!name) return { error: "Group name is required." };
  try {
    await db.customerGroup.create({ data: { name } });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/contacts/groups");
  return { ok: `${name} added.` };
}
