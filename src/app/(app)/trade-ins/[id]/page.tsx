import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDateTime } from "@/lib/money";
import { PageHead, Badge } from "@/components/ui";
import { PrintOnLoad } from "../../sales/[id]/PrintOnLoad";

export const metadata = { title: "Trade-in" };

export default async function TradeInDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const user = await requirePermission("purchases.view");
  const t = await db.tradeIn.findUnique({
    where: { id: (await params).id },
    include: { customer: true, product: true, device: { include: { saleLine: { include: { sale: true } } } }, location: { include: { business: true } }, createdBy: true, payments: true },
  });
  if (!t) notFound();
  const { print } = await searchParams;
  const showCost = can(user, "cost.view");
  const idLabel = ({ NIC: "NIC", PASSPORT: "Passport", DRIVING_LICENCE: "Driving licence" } as Record<string, string>)[t.sellerIdType];
  const soldOn = t.device?.saleLine?.sale;

  return (
    <div className="stack">
      <div className="no-print">
        <PageHead eyebrow={`Purchases / ${t.location.name}`} title={t.number}
          actions={<>
            <Badge tone={t.device?.state === "SALEABLE" ? "ok" : t.device?.state === "HELD" ? "warn" : "muted"}>{t.device?.state === "HELD" ? "Held for checking" : t.device?.state === "SALEABLE" ? "On sale" : t.device?.state === "SOLD" ? "Sold" : t.device?.state ?? "—"}</Badge>
            {t.device?.state === "HELD" && can(user, "stock.adjust") && <Link className="btn" href="/adjustments/new">Release to sale</Link>}
            {soldOn && <Link className="btn" href={`/sales/${soldOn.id}`}>Sold on {soldOn.number}</Link>}
            <PrintOnLoad enabled={print === "1"} label="Print purchase receipt" />
          </>} />
      </div>
      <style>{"@page { size: A4; margin: 14mm; }"}</style>
      <div className="doc paper-A4">
        <div className="doc-top">
          <div><h3>{t.location.business.name.toUpperCase()}</h3><div className="small">{t.location.name}{t.location.phone ? ` · ${t.location.phone}` : ""}</div></div>
          <div className="small" style={{ textAlign: "right" }}><strong>USED PHONE PURCHASE</strong><br />{t.number}<br />{fmtDateTime(t.createdAt)}</div>
        </div>
        <p className="small" style={{ margin: "0 0 10px" }}>
          <strong>Seller:</strong> {t.customer.name}{t.customer.phone ? ` · ${t.customer.phone}` : ""}<br />
          {idLabel}: {t.sellerIdNumber}{t.sellerAddress ? <><br />Address: {t.sellerAddress}</> : null}
        </p>
        <p className="small" style={{ margin: "0 0 10px" }}>
          <strong>Phone:</strong> {t.product.name}<br />
          {t.imei1 && <>IMEI: {t.imei1}{t.imei2 ? ` / ${t.imei2}` : ""}<br /></>}
          {t.serial && <>Serial: {t.serial}<br /></>}
          Grade {t.grade}{t.batteryHealth != null ? ` · battery ${t.batteryHealth}%` : ""}{t.accessories ? ` · with ${t.accessories}` : ""}
          {t.conditionNotes ? <><br />Condition: {t.conditionNotes}</> : null}
        </p>
        {showCost && (
          <p style={{ margin: "0 0 10px" }}>
            <strong>Amount: Rs. {money(t.value)}</strong> — {t.settlement === "STORE_CREDIT" ? "given as store credit towards a purchase" : t.settlement === "CASH" ? "paid in cash" : "paid by bank transfer"}
            {t.payments[0] ? ` (${t.payments[0].number})` : ""}
          </p>
        )}
        <p className="small" style={{ margin: "0 0 18px" }}>
          I confirm that I am the owner of this phone and have the right to sell it; that it is not stolen, lost, or under any lease, finance or
          instalment agreement; {t.accountsRemoved ? "that all accounts (iCloud / Google) have been signed out and my data removed; " : ""}
          and that the shop may check the IMEI with the authorities. I have received the amount shown above.
        </p>
        <div className="row" style={{ justifyContent: "space-between", gap: 24, marginTop: 40 }}>
          <div className="small" style={{ borderTop: "1px solid currentColor", paddingTop: 4, minWidth: 200 }}>Seller&apos;s signature</div>
          <div className="small" style={{ borderTop: "1px solid currentColor", paddingTop: 4, minWidth: 200 }}>For the shop: {t.createdBy.fullName}</div>
        </div>
      </div>
    </div>
  );
}
