/** Stream a remote file back to the browser as a download (cross-origin `download` attrs are ignored). */
export async function proxyDownload(url: string, filename: string): Promise<Response> {
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) return new Response("File unavailable", { status: 502 });
  const safe = filename.replace(/[^\w.\- ]+/g, "_");
  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
    "content-disposition": `attachment; filename="${safe}"`,
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  return new Response(upstream.body, { headers });
}
