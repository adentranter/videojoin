import { createSubmission } from "@/lib/db";

// Landing page "Record your message" → mint a fresh unique link.
// POST (not GET) so link prefetchers/crawlers don't create rows.
// Relative Location: behind the proxy, req.url may carry the internal host.
export async function POST() {
  const sub = await createSubmission();
  return new Response(null, { status: 303, headers: { location: `/r/${sub.token}` } });
}
