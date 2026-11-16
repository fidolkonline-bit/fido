"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import * as R from "@/lib/repairs";
import { formError, num, str } from "@/lib/forms";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { FILES_BUCKET, putFile, removeFiles, storageConfigured } from "@/lib/storage";
import { saveSetting } from "@/lib/settings";

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
  const to = String(f.get("to"));
  const result = str(f, "outcome");
  const outcome = to === "READY" && (result === "REPAIRED" || result === "NOT_REPAIRED") ? { result, reason: str(f, "reason"), fee: num(f, "fee") } as R.Outcome : null;
  return run(id, () => R.changeStatus(user, id, to, str(f, "note"), outcome));
}

export async function doRoute(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("repairs.manage");
  const id = String(f.get("jobId"));
  return run(id, () => R.setRoute(user, id, String(f.get("route"))));
}

export async function doSendOutside(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("repairs.manage");
  const id = String(f.get("jobId"));
  const expected = str(f, "expectedAt");
  return run(id, () => R.sendOutside(user, id, { vendorId: str(f, "vendorId") ?? "", expectedAt: expected ? new Date(expected) : null, quote: num(f, "quote"), note: str(f, "note") }));
}

export async function doReturnFromOutside(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("repairs.manage");
  const id = String(f.get("jobId"));
  return run(id, () => R.returnFromOutside(user, id, { outsourceId: String(f.get("outsourceId")), cost: num(f, "cost"), result: str(f, "result") ?? "", note: str(f, "note") }));
}

// Add an outside repair shop without leaving the job (saved as a supplier contact).
export async function quickAddRepairShop(name: string, phone: string): Promise<{ id?: string; name?: string; error?: string }> {
  await requirePermission("repairs.manage");
  const n = name.trim();
  if (!n) return { error: "Shop name is required." };
  const c = await db.contact.create({ data: { name: n.slice(0, 100), phone: phone.trim() || null, isCustomer: false, isSupplier: true } });
  return { id: c.id, name: c.name };
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

export async function doRefund(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("repairs.manage");
  const id = String(f.get("jobId"));
  return run(id, () => R.refundRepair(user, id, { amount: num(f, "amount") ?? 0, method: String(f.get("method")), accountId: str(f, "accountId"), reference: str(f, "reference") }));
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

// ───────────── Photos (private file storage, opened through short-lived links) ─────────────

const MAX_PHOTO = 3 * 1024 * 1024;
const MAX_PHOTOS_PER_JOB = 12;

export async function addRepairPhoto(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("repairs.manage");
  const jobId = String(f.get("jobId") ?? "");
  const kind = ["INTAKE", "WORK", "DONE"].includes(String(f.get("kind"))) ? String(f.get("kind")) : "INTAKE";
  const file = f.get("photo");
  if (!storageConfigured()) return { error: "File storage is not set up yet (Settings › Backups & file storage)." };
  if (!(file instanceof File) || file.size === 0) return { error: "Take or choose a photo." };
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { error: "Photos must be JPEG, PNG or WebP." };
  if (file.size > MAX_PHOTO) return { error: "The photo is too large (3 MB at most)." };
  const job = await db.repairJob.findUnique({ where: { id: jobId }, select: { id: true, _count: { select: { photos: true } } } });
  if (!job) return { error: "Job not found." };
  if (job._count.photos >= MAX_PHOTOS_PER_JOB) return { error: `A job can hold ${MAX_PHOTOS_PER_JOB} photos. Remove one first.` };
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `repairs/${jobId}/${randomUUID()}.${ext}`;
  try {
    await putFile(FILES_BUCKET, path, Buffer.from(await file.arrayBuffer()), file.type);
    await db.repairPhoto.create({ data: { jobId, kind, storagePath: path, mimeType: file.type, size: file.size, createdById: user.personId } });
  } catch (e) {
    return formError(e) ?? {};
  }
  done(jobId);
  return { ok: "Photo saved." };
}

export async function removeRepairPhoto(f: FormData) {
  await requirePermission("repairs.manage");
  const photo = await db.repairPhoto.delete({ where: { id: String(f.get("id")) } });
  await removeFiles(FILES_BUCKET, [photo.storagePath]).catch(() => {});
  done(photo.jobId);
}

export async function saveRepairSettings(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("settings.manage");
  try {
    const v = R.repairSettingsSchema.parse({ terms: String(f.get("terms") ?? ""), commissionPct: num(f, "commissionPct") ?? 0 });
    await saveSetting("repairs", v, user.personId);
  } catch (e) {
    return formError(e) ?? {};
  }
  revalidatePath("/settings/repairs");
  return { ok: "Saved. New jobs use these terms; the commission applies to jobs collected from now on." };
}
