import { requirePermission } from "@/lib/auth";
import { PageHead } from "@/components/ui";
import { listSchemes } from "../printing-actions";
import { SchemeForm } from "./SchemeForm";

export const metadata = { title: "Numbering" };

export default async function Numbering() {
  await requirePermission("settings.manage");
  const schemes = await listSchemes();
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHead eyebrow="Settings" title="Document numbering" />
      <p className="small muted" style={{ margin: 0 }}>Numbers are given out once, when a document is posted; reprinting or resending never uses a new number. To continue from the old system, set the next number above its last one.</p>
      {schemes.map((s) => <SchemeForm key={s.docType} s={s} />)}
    </div>
  );
}
