import { deleteSubmission, getById } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { proxyDownload } from "@/lib/proxy";
import { utapi } from "@/lib/utapi";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const sub = await getById((await params).id);
  if (!sub?.fileUrl) return new Response("Not found", { status: 404 });
  const ext = sub.filename?.split(".").pop() || "webm";
  return proxyDownload(sub.fileUrl, `${sub.name || sub.token}.${ext}`);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const sub = await deleteSubmission((await params).id);
  if (!sub) return new Response("Not found", { status: 404 });
  if (sub.fileKey) await utapi.deleteFiles(sub.fileKey).catch(() => {});
  return Response.json({ ok: true });
}
