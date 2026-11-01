"use client";

import { useActionState, type ReactNode } from "react";

type Res = { error?: string; ok?: string } | undefined;

// A server-action form that shows the result (error or confirmation) under its fields.
export function ActionForm({ action, children, className = "stack", style }: { action: (s: Res, f: FormData) => Promise<Res>; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className} style={style}>
      {children}
      {state?.error && <p className="error-text" role="alert" style={{ margin: 0, width: "100%" }}>{state.error}</p>}
      {state?.ok && <p className="small" style={{ color: "var(--ok)", margin: 0, width: "100%" }}>{state.ok}</p>}
    </form>
  );
}
