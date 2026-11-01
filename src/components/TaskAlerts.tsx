"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ackTask } from "@/app/(app)/tasks/actions";

type Alert = { id: string; kind: string; title: string; details: string | null; priority: string; createdAt: string; dueAt: string | null; escalated: boolean; href: string; reason: "NEW" | "DUE_SOON" | "ESCALATED" };

const POLL_MS = 15_000;
const RING_EVERY_MS = 20_000;
const MAX_RINGS = 30; // bounded repeat (~10 min) per batch of alerts (spec §13)
const STORE = "fido-alert-sound";

function useAlarm() {
  const ctx = useRef<AudioContext | null>(null);
  const unlock = useCallback(async () => {
    ctx.current ??= new AudioContext();
    if (ctx.current.state === "suspended") await ctx.current.resume();
    return ctx.current.state === "running";
  }, []);
  const ring = useCallback((urgent = true) => {
    const c = ctx.current;
    if (!c || c.state !== "running") return false;
    const t0 = c.currentTime;
    const notes = urgent ? [880, 660, 880, 660, 880] : [660, 880];
    notes.forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "square";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.2);
      o.connect(g).connect(c.destination);
      o.start(t0 + i * 0.22);
      o.stop(t0 + i * 0.22 + 0.21);
    });
    navigator.vibrate?.([300, 120, 300, 120, 300]);
    return true;
  }, []);
  return { unlock, ring };
}

// Shown on every signed-in screen: polls the server, rings for new/escalated tasks until acknowledged.
export function TaskAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [online, setOnline] = useState(true);
  const [soundOn, setSoundOn] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [acking, setAcking] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  const rings = useRef(0);
  const { unlock, ring } = useAlarm();

  useEffect(() => { try { setSoundOn(localStorage.getItem(STORE) === "on"); } catch {} }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { alerts: Alert[] };
      setOnline(true);
      setAlerts(data.alerts);
      const fresh = data.alerts.filter((a) => !seen.current.has(a.id + a.reason));
      if (fresh.length) {
        fresh.forEach((a) => seen.current.add(a.id + a.reason));
        rings.current = 0;
        setOpen(true);
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
          for (const a of fresh) new Notification(a.reason === "ESCALATED" ? "Overdue task" : "Fido task", { body: a.title, tag: a.id, requireInteraction: true });
        }
      }
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    const vis = () => { if (!document.hidden) poll(); };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("online", poll);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); window.removeEventListener("online", poll); };
  }, [poll]);

  // Keep ringing while something unacknowledged is waiting.
  const loud = alerts.some((a) => a.reason !== "DUE_SOON");
  useEffect(() => {
    if (!soundOn || !alerts.length) return;
    const go = async () => {
      if (rings.current >= MAX_RINGS) return;
      if (!audioReady) setAudioReady(await unlock());
      if (ring(loud)) rings.current++;
    };
    go();
    const t = setInterval(go, RING_EVERY_MS);
    return () => clearInterval(t);
  }, [alerts.length, loud, soundOn, audioReady, unlock, ring]);

  const enable = async () => {
    const ok = await unlock();
    setAudioReady(ok);
    ring(false);
    try { localStorage.setItem(STORE, "on"); } catch {}
    setSoundOn(true);
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
  };

  const ack = async (id: string) => {
    setAcking(id);
    const r = await ackTask(id);
    setAcking(null);
    if (!r.error) setAlerts((xs) => xs.filter((x) => x.id !== id || x.reason === "ESCALATED"));
    poll();
  };

  if (!alerts.length && online && soundOn) return null;
  return (
    <div className={"alertbar" + (alerts.length ? " ringing" : "")} role="alert" aria-live="assertive">
      <div className="row" style={{ gap: 8 }}>
        {!online && <span className="badge badge-err">Offline — alerts paused, reconnecting…</span>}
        {alerts.length > 0 && (
          <button className="btn btn-sm alert-count" onClick={() => setOpen(!open)} aria-expanded={open}>
            {alerts.length} task{alerts.length > 1 ? "s" : ""} need{alerts.length > 1 ? "" : "s"} you
          </button>
        )}
        {!soundOn && <button className="btn btn-sm" onClick={enable}>Enable alarm sound</button>}
        {soundOn && !audioReady && alerts.length > 0 && <button className="btn btn-sm" onClick={enable}>Tap to unmute alarm</button>}
      </div>
      {open && alerts.length > 0 && (
        <div className="alertlist">
          {alerts.map((a) => (
            <div key={a.id + a.reason} className="alertitem">
              <div style={{ minWidth: 0 }}>
                <strong>{a.reason === "ESCALATED" ? "OVERDUE · " : a.reason === "DUE_SOON" ? "Due soon · " : ""}{a.title}</strong>
                {a.details && <div className="small">{a.details}</div>}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <Link className="btn btn-sm" href={a.href} onClick={() => setOpen(false)}>Open</Link>
                {a.reason === "NEW" && <button className="btn btn-sm btn-primary" disabled={acking === a.id} onClick={() => ack(a.id)}>{acking === a.id ? "…" : "Acknowledge"}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
