import { notFound } from "next/navigation";
import { db } from "@/lib/db";

export const metadata = { title: "Repair status", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Public page: the customer opens it from the link we send. It shows the stage of ONE job, found by a long random
// token. No names, phone numbers, IMEI, unlock codes or notes are shown — a leaked link reveals nothing personal.
const STAGES = ["RECEIVED", "DIAGNOSIS", "IN_PROGRESS", "TESTING", "READY", "COLLECTED"];
const TEXT: Record<string, { title: string; body: string }> = {
  RECEIVED: { title: "Received", body: "We have your device and it is waiting for a technician." },
  DIAGNOSIS: { title: "Being checked", body: "A technician is finding the fault." },
  AWAITING_APPROVAL: { title: "Waiting for your approval", body: "We have an estimate for you. Please call or message the shop to approve it." },
  AWAITING_PARTS: { title: "Waiting for parts", body: "The part needed has been ordered. Work continues when it arrives." },
  IN_PROGRESS: { title: "Repair in progress", body: "A technician is working on your device." },
  OUTSOURCED: { title: "With a specialist", body: "Your device is with a specialist repair partner. We will check it here when it comes back." },
  TESTING: { title: "Testing", body: "The repair is done and the device is being tested." },
  READY: { title: "Ready to collect", body: "Your device is ready. Please bring your job slip." },
  COLLECTED: { title: "Collected", body: "This device has been handed over. Thank you." },
  CANCELLED: { title: "Cancelled", body: "This job was cancelled. Please contact the shop about your device." },
};
const stageOf = (s: string) => (s === "AWAITING_APPROVAL" ? 1 : s === "AWAITING_PARTS" ? 2 : s === "OUTSOURCED" ? 2 : STAGES.indexOf(s));
const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);

export default async function Track({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) notFound();
  const job = await db.repairJob.findUnique({
    where: { trackToken: token },
    select: { number: true, deviceBrand: true, deviceModel: true, status: true, outcome: true, estimate: true, total: true, paid: true, promisedAt: true, updatedAt: true, collectedAt: true, location: { select: { name: true, phone: true, business: { select: { name: true } } } } },
  });
  // Links stop working 30 days after collection.
  if (!job || (job.collectedAt && Date.now() - job.collectedAt.getTime() > 30 * 86_400_000)) notFound();
  const t = job.status === "READY" && job.outcome === "NOT_REPAIRED"
    ? { title: "Ready to collect — not repaired", body: "Sorry, we could not repair your device. Please collect it from the shop, or call us to talk about it." }
    : TEXT[job.status] ?? { title: job.status, body: "" };
  const at = stageOf(job.status);
  const due = Number(job.total) - Number(job.paid);
  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "28px 16px" }} className="stack">
      <div><span className="brand">{job.location.business.name.toUpperCase()}</span><div className="muted small">{job.location.name}</div></div>
      <section className="panel stack">
        <div className="small muted">Job {job.number} · {[job.deviceBrand, job.deviceModel].filter(Boolean).join(" ")}</div>
        <h1 style={{ margin: 0 }}>{t.title}</h1>
        <p style={{ margin: 0 }}>{t.body}</p>
        {job.status !== "CANCELLED" && (
          <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", gap: 4 }} aria-label="Progress">
            {STAGES.map((s, i) => <li key={s} title={TEXT[s].title} style={{ flex: 1, height: 6, borderRadius: 3, background: i <= at ? "var(--ok, #2e7d4f)" : "var(--line, #ccc)" }} />)}
          </ol>
        )}
        <div className="small muted">Updated {fmt(job.updatedAt)}{job.promisedAt && job.status !== "COLLECTED" && job.status !== "READY" ? ` · promised ${fmt(job.promisedAt)}` : ""}</div>
      </section>
      {(job.status === "AWAITING_APPROVAL" && job.estimate != null) && <section className="panel">Estimate: <strong>Rs. {Number(job.estimate).toLocaleString("en-LK", { minimumFractionDigits: 2 })}</strong></section>}
      {job.status === "READY" && due > 0 && <section className="panel">Balance to pay on collection: <strong>Rs. {due.toLocaleString("en-LK", { minimumFractionDigits: 2 })}</strong></section>}
      {job.location.phone && <a className="btn btn-primary" href={`tel:${job.location.phone}`}>Call the shop · {job.location.phone}</a>}
    </main>
  );
}
