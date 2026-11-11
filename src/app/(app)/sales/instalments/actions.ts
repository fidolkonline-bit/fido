"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { cancelPlan, createPlan } from "@/lib/instalments";
import { formError, num, str, type FormState } from "@/lib/forms";

export async function newPlan(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("instalments.manage");
  let id: string;
  try {
    const first = str(f, "firstDueAt");
    if (!first) return { error: "Choose the date of the first instalment." };
    id = (await createPlan(user, {
      saleId: str(f, "saleId") ?? "", count: num(f, "count") ?? 0, frequency: str(f, "frequency") ?? "MONTHLY", firstDueAt: new Date(`${first}T09:00:00+05:30`),
      guarantorName: str(f, "guarantorName"), guarantorPhone: str(f, "guarantorPhone"), guarantorId: str(f, "guarantorId"), notes: str(f, "notes"),
    })).id;
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/sales/instalments");
  redirect(`/sales/instalments/${id}`);
}

export async function stopPlan(f: FormData) {
  const user = await requirePermission("instalments.manage");
  const id = String(f.get("planId"));
  await cancelPlan(user, id);
  revalidatePath(`/sales/instalments/${id}`);
}
