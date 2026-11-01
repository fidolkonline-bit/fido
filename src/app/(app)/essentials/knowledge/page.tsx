import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSee } from "@/lib/essentials";
import { PageHead } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { articleForm } from "../actions";
import { RoleBoxes } from "../RoleBoxes";

export const metadata = { title: "Knowledge base" };

export default async function Knowledge({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q } = await searchParams;
  const [articles, roles] = await Promise.all([
    db.knowledgeArticle.findMany({ where: q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }] } : {}, orderBy: [{ category: "asc" }, { title: "asc" }] }),
    db.role.findMany({ select: { name: true } }),
  ]);
  const manage = can(user, "essentials.manage");
  const visible = articles.filter((a) => manage || canSee(a.audience, user.role));
  const cats = [...new Set(visible.map((a) => a.category))];
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHead eyebrow="Essentials" title="Knowledge base" />
      <form className="toolbar" role="search"><input name="q" defaultValue={q} placeholder="Search procedures, how-tos…" aria-label="Search knowledge base" /><button className="btn">Search</button></form>
      {cats.length === 0 && <p className="muted">No articles{q ? ` match “${q}”` : " yet"}.</p>}
      {cats.map((c) => (
        <section key={c} className="panel" style={{ padding: 0 }}>
          <div className="eyebrow" style={{ padding: "12px 16px 0" }}>{c}</div>
          {visible.filter((a) => a.category === c).map((a) => <Link key={a.id} href={`/essentials/knowledge/${a.id}`} className="pos-item" style={{ padding: "12px 16px", textDecoration: "none", color: "var(--ink)" }}><span>{a.title}</span><span className="small muted">v{a.revision}</span></Link>)}
        </section>
      ))}
      {manage && (
        <ActionForm action={articleForm} className="panel stack">
          <h2 style={{ margin: 0 }}>New article</h2>
          <div className="grid2">
            <label className="field"><span>Title</span><input name="title" required placeholder="How to receive a bus parcel" /></label>
            <label className="field"><span>Category</span><input name="category" placeholder="Shop procedures" /></label>
          </div>
          <label className="field"><span>Content</span><textarea name="body" rows={6} required /></label>
          <RoleBoxes roles={roles.map((r) => r.name)} />
          <div><SubmitButton>Publish</SubmitButton></div>
        </ActionForm>
      )}
    </div>
  );
}
