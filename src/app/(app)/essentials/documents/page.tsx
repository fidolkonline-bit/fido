import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { canSee } from "@/lib/essentials";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { uploadDocument, removeDocument } from "../actions";
import { RoleBoxes } from "../RoleBoxes";

export const metadata = { title: "Documents" };
const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

export default async function Documents() {
  const user = await requireUser();
  const manage = can(user, "essentials.manage");
  const [docs, roles] = await Promise.all([
    db.documentFile.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, description: true, size: true, audience: true, createdAt: true, createdBy: { select: { fullName: true } } } }),
    db.role.findMany({ select: { name: true } }),
  ]);
  const visible = docs.filter((d) => manage || canSee(d.audience, user.role));
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <PageHead eyebrow="Essentials" title="Documents" />
      <DataTable rows={visible} rowKey={(d) => d.id} empty="No documents."
        columns={[
          { label: "Document", primary: true, render: (d) => <a href={`/api/documents/${d.id}`}>{d.name}</a> },
          { label: "About", render: (d) => d.description ?? "" },
          { label: "Size", num: true, render: (d) => size(d.size) },
          { label: "Who sees it", render: (d) => (d.audience.length ? <Badge>{d.audience.join(", ")}</Badge> : "Everyone") },
          { label: "Added", render: (d) => `${fmtDateTime(d.createdAt)} · ${d.createdBy.fullName}` },
          { label: "", render: (d) => manage ? <form action={removeDocument}><input type="hidden" name="id" value={d.id} /><button className="btn btn-sm btn-ghost btn-danger">Remove</button></form> : null },
        ]} />
      {manage && (
        <ActionForm action={uploadDocument} className="panel stack">
          <h2 style={{ margin: 0 }}>Upload</h2>
          <div className="grid3">
            <label className="field"><span>File (max 4 MB)</span><input type="file" name="file" required /></label>
            <label className="field"><span>Name</span><input name="name" placeholder="Defaults to the file name" /></label>
            <label className="field"><span>About</span><input name="description" /></label>
          </div>
          <RoleBoxes roles={roles.map((r) => r.name)} />
          <div><SubmitButton pendingText="Uploading…">Upload</SubmitButton></div>
        </ActionForm>
      )}
    </div>
  );
}
