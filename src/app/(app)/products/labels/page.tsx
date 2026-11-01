import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { getLabelTemplates } from "@/lib/settings";
import { PageHead } from "@/components/ui";
import { LabelPrinter } from "./LabelPrinter";

export const metadata = { title: "Print labels" };

export default async function Labels() {
  const user = await requirePermission("products.view");
  const [templates, business] = await Promise.all([getLabelTemplates(), db.business.findFirstOrThrow()]);
  return (
    <div>
      <div className="label-controls">
        <PageHead eyebrow="Products" title="Print stock labels" actions={can(user, "settings.manage") && <Link className="btn" href="/settings/labels">Label sizes</Link>} />
      </div>
      <LabelPrinter templates={templates} business={business.name} />
    </div>
  );
}
