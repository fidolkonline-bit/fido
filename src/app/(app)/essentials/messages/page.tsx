import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { newThread } from "../actions";

export const metadata = { title: "Messages" };

export default async function Messages() {
  const user = await requireUser();
  const [mine, staff] = await Promise.all([
    db.threadMember.findMany({
      where: { personId: user.personId }, orderBy: { thread: { updatedAt: "desc" } }, take: 50,
      include: { thread: { include: { members: { include: { person: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: true } } } } },
    }),
    db.person.findMany({ where: { active: true, login: { isNot: null }, id: { not: user.personId } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
  ]);
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHead eyebrow="Essentials" title="Messages" />
      <div className="panel" style={{ padding: 0 }}>
        {mine.length === 0 && <p className="muted" style={{ padding: 16, margin: 0 }}>No conversations yet.</p>}
        {mine.map(({ thread: t, lastReadAt }) => {
          const last = t.messages[0];
          const unread = last && last.senderId !== user.personId && (!lastReadAt || last.createdAt > lastReadAt);
          return (
            <Link key={t.id} href={`/essentials/messages/${t.id}`} className="pos-item" style={{ padding: "12px 16px", textDecoration: "none", color: "var(--ink)" }}>
              <span style={{ minWidth: 0 }}><strong style={{ fontWeight: unread ? 700 : 500 }}>{t.subject}</strong>
                <small>{t.members.filter((m) => m.personId !== user.personId).map((m) => m.person.fullName).join(", ")} · {last ? `${last.sender.fullName}: ${last.body.slice(0, 60)}` : ""}</small></span>
              <span className="row" style={{ gap: 6 }}>{unread && <Badge tone="err">New</Badge>}<span className="small muted">{last ? fmtDateTime(last.createdAt) : ""}</span></span>
            </Link>
          );
        })}
      </div>
      <ActionForm action={newThread} className="panel stack">
        <h2 style={{ margin: 0 }}>New conversation</h2>
        <div className="row">{staff.map((s) => <label key={s.id} className="check small"><input type="checkbox" name="members" value={s.id} /> {s.fullName}</label>)}</div>
        <label className="field"><span>Subject</span><input name="subject" required /></label>
        <label className="field"><span>Message</span><textarea name="body" rows={3} required /></label>
        <div><SubmitButton>Send</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
