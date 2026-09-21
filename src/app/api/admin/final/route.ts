import { isAdmin } from "@/lib/auth";
import { getBuild } from "@/lib/db";
import { EVENT } from "@/lib/event";
import { proxyDownload } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const b = await getBuild();
  if (!b.fileUrl) return new Response("No final video yet", { status: 404 });
  return proxyDownload(b.fileUrl, EVENT.finalFilename);
}
