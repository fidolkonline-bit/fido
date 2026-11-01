"use server";

import { revalidatePath } from "next/cache";
import { posting } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { D } from "@/lib/money";
import { DENOMINATIONS, expectedCash } from "@/lib/register";
import { formError, num, str, type FormState } from "@/lib/forms";

export async function openRegister(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("register.operate");
  if (!user.location) return { error: "No location assigned." };
  const opening = num(f, "openingCash");
  if (opening == null || opening < 0) return { error: "Enter the opening cash counted in the drawer." };
  try {
    await posting(async (tx) => {
      const open = await tx.registerSession.findFirst({ where: { locationId: user.location!.id, userId: user.personId, closedAt: null } });
      if (open) throw new Error("Your register is already open.");
      const r = await tx.registerSession.create({ data: { locationId: user.location!.id, userId: user.personId, openingCash: opening } });
      await tx.auditEvent.create({ data: { actorId: user.personId, action: "REGISTER_OPENED", subjectType: "RegisterSession", subjectId: r.id, detail: { openingCash: opening } } });
    });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/", "layout");
  return { ok: "Register opened." };
}

export async function closeRegister(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("register.operate");
  const id = str(f, "registerId");
  if (!id) return { error: "Register not found." };
  try {
    const counts: Record<string, number> = {};
    let counted = D(0);
    for (const d of DENOMINATIONS) {
      const c = num(f, `d${d}`) ?? 0;
      if (c < 0 || !Number.isInteger(c)) return { error: `Count for Rs. ${d} must be a whole number.` };
      if (c) counts[d] = c;
      counted = counted.plus(D(d).mul(c));
    }
    await posting(async (tx) => {
      const r = await tx.registerSession.findUnique({ where: { id } });
      if (!r || r.userId !== user.personId || r.closedAt) throw new Error("This register is not open for you.");
      const { expected } = await expectedCash(id);
      await tx.registerSession.update({
        where: { id },
        data: { closedAt: new Date(), expectedCash: expected, countedCash: counted, variance: counted.minus(expected), denominations: counts, notes: str(f, "notes") },
      });
      await tx.auditEvent.create({ data: { actorId: user.personId, action: "REGISTER_CLOSED", subjectType: "RegisterSession", subjectId: id, detail: { expected: expected.toString(), counted: counted.toString() } } });
    });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/", "layout");
  return { ok: "Register closed." };
}
