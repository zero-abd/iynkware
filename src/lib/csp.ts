const ORIGIN = /^(https?|wss?):\/\/[^/?#\s]+$/;

/** Keeps the bare http, https, ws and wss origins of a comma separated list; anything else is dropped. */
export function parseOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => ORIGIN.test(origin));
}

/**
 * The policy for every page and API route (D-022). Script elements and styles keep 'unsafe-inline': pages are
 * prerendered and served from the CDN, and Next writes each page's flight data into inline scripts, so a nonce
 * (which needs a fresh render per request) or a hash list (which changes with every page) cannot replace it.
 * Inline event handlers are refused outright; nothing in the app writes one. connect-src is what stops a page
 * from sending a stored key to another origin.
 *
 * Trusted Types was tried and left off: its default policy has to come from an inline script, Next places that
 * after its own async chunks, and in testing a chunk sometimes ran first, which breaks the page.
 */
export function buildCsp({ dev, connectOrigins }: { dev: boolean; connectOrigins: readonly string[] }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self'",
    ["connect-src 'self'", ...connectOrigins].join(" "),
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

/** The policy for /figures/*: self-contained generated files with inline scripts and styles, and no network (D-B1-3). */
export function buildFigureCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "script-src-attr 'none'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}
