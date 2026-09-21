import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { createSubmission } from "@/lib/db";

// Admin mints a named personal link to send to someone.
export async function POST(req: Request) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const body = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Name required" }, { status: 400 });
  const sub = await createSubmission(body.data.name);
  return Response.json({ token: sub.token });
}
