"use client";

import { useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<ThemeChoice, string> = { system: "Auto", light: "Light", dark: "Dark" };

// Cycles Auto (follow the device) → Light → Dark. The choice is a cookie, so the server renders the right theme
// on the next page with no flash; this device and browser only.
export function ThemeSwitch({ initial, className = "btn" }: { initial: ThemeChoice; className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  const change = () => {
    const next = NEXT[choice];
    setChoice(next);
    if (next === "system") {
      delete document.documentElement.dataset.theme;
      document.cookie = "fido_theme=; path=/; max-age=0; samesite=lax";
    } else {
      document.documentElement.dataset.theme = next;
      document.cookie = `fido_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    }
  };
  return (
    <button type="button" className={className + " theme-switch"} onClick={change}
      aria-label={`Colour theme: ${LABEL[choice]}. Switch to ${LABEL[NEXT[choice]]}`} title={`Theme: ${LABEL[choice]} — click for ${LABEL[NEXT[choice]]}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {choice === "light" && <><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></>}
        {choice === "dark" && <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />}
        {choice === "system" && <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17A8.5 8.5 0 0 0 12 3.5z" fill="currentColor" /></>}
      </svg>
      <span className="theme-label">{LABEL[choice]}</span>
    </button>
  );
}
