// The Worker script of iynkware-xr. Cloudflare runs it only for a request that matches no uploaded file and is not a
// page navigation; a navigation to such a path gets index.html instead (the SPA fallback, served as an asset, with
// the _headers rules). What reaches this script is a missing script, style, model or texture, usually a hashed file
// from an older deploy. Answering 404 keeps index.html out of the year-long cache that /assets/* URLs get.
// _headers does not apply to responses from this script, so it sets its own.
const worker = {
  fetch() {
    return new Response("Not found\n", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
      },
    });
  },
};

export default worker;
