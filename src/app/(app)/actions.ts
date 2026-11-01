"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { endSession, setSessionLocation } from "@/lib/auth";

export async function switchLocation(form: FormData) {
  await setSessionLocation(String(form.get("locationId")));
  revalidatePath("/", "layout");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
