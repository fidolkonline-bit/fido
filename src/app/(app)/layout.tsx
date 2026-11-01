import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { NAV } from "@/lib/nav";
import { Shell } from "@/components/Shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Hide destinations the role cannot open; the server still enforces every permission.
  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || user.permissions.has(i.perm)) })).filter((g) => g.items.length);
  const registerOpen = user.location
    ? !!(await db.registerSession.findFirst({ where: { locationId: user.location.id, userId: user.personId, closedAt: null }, select: { id: true } }))
    : false;

  return (
    <Suspense>
      <Shell
        nav={nav}
        user={{ name: user.name, role: user.role }}
        locations={user.locations.map((l) => ({ id: l.id, name: l.name }))}
        locationId={user.location?.id ?? null}
        registerOpen={registerOpen}
      >
        {children}
      </Shell>
    </Suspense>
  );
}
