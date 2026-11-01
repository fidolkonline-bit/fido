"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import * as R from "@/lib/repairs";
import { formError, num, str } from "@/lib/forms";

type Res = { error?: string; ok?: string };
const done = (id: string) => revalidatePath(`/repairs/${id}`);
async function run(id: string, fn: () => Promise<unknown>): Promise<Res> {
  try { await fn(); } catch (e) { return formError(e) ?? {}; }
  done(id);
  return { ok: "Saved." };
}

export async function submitIntake(payload: unknown): Promise<Res> {
  const user = await requirePermission("repairs.manage");
  let id: string;
  try { id = (await R.createRepair(user, payload)).id; } catch (e) { return formError(e) ?? {}; }
  revalidatePath("/repairs");
  redirect(`/repairs/${id}?new=1`);
}

export async function doStatus(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("repairs.manage");
  const id = String(f.get("jobId"));
  return run(id, () => R.changeStatus(user, id, String(f.get("to")), str(f, "note")));
}

export async function doDiagnosis(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("repairs.manage");
  const id = String(f.get("jobId"));
  const promised = str(f, "promisedAt");
  return run(id, () => R.setDiagnosis(user, id, { diagnosis: str(f, "diagnosis"), estimate: num(f, "estimate"), technicianId: str(f, "technicianId"), promisedAt: promised ? new Date(promised) : null, askApproval: f.get("askApproval") === "on" }));
}

export async function doApprove(f: FormData) {
  const user = await requirePermission("repairs.manage");
  const id = String(f.get("jobId"));
  await R.approveEstimate(user, id, String(f.get("how") ?? "in person"));
  done(id);
}

export async function doCharges(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("repairs.manage");
  const id = String(f.get("jobId"));
  return run(id, () => R.setCharges(user, id, { labour: num(f, "labour") ?? 0, other: num(f, "other") ?? 0, discount: num(f, "discount") ?? 0, externalCost: num(f, "externalCost") ?? 0, warrantyDays: num(f, "warrantyDays") }));
}

export async function doPayment(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("repairs.manage");
  const id = String(f.get("jobId"));
  return run(id, () => R.takeRepairPayment(user, id, { amount: num(f, "amount") ?? 0, method: String(f.get("method")), accountId: str(f, "accountId"), reference: str(f, "reference") }));
}

export async function doIssuePart(jobId: string, payload: { productId: string; qty: number; unitPrice: number; layerId: string | null }): Promise<Res> {
  const user = await requirePermission("repairs.manage");
  return run(jobId, () => R.issuePart(user, jobId, payload));
}

export async function doReturnPart(f: FormData) {
  const user = await requirePermission("repairs.manage");
  await R.returnPart(user, String(f.get("partId")), Number(f.get("qty")));
  done(String(f.get("jobId")));
}

export async function doReveal(jobId: string): Promise<{ type?: string; value?: string; error?: string }> {
  const user = await requirePermission("repairs.view");
  try { return await R.revealCredential(user, jobId); } catch (e) { return formError(e) ?? {}; }
}

export async function doPurge(f: FormData) {
  const user = await requirePermission("repairs.credentials");
  const id = String(f.get("jobId"));
  await R.purgeCredential(user, id);
  done(id);
}
