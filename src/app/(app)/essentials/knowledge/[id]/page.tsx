import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { canSee } from "@/lib/essentials";
import { PageHead } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { articleForm } from "../../actions";
import { RoleBoxes } from "../../RoleBoxes";

export const metadata = { title: "Article" };

export default async function Article({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const a = await db.knowledgeArticle.findUnique({ where: { id: (await params).id }, include: { createdBy: true } });
  const manage = can(user, "essentials.manage");
  if (!a || (!manage && !canSee(a.audience, user.role))) notFound();
  const roles = manage ? await db.role.findMany({ select: { name: true } }) : [];
  const history = a.history as { revision: number; at: string; by: string }[];
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <PageHead eyebrow={`Essentials / Knowledge base / ${a.category}`} title={a.title} />
      <article className="panel" style={{ whiteSpace: "pre-line", lineHeight: 1.6 }}>{a.body}</article>
      <p className="small muted" style={{ margin: 0 }}>Version {a.revision} · updated {fmtDateTime(a.updatedAt)}{history.length ? ` · earlier versions: ${history.map((h) => `v${h.revision} (${h.by})`).join(", ")}` : ""}</p>
      {manage && (
        <details className="panel"><summary style={{ cursor: "pointer" }}>Edit (keeps the current version in history)</summary>
          <ActionForm action={articleForm} style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={a.id} />
            <div className="grid2"><label className="field"><span>Title</span><input name="title" defaultValue={a.title} required /></label><label className="field"><span>Category</span><input name="category" defaultValue={a.category} /></label></div>
            <label className="field"><span>Content</span><textarea name="body" rows={10} defaultValue={a.body} required /></label>
            <RoleBoxes roles={roles.map((r) => r.name)} selected={a.audience} />
            <div><SubmitButton>Save new version</SubmitButton></div>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
