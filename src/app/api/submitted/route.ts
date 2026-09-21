import { listSubmitted } from "@/lib/db";

export const dynamic = "force-dynamic";

// Public "who's already sent a message" list: names + times only.
// Deliberately excludes tokens, file URLs and ids, so nothing here lets you watch or edit a clip.
export async function GET() {
  const subs = await listSubmitted();
  return Response.json(
    subs
      .filter((s) => s.submittedAt)
      .sort((a, b) => b.submittedAt!.getTime() - a.submittedAt!.getTime()) // newest first
      .map((s) => ({ name: s.name || "Someone", at: s.submittedAt })),
  );
}
