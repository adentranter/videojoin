import { isAdmin } from "@/lib/auth";
import { getBuild, listSubmitted, startBuild } from "@/lib/db";
import { runBuild } from "@/lib/build";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  return Response.json(await getBuild());
}

export async function POST() {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const clips = await listSubmitted();
  if (clips.length === 0) return Response.json({ error: "No submissions yet" }, { status: 400 });
  // total = one step per clip + the final join/upload step
  if (!(await startBuild(clips.length + 1))) {
    return Response.json({ error: "A build is already running" }, { status: 409 });
  }
  void runBuild(); // fire and forget; progress is polled via GET
  return Response.json({ ok: true }, { status: 202 });
}
