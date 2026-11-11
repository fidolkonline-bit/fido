import { Prisma } from "@prisma/client";

// Pure limit rules for a sale, shared by the POS posting and the tests. No database access.
type Dec = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export type LimitLine = {
  name: string;
  qty: Dec;
  price: Dec; // unit price entered at the POS
  listPrice: Dec; // unit price the server resolved for this customer / tier
  discount: Dec; // line discount amount (whole line)
  ruleAmount: Dec; // part of the discount that a running offer allows (whole line)
  hasRule: boolean;
  minSellPrice: Dec | null;
};

// What the cashier personally gave away on a line: the cut below list price plus the line discount, less the offer.
export function cashierDiscount(l: LimitLine) {
  const listGross = l.listPrice.mul(l.qty);
  const gross = l.price.mul(l.qty).toDecimalPlaces(2);
  return listGross.minus(gross).plus(l.discount).minus(l.ruleAmount);
}

// Returns the first problem as a message, or null when the sale is inside the cashier's limits.
// The limit is ONE allowance over the whole sale: line cuts and the invoice discount draw on the same percentage,
// so 10% on the lines plus 10% on the invoice is refused. The minimum price is tested on what the customer really
// pays per unit after the line discount and the line's share of the invoice discount.
export function checkDiscountLimits(lines: LimitLine[], invoiceDiscount: Dec, maxPct: Prisma.Decimal.Value): string | null {
  const pct = D(maxPct);
  const tol = D("0.005");
  let listTotal = D(0);
  let given = D(0);
  const subtotal = lines.reduce((a, l) => a.plus(l.price.mul(l.qty).toDecimalPlaces(2).minus(l.discount)), D(0));

  for (const l of lines) {
    const listGross = l.listPrice.mul(l.qty);
    const own = cashierDiscount(l);
    if (own.gt(listGross.mul(pct).div(100).plus(tol))) return `Discount on ${l.name} is above your limit of ${pct.toString()}%.`;
    listTotal = listTotal.plus(listGross);
    // A line sold above list does not buy extra discount on another line.
    given = given.plus(Prisma.Decimal.max(own, 0));

    if (l.minSellPrice && !l.hasRule && l.qty.gt(0)) {
      const lineNet = l.price.mul(l.qty).toDecimalPlaces(2).minus(l.discount);
      const share = subtotal.gt(0) ? invoiceDiscount.mul(lineNet).div(subtotal) : D(0);
      const netUnit = lineNet.minus(share).div(l.qty);
      if (netUnit.plus(tol).lt(l.minSellPrice) && netUnit.plus(tol).lt(l.listPrice))
        return `${l.name} cannot be sold below ${l.minSellPrice.toFixed(2)} (after discounts it is ${netUnit.toFixed(2)}).`;
    }
  }

  given = given.plus(invoiceDiscount);
  const allowed = listTotal.mul(pct).div(100);
  if (given.gt(allowed.plus(tol)))
    return `Discounts on this sale add up to ${given.toFixed(2)}, above your limit of ${pct.toString()}% (${allowed.toFixed(2)}) for the whole sale.`;
  return null;
}
