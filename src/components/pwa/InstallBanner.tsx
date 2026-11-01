"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { canPromptInstall, isIOS, isStandalone, onInstallChange, promptInstall } from "./device";

const STORE = "fido-install-dismissed";
const QUIET_DAYS = 14;

// Nudges staff to install the app: one tap on Android / Windows / Mac, Share → Add to Home Screen on iPhone
// (which is also what lets an iPhone receive task notifications).
export function InstallBanner() {
  const [mode, setMode] = useState<"prompt" | "ios" | null>(null);

  useEffect(() => {
    const update = () => {
      if (isStandalone()) return setMode(null);
      try {
        const at = Number(localStorage.getItem(STORE) ?? 0);
        if (Date.now() - at < QUIET_DAYS * 86_400_000) return setMode(null);
      } catch {}
      setMode(canPromptInstall() ? "prompt" : isIOS() ? "ios" : null);
    };
    update();
    return onInstallChange(update);
  }, []);

  if (!mode) return null;
  const dismiss = () => {
    try { localStorage.setItem(STORE, String(Date.now())); } catch {}
    setMode(null);
  };
  return (
    <div className="note install-banner" role="region" aria-label="Install Fido">
      {mode === "prompt" ? (
        <span>Install Fido on this device: it opens full-screen like an app and can show task alerts.</span>
      ) : (
        <span>
          Install Fido on this iPhone / iPad: tap <ShareIcon /> <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Task alerts only reach an iPhone from the installed app.
        </span>
      )}
      <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        {mode === "prompt" && <button className="btn btn-sm btn-primary" onClick={() => promptInstall()}>Install</button>}
        <Link className="btn btn-sm" href="/settings#device">Help</Link>
        <button className="btn btn-sm" onClick={dismiss}>Not now</button>
      </span>
    </div>
  );
}

export function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ verticalAlign: "-2px" }}>
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" /><path d="M5 11v9h14v-9" />
    </svg>
  );
}
