"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { dryRun, commitBatch } from "@/lib/imports";
import { formError } from "@/lib/forms";

export async function startImport(payload: { kind: "PRODUCTS" | "OPENING_STOCK"; fileName: string; text: string; existing: "UPDATE" | "SKIP" }): Promise<{ error?: string }> {
  const user = await requirePermission("imports.run");
  let id: string;
  try {
    if (payload.text.length > 3_000_000) return { error: "File is too large (3 MB max). Split it into smaller files." };
    id = await dryRun(user, payload.kind, payload.fileName, payload.text, payload.existing);
  } catch (e) {
    return formError(e) ?? {};
  }
  redirect(`/products/imports/${id}`);
}

export async function commitImport(f: FormData) {
  const user = await requirePermission("imports.run");
  const id = String(f.get("batchId"));
  await commitBatch(user, id);
  revalidatePath("/products");
  redirect(`/products/imports/${id}`);
}

export async function discardImport(f: FormData) {
  await requirePermission("imports.run");
  const id = String(f.get("batchId"));
  await db.importBatch.updateMany({ where: { id, status: "DRY_RUN" }, data: { status: "DISCARDED" } });
  redirect("/products/imports");
}
