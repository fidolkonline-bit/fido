import { requirePermission } from "@/lib/auth";
import { getLabelTemplates } from "@/lib/settings";
import { PageHead } from "@/components/ui";
import { LabelTemplateForm } from "./LabelTemplateForm";

export const metadata = { title: "Label sizes" };

export default async function LabelSizes() {
  await requirePermission("settings.manage");
  const templates = await getLabelTemplates();
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHead eyebrow="Settings" title="Stock label sizes" />
      <p className="small muted" style={{ margin: 0 }}>Measure the actual label roll or sheet. Single-column sizes print one label per page for roll printers; multi-column sizes print on A4 sheets. Repair job stickers come with the Repairs module.</p>
      {templates.map((t) => <LabelTemplateForm key={t.id} t={t} />)}
      <LabelTemplateForm />
    </div>
  );
}
