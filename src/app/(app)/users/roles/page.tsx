import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PERMISSIONS, ALL_PERMISSIONS } from "@/lib/permissions";
import { PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { saveRolePermissions } from "../actions";

export const metadata = { title: "Roles" };

export default async function Roles() {
  await requirePermission("users.manage");
  const roles = await db.role.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { accounts: true } } } });
  return (
    <div className="stack">
      <PageHead eyebrow="User Management" title="Roles & permissions" />
      <p className="small muted" style={{ margin: 0 }}>Permissions are enforced on the server for pages, actions and exports — not just by hiding buttons.</p>
      {roles.map((r) => {
        const locked = r.name === "Owner/Admin";
        return (
          <details key={r.id} className="panel">
            <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong style={{ fontWeight: 600 }}>{r.name}</strong>
              <span className="small muted">{r.permissions.length} permissions · {r._count.accounts} users</span>
            </summary>
            <form action={saveRolePermissions} className="stack" style={{ marginTop: 12 }}>
              <input type="hidden" name="roleId" value={r.id} />
              <div className="grid2" style={{ gap: 4 }}>
                {ALL_PERMISSIONS.map((p) => (
                  <label key={p} className="check small"><input type="checkbox" name="perm" value={p} defaultChecked={r.permissions.includes(p)} disabled={locked} /> {PERMISSIONS[p]}</label>
                ))}
              </div>
              {locked ? <p className="small muted">The owner role always keeps every permission.</p> : <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Save {r.name}</SubmitButton></div>}
            </form>
          </details>
        );
      })}
    </div>
  );
}
