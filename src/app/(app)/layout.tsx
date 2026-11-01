import { Suspense } from "react";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { NAV } from "@/lib/nav";
import { Shell } from "@/components/Shell";
import { pushPublicKey } from "@/lib/push";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Hide destinations the role cannot open; the server still enforces every permission.
  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || user.permissions.has(i.perm)) })).filter((g) => g.items.length);
  const registerOpen = user.location
    ? !!(await db.registerSession.findFirst({ where: { locationId: user.location.id, userId: user.personId, closedAt: null }, select: { id: true } }))
    : false;

  const t = (await cookies()).get("fido_theme")?.value;

  return (
    <Suspense>
      <Shell
        nav={nav}
        user={{ name: user.name, role: user.role }}
        locations={user.locations.map((l) => ({ id: l.id, name: l.name }))}
        locationId={user.location?.id ?? null}
        registerOpen={registerOpen}
        theme={t === "light" || t === "dark" ? t : "system"}
        vapidKey={pushPublicKey()}
      >
        {children}
      </Shell>
    </Suspense>
  );
}
