import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { SMS_EVENTS, smsConfigured, type SmsEvent } from "@/lib/sms";
import { PageHead, DataTable, Badge, Tabs } from "@/components/ui";
import { SendQueued, TemplateForm } from "./SmsForms";
import { resend, cancelSms } from "./actions";

export const metadata = { title: "SMS" };

const TONE: Record<string, "ok" | "warn" | "err" | "muted"> = { SUBMITTED: "ok", DELIVERED: "ok", QUEUED: "warn", SENDING: "warn", NOT_CONFIGURED: "warn", FAILED: "err", UNKNOWN: "err", CANCELLED: "muted" };
const LABEL: Record<string, string> = { SUBMITTED: "Sent to provider", NOT_CONFIGURED: "Waiting — SMS not set up", UNKNOWN: "Unknown — check before resending" };

export default async function Sms({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePermission("notifications.manage");
  const { tab = "log" } = await searchParams;
  const configured = smsConfigured();
  const [log, counts, templates] = await Promise.all([
    db.notificationIntent.findMany({ orderBy: { createdAt: "desc" }, take: 150 }),
    db.notificationIntent.groupBy({ by: ["status"], _count: true }),
    db.notificationTemplate.findMany(),
  ]);
  const waiting = counts.filter((c) => ["QUEUED", "NOT_CONFIGURED"].includes(c.status)).reduce((a, c) => a + c._count, 0);
  return (
    <div className="stack">
      <PageHead eyebrow="Notification Templates" title="SMS" />
      <div className={"note" + (configured ? " note-ok" : "")}>
        {configured
          ? <>Text.lk is set up (sender <strong>{process.env.TEXTLK_SENDER_ID}</strong>). Messages are sent right after each sale/repair/reload and every minute by the server job.</>
          : <>Text.lk is <strong>not set up</strong> yet. Messages are kept and listed below; nothing is sent. Add <code>TEXTLK_API_TOKEN</code> and <code>TEXTLK_SENDER_ID</code> (an approved sender name) to the server settings, then press “Send waiting messages now”.</>}
      </div>
      <Tabs items={[{ label: `Message log${waiting ? ` (${waiting} waiting)` : ""}`, href: "/notifications", active: tab === "log" }, { label: "Templates", href: "/notifications?tab=templates", active: tab === "templates" }]} />
      {tab === "templates" ? (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>SMS confirms the provider accepted the message, not that the customer read it. Repair messages never include unlock codes.</p>
          {(Object.keys(SMS_EVENTS) as SmsEvent[]).map((e) => {
            const t = templates.find((x) => x.event === e);
            return <TemplateForm key={e} event={e} label={SMS_EVENTS[e].label} vars={SMS_EVENTS[e].vars} body={t?.body ?? SMS_EVENTS[e].body} active={t?.active ?? true} />;
          })}
        </div>
      ) : (
        <>
          {waiting > 0 && <SendQueued />}
          <DataTable rows={log} rowKey={(m) => m.id} empty="No messages yet."
            columns={[
              { label: "When", primary: true, render: (m) => fmtDateTime(m.createdAt) },
              { label: "Type", render: (m) => SMS_EVENTS[m.event as SmsEvent]?.label ?? m.event },
              { label: "To", render: (m) => <span style={{ fontVariantNumeric: "tabular-nums" }}>0{m.recipient.slice(2)}</span> },
              { label: "Message", render: (m) => <span className="small">{m.body}</span> },
              { label: "Status", render: (m) => <><Badge tone={TONE[m.status] ?? "muted"}>{LABEL[m.status] ?? m.status.toLowerCase()}</Badge>{m.lastError && m.status !== "NOT_CONFIGURED" && <div className="small muted">{m.lastError}</div>}</> },
              {
                label: "", render: (m) => ["FAILED", "UNKNOWN", "NOT_CONFIGURED", "QUEUED"].includes(m.status) ? (
                  <div className="row" style={{ gap: 4 }}>
                    {m.status !== "QUEUED" && configured && (
                      <form action={resend}><input type="hidden" name="id" value={m.id} />{m.status === "UNKNOWN" && <input type="hidden" name="confirm" value="yes" />}
                        <button className="btn btn-sm" title={m.status === "UNKNOWN" ? "Only if you confirmed the customer did not get it" : undefined}>{m.status === "UNKNOWN" ? "Confirmed not received — resend" : "Resend"}</button></form>
                    )}
                    <form action={cancelSms}><input type="hidden" name="id" value={m.id} /><button className="btn btn-sm btn-ghost">Cancel</button></form>
                  </div>
                ) : null,
              },
            ]} />
        </>
      )}
    </div>
  );
}
