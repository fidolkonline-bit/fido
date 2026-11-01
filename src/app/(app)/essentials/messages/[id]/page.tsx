import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { PageHead } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { reply } from "../../actions";

export const metadata = { title: "Conversation" };

export default async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = (await params).id;
  const member = await db.threadMember.findUnique({ where: { threadId_personId: { threadId: id, personId: user.personId } } });
  if (!member) notFound(); // conversations are private to their members
  const t = await db.messageThread.findUniqueOrThrow({ where: { id }, include: { members: { include: { person: true } }, messages: { orderBy: { createdAt: "asc" }, include: { sender: true } } } });
  await db.threadMember.update({ where: { threadId_personId: { threadId: id, personId: user.personId } }, data: { lastReadAt: new Date() } });
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <PageHead eyebrow="Essentials / Messages" title={t.subject} />
      <p className="small muted" style={{ margin: 0 }}>With {t.members.map((m) => m.person.fullName).join(", ")}</p>
      {t.messages.map((m) => {
        const mine = m.senderId === user.personId;
        return (
          <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%" }} className="panel">
            <div className="small muted">{mine ? "You" : m.sender.fullName} · {fmtDateTime(m.createdAt)}</div>
            <div style={{ whiteSpace: "pre-line" }}>{m.body}</div>
          </div>
        );
      })}
      <ActionForm action={reply} className="panel stack" key={t.messages.length}>
        <input type="hidden" name="threadId" value={t.id} />
        <textarea name="body" rows={2} placeholder="Reply" required />
        <div><SubmitButton>Send</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
