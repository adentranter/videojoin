import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { setOrder } from "@/lib/db";

// Save the drag-and-drop order. Body: { ids: string[] } with ids[0] playing first.
export async function PUT(req: Request) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const body = z.object({ ids: z.array(z.string().uuid()).max(1000) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid order" }, { status: 400 });
  await setOrder(body.data.ids);
  return Response.json({ ok: true });
}
