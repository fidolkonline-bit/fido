"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { NavGroup } from "@/lib/nav";
import { switchLocation, logout } from "@/app/(app)/actions";
import { TaskAlerts } from "./TaskAlerts";

type Props = {
  nav: NavGroup[];
  user: { name: string; role: string };
  locations: { id: string; name: string }[];
  locationId: string | null;
  registerOpen: boolean;
  children: ReactNode;
};

// The nav entry with the longest matching path wins, so /products/lots highlights
// "Lots" while /products/abc123 highlights "Products".
function activeHref(hrefs: string[], path: string, query: string) {
  let best: string | null = null;
  let score = -1;
  for (const href of hrefs) {
    const [p, q] = href.split("?");
    const pathOk = p === "/" ? path === "/" : path === p || path.startsWith(p + "/");
    if (!pathOk || (q && !query.includes(q))) continue;
    const s = p.length + (q ? 1 : 0);
    if (s > score) [best, score] = [href, s];
  }
  return best;
}

export function Shell({ nav, user, locations, locationId, registerOpen, children }: Props) {
  const path = usePathname();
  const query = useSearchParams().toString();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path, query]);

  const active = activeHref(["/", "/pos", "/sales", "/products", ...nav.flatMap((g) => g.items.map((i) => i.href))], path, query);
  const current = (href: string) => (href === active ? "page" : undefined);
  const location = locations.find((l) => l.id === locationId);

  return (
    <div className={"shell" + (open ? " nav-open" : "")}>
      <header className="topbar">
        <button className="btn btn-ghost menu-toggle" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(!open)} style={{ color: "var(--nav-text)" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <Link href="/" className="brand">FIDO</Link>
        <div className="meta">
          {locations.length > 1 ? (
            <form action={switchLocation}>
              <select name="locationId" defaultValue={locationId ?? ""} aria-label="Location" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </form>
          ) : (
            <span>{location?.name ?? "No location"}</span>
          )}
          <span className="hide-sm"><span className={"reg-dot" + (registerOpen ? " open" : "")} />Register {registerOpen ? "open" : "closed"}</span>
        </div>
        <div className="spacer" />
        <Link className="btn hide-sm" href="/pos">POS</Link>
        <Link className="btn hide-sm" href="/repairs/new">Repair</Link>
        <Link href="/settings" className="meta hide-sm" style={{ textDecoration: "none" }}><span>{user.name} · {user.role}</span></Link>
        <form action={logout}><button className="btn" type="submit">Log out</button></form>
      </header>

      <aside className="sidebar" aria-label="System modules">
        <Link href="/" className="navhome" aria-current={current("/")}>Home</Link>
        {nav.map((g) => {
          const groupActive = g.items.some((i) => current(i.href));
          return (
            <details key={g.key} className={"navgroup" + (groupActive ? " active" : "") + (g.isNew ? " new-area" : "")} open={groupActive || undefined}>
              <summary>{g.label}</summary>
              <div className="navlinks">
                {g.items.map((i) => (
                  <Link key={i.href} href={i.href} aria-current={current(i.href)}>
                    <span>{i.label}</span>
                    {i.phase && <span className="soon">Phase {i.phase}</span>}
                  </Link>
                ))}
              </div>
            </details>
          );
        })}
        <div className="navfoot">
          <span>{user.name}</span>
          <span className="small">{user.role}</span>
          <Link href="/settings">My account · change password</Link>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />

      <main className="main" id="main"><TaskAlerts />{children}</main>

      <nav className="bottombar" aria-label="Quick actions">
        <Link href="/" aria-current={current("/")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>Home
        </Link>
        <Link href="/pos" aria-current={current("/pos")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M7 20h10M12 16v4" /></svg>POS
        </Link>
        <Link href="/sales" aria-current={current("/sales")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>Sales
        </Link>
        <Link href="/products" aria-current={current("/products")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7l9-4 9 4-9 4z" /><path d="M3 7v10l9 4 9-4V7" /></svg>Stock
        </Link>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M4 12h16M4 17h16" /></svg>Menu
        </button>
      </nav>
    </div>
  );
}
