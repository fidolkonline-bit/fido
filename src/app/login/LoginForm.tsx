"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm({ device }: { device: { name: string; shop: string; cutoff: string } | null }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <div className="login-wrap">
      <form className="login-card stack" action={action}>
        <div>
          <span className="brand">FIDO / SHOP</span>
          <span className="muted small">Sign in to continue</span>
        </div>
        {device && <p className="small muted" style={{ margin: 0 }}>Shop device: <strong>{device.name}</strong> · {device.shop}. You will be signed out at {device.cutoff}.</p>}
        <label className="field">
          <span>Username</span>
          <input name="username" autoComplete="username" autoCapitalize="none" required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {state?.error && <p className="error-text" role="alert">{state.error}</p>}
        <button className="btn btn-primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
