import { z } from "zod";
import { saveSubmission } from "@/lib/db";
import { EVENT } from "@/lib/event";
import { utapi } from "@/lib/utapi";

const Body = z.object({
  token: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  fileKey: z.string().min(1).max(200),
  filename: z.string().max(255),
  trimStart: z.number().min(0),
  trimEnd: z.number().positive(),
});

// Called by the browser after the UploadThing upload succeeds.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const b = parsed.data;

  // Cap the selected length (not absolute end time) so a window later in a
  // longer uploaded file is allowed. +1s tolerance for timer/rounding drift.
  const limit = EVENT.maxDuration + 1;
  const length = b.trimEnd - b.trimStart;
  if (b.trimEnd <= b.trimStart) {
    return Response.json({ error: "Invalid trim range" }, { status: 400 });
  }
  if (length > limit) {
    return Response.json({ error: `Messages can be at most ${EVENT.maxDuration} seconds` }, { status: 400 });
  }
  if (length < EVENT.minDuration - 0.01) {
    return Response.json({ error: "Clip too short" }, { status: 400 });
  }

  // Don't trust a client-supplied URL: look the file up by key.
  const urls = await utapi.getFileUrls(b.fileKey);
  const fileUrl = urls.data[0]?.url;
  if (!fileUrl) return Response.json({ error: "Upload not found" }, { status: 400 });

  const saved = await saveSubmission(b.token, {
    name: b.name,
    filename: b.filename,
    fileKey: b.fileKey,
    fileUrl,
    trimStart: b.trimStart,
    trimEnd: b.trimEnd,
  });
  if (!saved) return Response.json({ error: "Invalid link" }, { status: 404 });

  // They re-recorded: drop the previous upload.
  if (saved.replacedKey) await utapi.deleteFiles(saved.replacedKey).catch(() => {});
  return Response.json({ ok: true });
}
