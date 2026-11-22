"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function markAllRead() {
  const user = await requireUser();
  await db.notification.updateMany({ where: { personId: user.personId, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}
