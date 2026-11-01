"use client";

import { useCallback, useEffect, useState } from "react";
import { useAlarm } from "@/components/TaskAlerts";
import { ShareIcon } from "./InstallBanner";
import { canPromptInstall, disablePush, enablePush, isIOS, isStandalone, onInstallChange, promptInstall, pushState, testPush, type PushState } from "./device";

const PUSH_LABEL: Record<PushState, string> = {
  on: "On for this device",
  off: "Off",
  denied: "Blocked in this browser",
  "needs-install": "Install the app first",
  unsupported: "Not supported by this browser",
};

// Settings → This device: install the app, turn task notifications on/off, and the start-of-shift test (spec §13, AC-30).
export function DeviceSettings({ vapidKey, admin }: { vapidKey: string | null; admin: boolean }) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [ios, setIos] = useState(false);
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const { unlock, ring } = useAlarm();

  const refresh = useCallback(async () => {
    setInstalled(isStandalone());
    setCanInstall(canPromptInstall());
    setIos(isIOS());
    setPush(await pushState().catch(() => "unsupported" as const));
  }, []);
  useEffect(() => {
    refresh();
    return onInstallChange(refresh);
  }, [refresh]);

  const run = async (fn: () => Promise<{ error?: string }>, ok: string) => {
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setMsg(r.error ? { error: r.error } : { ok });
    setBusy(false);
    refresh();
  };

  return (
    <section className="panel stack" id="device" style={{ maxWidth: 720 }}>
      <h2 style={{ margin: 0 }}>This device</h2>

      <div className="device-row">
        <div>
          <strong>App</strong>
          <div className="small muted">
            {installed ? "Running as the installed Fido app." : ios
              ? <>On iPhone / iPad: open Fido in Safari, tap <ShareIcon /> Share, then <strong>Add to Home Screen</strong>. Open Fido from the new icon.</>
              : canInstall ? "Install Fido to open it full-screen from the home screen, taskbar or Start menu."
              : "To install: use the browser menu (⋮) → Install app / Add to Home screen. Chrome or Edge work best."}
          </div>
        </div>
        {installed ? <span className="badge badge-ok">Installed</span>
          : canInstall ? <button className="btn btn-primary btn-sm" onClick={() => promptInstall().then(refresh)}>Install app</button> : null}
      </div>

      <div className="device-row">
        <div>
          <strong>Task notifications</strong>
          <div className="small muted">
            Reloads, bus parcels, reminders and overdue tasks pop up on this device even when Fido is closed. They stop when you log out here.
          </div>
          {!vapidKey && (
            <div className="small" style={{ marginTop: 4 }}>
              {admin ? <>Not set up on the server yet: add <code>VAPID_PUBLIC_KEY</code>, <code>VAPID_PRIVATE_KEY</code> and <code>VAPID_SUBJECT</code> (see README).</> : "Not set up on the server yet — ask the owner."}
            </div>
          )}
          {push === "denied" && <div className="small" style={{ marginTop: 4 }}>Allow notifications for this site in the browser&apos;s site settings (or the phone&apos;s app settings), then reload.</div>}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          {push && <span className={"badge " + (push === "on" ? "badge-ok" : push === "off" ? "badge-muted" : "badge-warn")}>{PUSH_LABEL[push]}</span>}
          {vapidKey && push === "off" && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => enablePush(vapidKey), "Notifications are on for this device.")}>Turn on</button>}
          {push === "on" && <button className="btn btn-sm" disabled={busy} onClick={() => run(disablePush, "Notifications are off for this device.")}>Turn off</button>}
        </div>
      </div>

      <div className="device-row">
        <div>
          <strong>Start-of-shift test</strong>
          <div className="small muted">Check the alarm sound is audible and a notification arrives. Keep the phone off silent; the alarm only sounds while Fido is open.</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={async () => { await unlock(); if (!ring(true)) setMsg({ error: "This browser blocked sound. Tap again, and check the volume." }); }}>Test alarm sound</button>
          {push === "on" && <button className="btn btn-sm" disabled={busy} onClick={() => run(testPush, "Test sent — a notification should appear in a few seconds.")}>Send test notification</button>}
        </div>
      </div>

      {msg?.error && <p className="note note-err" role="alert">{msg.error}</p>}
      {msg?.ok && <p className="note note-ok" role="status">{msg.ok}</p>}
    </section>
  );
}
