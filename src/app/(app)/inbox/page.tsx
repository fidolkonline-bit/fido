import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { PageHead } from "@/components/ui";
import { markAllRead } from "./actions";

export const metadata = { title: "Notifications" };

const KIND: Record<string, string> = { CLOCK_IN: "Clock-in", CLOCK_OUT: "Clock-out", AUTO_CLOCK_OUT: "No clock-out", DRAWER_OPEN: "Cash drawer" };

export default async function Notifications() {
  const user = await requireUser();
  const items = await db.notification.findMany({ where: { personId: user.personId }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <PageHead eyebrow="Notifications" title={unread ? `${unread} unread` : "All read"}
        actions={unread ? <form action={markAllRead}><button className="btn">Mark all read</button></form> : undefined} />
      {items.length === 0 ? (
        <p className="muted">Nothing yet. Clock-ins, clock-outs and cash drawer alerts show up here, and on your phone when notifications are on (Settings → This device).</p>
      ) : (
        <ul className="notif-list">
          {items.map((n) => (
            <li key={n.id} className={n.readAt ? "" : "unread"}>
              <Link href={`/inbox/${n.id}`} prefetch={false}>
                <span className="notif-top"><span className="small muted">{KIND[n.kind] ?? n.kind}</span><span className="small muted">{fmtDateTime(n.createdAt)}</span></span>
                <strong>{n.title}</strong>
                <span className="small">{n.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted" style={{ margin: 0 }}>The latest 100 are shown; notifications older than 90 days are removed.</p>
    </div>
  );
}
