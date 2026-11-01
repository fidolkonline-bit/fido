"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission, requireUser, can } from "@/lib/auth";
import * as L from "@/lib/reloads";
import { formError, num, str } from "@/lib/forms";

type Res = { error?: string; ok?: string };

export async function submitReload(payload: { doneNow: unknown } & Record<string, unknown>): Promise<Res> {
  const user = await requireUser();
  if (!(payload.doneNow ? can(user, "reloads.process") : can(user, "reloads.request"))) return { error: "You are not allowed to do this." };
  let id: string;
  try { id = (await L.createReload(user, payload)).id; } catch (e) { return formError(e) ?? {}; }
  revalidatePath("/reloads");
  redirect(`/reloads/${id}`);
}

export async function doClaim(f: FormData) {
  const user = await requirePermission("reloads.process");
  const id = String(f.get("id"));
  await L.claimReload(user, id);
  revalidatePath(`/reloads/${id}`);
}

export async function doOutcome(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("reloads.process");
  const id = String(f.get("id"));
  try {
    await L.recordOutcome(user, id, { result: String(f.get("result")) as "SUCCESSFUL", providerRef: str(f, "providerRef"), note: str(f, "note") });
  } catch (e) { return formError(e) ?? {}; }
  revalidatePath(`/reloads/${id}`);
  return { ok: "Result recorded." };
}

export async function doCancel(f: FormData) {
  const user = await requirePermission("reloads.request");
  const id = String(f.get("id"));
  await L.cancelReload(user, id);
  revalidatePath(`/reloads/${id}`);
}

export async function doFund(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("reloads.wallets");
  try {
    const r = await L.fundWallet(user, { walletId: str(f, "walletId"), money: num(f, "money"), nominal: num(f, "nominal"), method: str(f, "method"), accountId: str(f, "accountId"), reference: str(f, "reference") });
    revalidatePath(`/reloads/wallets/${str(f, "walletId")}`);
    return { ok: `Rs. ${r.nominal} nominal credited.` };
  } catch (e) { return formError(e) ?? {}; }
}

export async function doWallet(_: Res | undefined, f: FormData): Promise<Res> {
  const user = await requirePermission("reloads.wallets");
  const id = str(f, "id");
  const rate = num(f, "costRate");
  const name = str(f, "name");
  const networks = f.getAll("networks").map(String);
  if (!name || !rate || rate <= 0 || rate > 1.5 || !networks.length) return { error: "Name, at least one network and a cost rate (e.g. 0.96) are required." };
  try {
    const data = { name, costRate: rate, networks, locationId: str(f, "locationId") };
    const w = id ? await db.reloadWallet.update({ where: { id }, data }) : await db.reloadWallet.create({ data });
    await db.auditEvent.create({ data: { actorId: user.personId, action: id ? "WALLET_UPDATED" : "WALLET_CREATED", subjectType: "ReloadWallet", subjectId: w.id, detail: data } });
  } catch (e) { return formError(e) ?? {}; }
  revalidatePath("/reloads");
  return { ok: "Wallet saved. The new rate applies to future reloads only." };
}
