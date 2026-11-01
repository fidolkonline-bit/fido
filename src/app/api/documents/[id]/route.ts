import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSee } from "@/lib/essentials";

// Downloads are checked against the document's audience on every request (§19).
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  const doc = await db.documentFile.findUnique({ where: { id: (await params).id } });
  if (!doc || (!canSee(doc.audience, user.role) && !user.permissions.has("essentials.manage"))) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.auditEvent.create({ data: { actorId: user.personId, action: "DOCUMENT_DOWNLOADED", subjectType: "DocumentFile", subjectId: doc.id } });
  return new NextResponse(new Uint8Array(doc.data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
