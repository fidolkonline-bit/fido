import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "./db";
import { D, ZERO } from "./money";
import { CREDIT_ROLES, creditRoleOf, type CreditRole } from "./credit-commission-rules";

// Credit-sale commission: a fixed amount per phone (IMEI/serial-tracked product) that the salesperson earns on top of
// the normal category commission when the phone goes out on credit — a Fintrex sale, or the shop's own credit sale
// once an instalment plan is made for it. It is a CommissionAccrual with role FINTREX or INSTALMENT, so it is
// approved, paid (directly or through payroll) and reversed by returns exactly like the rest of commission.

export const creditCommissionSchema = z.object({
  fintrex: z.coerce.number().min(0).max(1_000_000).default(0),
  instalment: z.coerce.number().min(0).max(1_000_000).default(0),
});
export type CreditCommission = z.infer<typeof creditCommissionSchema>;

export async function getCreditCommission(client: Pick<Tx, "appSetting"> = db): Promise<CreditCommission> {
  const row = await client.appSetting.findUnique({ where: { key: "creditCommission" } });
  const parsed = creditCommissionSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : creditCommissionSchema.parse({});
}

// Who earns it: the salesperson chosen on the sale; with none chosen, the employee who rang the sale up
// (the same person the sale counts for in sales targets).
async function recipientOf(tx: Tx, sale: { salespersonId: string | null; createdById: string }) {
  if (sale.salespersonId) return sale.salespersonId;
  const emp = await tx.employeeProfile.findUnique({ where: { personId: sale.createdById }, select: { id: true } });
  return emp ? sale.createdById : null;
}

/**
 * Bring a sale's credit commission in line with the sale as it is now: Fintrex or an active instalment plan, the
 * phones not returned, and the current rate. Only the difference is written, as a new row (never an edit), so
 * commission already approved or paid stays as it was and a later change shows as its own plus or minus row.
 * Call inside the posting transaction that changed the sale, with the sale row locked.
 */
export async function syncCreditCommission(tx: Tx, saleId: string, opts: { lineId?: string; returnLineId?: string } = {}) {
  const sale = await tx.sale.findUniqueOrThrow({
    where: { id: saleId },
    include: {
      instalmentPlan: { select: { status: true } },
      lines: {
        where: opts.lineId ? { id: opts.lineId } : {},
        include: { product: { select: { trackDevices: true } }, accruals: { where: { role: { in: [...CREDIT_ROLES] } } } },
      },
    },
  });
  const role: CreditRole | null = sale.stage === "FINAL" ? creditRoleOf(sale) : null;
  const rates = role ? await getCreditCommission(tx) : null;
  const rate = role && rates ? D(role === "FINTREX" ? rates.fintrex : rates.instalment) : ZERO;
  const recipientId = role && rate.gt(0) ? await recipientOf(tx, sale) : null;
  const subtotal = D(sale.subtotal);
  let written = 0;

  for (const line of sale.lines) {
    const units = D(line.qty).minus(line.returnedQty);
    const want = new Map<string, Prisma.Decimal>();
    if (role && recipientId && line.product.trackDevices && units.gt(0)) want.set(`${recipientId}|${role}`, rate.mul(units));
    const have = new Map<string, { amount: Prisma.Decimal; basis: Prisma.Decimal }>();
    for (const a of line.accruals) {
      const k = `${a.recipientId}|${a.role}`;
      const h = have.get(k) ?? { amount: ZERO, basis: ZERO };
      have.set(k, { amount: h.amount.plus(a.amount), basis: h.basis.plus(a.basis) });
    }
    // Basis = the phones' net value after the invoice-discount share, as for normal commission.
    const share = subtotal.gt(0) ? D(line.lineTotal).div(subtotal) : ZERO;
    const netValue = D(line.lineTotal).minus(D(sale.discount).mul(share));
    const unitValue = D(line.qty).gt(0) ? netValue.div(line.qty) : ZERO;

    for (const k of new Set([...want.keys(), ...have.keys()])) {
      const h = have.get(k) ?? { amount: ZERO, basis: ZERO };
      let target = want.get(k) ?? ZERO;
      // Phones already earning keep the rate they were earned at (a returned phone takes back what it earned);
      // a rate change in settings applies to new credit sales only. Covered phones = basis ÷ one phone's value.
      if (target.gt(0) && h.amount.gt(0) && h.basis.gt(0) && unitValue.gt(0)) {
        const covered = h.basis.div(unitValue).toDecimalPlaces(2);
        if (covered.gt(0)) target = h.amount.div(covered).mul(units);
      }
      const diff = target.minus(h.amount).toDecimalPlaces(2);
      if (diff.abs().lt(0.01)) continue;
      const basis = diff.gt(0)
        ? unitValue.mul(units).mul(diff).div(target)
        : h.amount.gt(0) ? h.basis.mul(diff).div(h.amount) : ZERO;
      const [rid, r] = k.split("|");
      await tx.commissionAccrual.create({
        data: {
          saleLineId: line.id, recipientId: rid, role: r, basis: basis.toDecimalPlaces(2), amount: diff,
          state: diff.lt(0) ? "REVERSAL" : "ACCRUED", returnLineId: diff.lt(0) ? opts.returnLineId ?? null : null,
        },
      });
      written++;
    }
  }
  return written;
}
