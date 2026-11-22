"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const POLL_MS = 30_000;

// Bell in the top bar with the unread count. Checks again every 30 s, when the window gets focus, and on navigation.
export function NotificationBell({ initial }: { initial: number }) {
  const [unread, setUnread] = useState(initial);
  const path = usePathname();
  useEffect(() => setUnread(initial), [initial]);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch("/api/notifications", { cache: "no-store" });
        if (r.ok && !stop) setUnread((await r.json()).unread ?? 0);
      } catch { /* offline: keep the last count */ }
    };
    check();
    const t = setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    return () => { stop = true; clearInterval(t); window.removeEventListener("focus", check); };
  }, [path]);
  const label = unread ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "Notifications";
  return (
    <Link href="/inbox" className="btn bell" aria-label={label} title={label}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread > 0 && <span className="bell-count">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}
