import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { canSee } from "@/lib/essentials";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { memoForm, removeMemo } from "./actions";
import { RoleBoxes } from "./RoleBoxes";

export const metadata = { title: "Noticeboard" };

export default async function Noticeboard() {
  const user = await requireUser();
  const [memos, roles] = await Promise.all([
    db.memo.findMany({ orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 50, include: { createdBy: true } }),
    db.role.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  const visible = memos.filter((m) => canSee(m.audience, user.role) || can(user, "essentials.manage"));
  const manage = can(user, "essentials.manage");
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHead eyebrow="Essentials" title="Noticeboard" actions={<><Link className="btn" href="/essentials/messages">Messages</Link><Link className="btn" href="/essentials/reminders">Reminders</Link><Link className="btn" href="/essentials/knowledge">Knowledge base</Link><Link className="btn" href="/essentials/documents">Documents</Link></>} />
      {visible.length === 0 && <p className="muted">No notices.</p>}
      {visible.map((m) => (
        <article key={m.id} className="panel stack" style={{ gap: 6, borderLeft: m.pinned ? "3px solid var(--accent)" : undefined }}>
          <div className="row"><strong style={{ fontSize: 16, fontWeight: 600 }}>{m.title}</strong>{m.pinned && <Badge tone="warn">Pinned</Badge>}{m.audience.length > 0 && <Badge>{m.audience.join(", ")}</Badge>}<div className="spacer" />
            {manage && <form action={removeMemo}><input type="hidden" name="id" value={m.id} /><button className="btn btn-sm btn-ghost">Remove</button></form>}</div>
          <p style={{ margin: 0, whiteSpace: "pre-line" }}>{m.body}</p>
          <span className="small muted">{m.createdBy.fullName} · {fmtDateTime(m.createdAt)}</span>
        </article>
      ))}
      {manage && (
        <ActionForm action={memoForm} className="panel stack">
          <h2 style={{ margin: 0 }}>Post a notice</h2>
          <label className="field"><span>Title</span><input name="title" required /></label>
          <label className="field"><span>Message</span><textarea name="body" rows={3} required /></label>
          <RoleBoxes roles={roles.map((r) => r.name)} />
          <div className="row"><label className="check"><input type="checkbox" name="pinned" /> Pin to top</label><div className="spacer" /><SubmitButton>Post</SubmitButton></div>
        </ActionForm>
      )}
    </div>
  );
}
