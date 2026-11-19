"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { registerDevice, saveAttendanceSettings, unregisterDevice } from "@/lib/shop-device";
import { formError, str, type FormState } from "@/lib/forms";

export async function registerThisDevice(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("settings.manage");
  try {
    const d = await registerDevice(user, { name: str(f, "name") ?? "", locationId: String(f.get("locationId") ?? "") });
    revalidatePath("/settings/devices");
    return { ok: `This device is now “${d.name}”. Sign-ins here end every night at the cutoff.` };
  } catch (e) {
    return formError(e);
  }
}

export async function unregisterDeviceForm(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("settings.manage");
  try {
    await unregisterDevice(user, String(f.get("id") ?? ""));
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/settings/devices");
  return { ok: "Unregistered. Sign-ins on it now work like any other browser." };
}

export async function saveCutoff(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("settings.manage");
  try {
    const v = await saveAttendanceSettings(user, { dayCutoff: str(f, "dayCutoff") ?? "" });
    revalidatePath("/settings/devices");
    return { ok: `Saved. New sign-ins on shop devices end at ${v.dayCutoff}.` };
  } catch (e) {
    return formError(e);
  }
}
