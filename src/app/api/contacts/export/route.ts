import { NextResponse } from "next/server";
import { getUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { contactFilters, listContacts, describeFilters, dueOf } from "@/lib/contact-list";
import { contactsXlsx, contactsPdf } from "@/lib/contact-export";

export const dynamic = "force-dynamic";

// Customer / supplier report as Excel or PDF, with exactly the filters on screen.
// A full contact list is bulk personal data, so it needs report rights on top of contact access, and every export is audited.
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  if (!can(user, "contacts.view") || !can(user, "reports.view")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const format = sp.format === "pdf" ? "pdf" : "xlsx";
  const f = contactFilters(sp);
  const supplier = f.type === "supplier";
  const [{ contacts, stats }, filters, business] = await Promise.all([
    listContacts(f, null, 0),
    describeFilters(f),
    db.business.findFirst({ select: { name: true } }),
  ]);
  const at = new Date();
  const input = { supplier, contacts, stats, dueOf: (c: (typeof contacts)[number]) => dueOf(c, stats, supplier), business: business?.name ?? "Fido", filters, by: user.name, at };
  const bytes = format === "pdf" ? contactsPdf(input) : await contactsXlsx(input);

  await db.auditEvent.create({
    data: { actorId: user.personId, action: "CONTACTS_EXPORTED", subjectType: "Contact", subjectId: f.type, detail: { format, filters, rows: contacts.length } },
  });

  const day = new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const name = `${supplier ? "suppliers" : "customers"}-${day}.${format}`;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
