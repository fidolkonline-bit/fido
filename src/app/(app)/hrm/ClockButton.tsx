"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clock } from "./actions";

export function ClockButton({ clockedIn, since }: { clockedIn: boolean; since: string | null }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | undefined>();
  const [pending, start] = useTransition();
  return (
    <div className="stack" style={{ gap: 8, alignItems: "flex-start" }}>
      <button className={"btn " + (clockedIn ? "" : "btn-primary")} style={{ minHeight: 64, minWidth: 220, fontSize: 18 }} disabled={pending}
        onClick={() => start(async () => { setMsg(await clock(clockedIn ? "OUT" : "IN")); router.refresh(); })}>
        {pending ? "…" : clockedIn ? "Clock out" : "Clock in"}
      </button>
      <span className="small muted">{clockedIn ? `Clocked in since ${since}` : "Not clocked in"} · the server&apos;s time is used, not the phone&apos;s.</span>
      {msg?.error && <p className="error-text" style={{ margin: 0 }}>{msg.error}</p>}
      {msg?.ok && <p className="small" style={{ color: "var(--ok)", margin: 0 }}>{msg.ok}</p>}
    </div>
  );
}
