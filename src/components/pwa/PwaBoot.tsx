"use client";

import { useEffect } from "react";
import { swRegistration } from "./device";

// Registers the service worker on every page (login included) once the page has loaded.
export function PwaBoot() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const go = () => void swRegistration().catch((e) => console.warn("Service worker not registered", e));
    if (document.readyState === "complete") go();
    else {
      window.addEventListener("load", go, { once: true });
      return () => window.removeEventListener("load", go);
    }
  }, []);
  return null;
}
