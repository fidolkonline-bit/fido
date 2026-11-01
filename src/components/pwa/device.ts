"use client";

// Browser side of the installed app: install prompt, service worker, push subscription.

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Chrome / Edge / Samsung Internet fire this once the app is installable; keep it for our own Install button.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

export function onInstallChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
export const canPromptInstall = () => !!deferred;
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  emit();
  await e.prompt();
  return (await e.userChoice).outcome === "accepted";
}

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
// iPadOS reports itself as a Mac; touch points give it away.
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export async function swRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  await navigator.serviceWorker.ready;
  return reg;
}

// ───── Push ─────

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

const pushApis = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function pushState(): Promise<PushState> {
  if (isIOS() && !isStandalone()) return "needs-install"; // iPhone / iPad: push only reaches the home-screen app
  if (!pushApis()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await swRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64url: string) {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function sameKey(sub: PushSubscription, key: Uint8Array) {
  const k = sub.options.applicationServerKey;
  if (!k) return false;
  const a = new Uint8Array(k);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}

async function send(method: "POST" | "DELETE", body: unknown) {
  const res = await fetch("/api/push", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Server error ${res.status}`);
}

const OFF = "fido-push-off"; // "Turn off" on this device sticks until "Turn on"
const turnedOff = () => { try { return localStorage.getItem(OFF) === "1"; } catch { return false; } };
const markOff = (off: boolean) => { try { if (off) localStorage.setItem(OFF, "1"); else localStorage.removeItem(OFF); } catch {} };

// Subscribe this browser and tie it to the signed-in session.
// auto = background re-sync (no permission prompt, and respects a "Turn off" made on this device).
export async function enablePush(vapidKey: string, auto = false): Promise<{ error?: string }> {
  if (auto && turnedOff()) return {};
  if (isIOS() && !isStandalone()) return { error: "On iPhone / iPad, add Fido to the Home Screen first, then turn notifications on from the installed app." };
  if (!pushApis()) return { error: "This browser can't receive notifications." };
  try {
    let perm = Notification.permission;
    if (perm === "default" && !auto) perm = await Notification.requestPermission();
    if (perm !== "granted") return { error: perm === "denied" ? "Notifications are blocked for Fido. Allow them in the browser or phone settings." : "Notifications were not allowed." };
    const reg = await swRegistration();
    if (!reg) return { error: "This browser can't run the Fido service worker." };
    const key = keyBytes(vapidKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, key)) {
      await sub.unsubscribe(); // server keys changed: the old subscription can no longer be used
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await send("POST", sub.toJSON());
    if (!auto) markOff(false);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not turn on notifications." };
  }
}

export async function disablePush(): Promise<{ error?: string }> {
  markOff(true);
  try {
    const reg = await swRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await send("DELETE", { endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe();
    }
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not turn off notifications." };
  }
}

export async function testPush(): Promise<{ error?: string }> {
  const res = await fetch("/api/push/test", { method: "POST" });
  if (res.ok) return {};
  return { error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Server error ${res.status}` };
}

// Show a notification through the service worker (Android Chrome forbids `new Notification()` in pages).
export async function notify(title: string, options: NotificationOptions & { data?: { url: string } }) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/") : undefined;
    if (reg) return void (await reg.showNotification(title, { icon: "/icons/icon-192.png", badge: "/icons/badge-96.png", ...options }));
    new Notification(title, options);
  } catch {
    // Notifications are a convenience; the in-app alert bar is always shown.
  }
}

export function setBadge(count: number) {
  const n = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  (count ? n.setAppBadge?.(count) : n.clearAppBadge?.())?.catch(() => undefined);
}
