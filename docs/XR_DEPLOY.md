# Deploying the headset app

The headset app is a static Vite build (`xr/dist`). It is served over HTTPS from Cloudflare, so a Meta Quest 3S can open
it without a USB cable. Everything for the deploy lives in [deploy/cloudflare-xr/](../deploy/cloudflare-xr/wrangler.jsonc).

## Where it runs

- **Product:** Cloudflare Workers static assets, one Worker named `iynkware-xr` on zero-abd's Cloudflare account,
  served on its `workers.dev` address. Workers rather than Pages because Cloudflare now recommends Workers static assets
  for new static sites and single page apps, and puts new features there; it has the same `_headers` file, SPA
  fallback and per-branch Previews.
- **Cost:** the Free plan. Requests for files are free and do not count as Worker requests. The small Worker script
  (`not-found.js`) runs only for a missing file (below), so it stays far inside the Free plan's 100,000 requests a day.

### Live URLs

Checked on 2026-11-14:

| URL | Serves |
|---|---|
| https://iynkware-xr.almahmud-zero.workers.dev | Production. Today: the throwaway XR spike build (Immersive Web SDK starter), until the first `xr/dist` deploy replaces it. |
| https://test-page-iynkware-xr.almahmud-zero.workers.dev | A Preview with the deploy test page: one cube, an Enter button, a list of what the headers allow. |

**These URLs are public.** Anyone with the link can open them, while the repo stays private. Whatever is deployed
can be read by anyone: the built JavaScript, the scene files, the assets. Do not deploy anything that must stay
private. Search engines are asked not to index the site (`X-Robots-Tag: noindex`), and source maps are left out of
every upload (`.assetsignore`), but neither is access control.

## Deploying

You need Node 22 or later and Wrangler logged in to zero-abd's Cloudflare account (`npx wrangler login`, then
`npx wrangler whoami` shows the account). Wrangler 4.162.0 is pinned in `deploy.mjs` and fetched by `npx`; the
folder has no dependencies and no lockfile. Run the commands from `deploy/cloudflare-xr/`:

| Command | Does |
|---|---|
| `npm run deploy` | Deploys `../../xr/dist` to production. |
| `npm run deploy -- <dir>` | Deploys another build folder. A relative path is read from where you ran npm. |
| `npm run deploy -- --test-page` | Builds and deploys the test page in `test-page/`. |
| `npm run deploy -- <dir> --dry-run` | Stages the build and runs Wrangler's checks, uploads nothing. |
| `npm run preview -- [<dir>]` | Deploys a Preview named after the current git branch. |
| `npm run preview -- [<dir>] --name <name>` | Deploys a Preview with another name. |
| `npm run check -- <url>` | Checks a live URL against `_headers` (below). |

`--keep` keeps the staging folder and prints where it is.

What a deploy does:

1. Copies the build folder into a new temporary folder outside the repo. The build folder is never changed, and the
   deploy refuses a build that brings its own `_headers`, so the headers have one source.
2. Adds `_headers` and `.assetsignore` from `deploy/cloudflare-xr/`.
3. Writes a copy of `wrangler.jsonc` whose `assets.directory` points at that folder, and runs `wrangler deploy` (or
   `wrangler preview`) against it, with the git commit as the version message.
4. Deletes the temporary folder.

Run `npm run check -- <url>` after a deploy. It asks for `/`, a client side route and the first file under
`/assets/` that the page names, and fails unless each answers 200 with exactly the headers in `_headers`. It also
asks for a missing file under `/assets/`, which must be a 404.

A bare `npx wrangler deploy` in that folder would upload `../../xr/dist` without the headers. Use the npm scripts.

### Previews, one per branch

`npm run preview` deploys to `https://<name>-iynkware-xr.almahmud-zero.workers.dev`, where `<name>` is the branch
name in lower case with every other character turned into `-` (for example `zero-abd/xr-cloudflare-deploy` becomes
`zero-abd-xr-cloudflare-deploy`). Deploying again to the same name updates it. Production is untouched. A Preview
stays until it is deleted: `npx wrangler preview delete --name <name>` from `deploy/cloudflare-xr/`. Previews are an
open beta in Wrangler; the Free plan allows 100 per Worker.

### Rolling back

Every deploy is a version. `npx wrangler versions list` lists them and `npx wrangler rollback <version-id>` puts an
earlier one back, both from `deploy/cloudflare-xr/`.

## Headers, and why

All of them are in [_headers](../deploy/cloudflare-xr/_headers), which Cloudflare applies to every file response,
including the SPA fallback.

| Header | Value | Why |
|---|---|---|
| `Permissions-Policy` | `xr-spatial-tracking=(self), microphone=(self)`, every other powerful feature `()` | WebXR sessions need `xr-spatial-tracking`; voice input needs `microphone`. `(self)` allows the page's own origin and no embedded frame. Camera, location, USB, serial, motion sensors and the rest are refused until something needs them. |
| `Content-Security-Policy` | `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'`; `worker-src 'self' blob:`; `connect-src 'self' blob: data:`; `img-src` and `media-src 'self' data: blob:`; `style-src 'self' 'unsafe-inline'`; `font-src 'self' data:`; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'none'` | Everything comes from the site itself. `'wasm-unsafe-eval'` lets WebAssembly compile (physics, Draco and Basis decoders, text). `blob:` workers are how three.js loaders and the SDK's text renderer start their workers. `blob:` and `data:` cover textures and buffers that glTF files carry inline. No inline scripts, no `eval`. |
| `Cross-Origin-Opener-Policy` | `same-origin` | Cuts the tie to any window that opened this one. |
| `Cross-Origin-Resource-Policy` | `same-origin` | Other sites cannot embed these files. |
| `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` | `nosniff`, `DENY`, `strict-origin-when-cross-origin` | The hardening the 2D app sends too; the headset app is never framed, so `DENY` rather than `SAMEORIGIN`. |
| `X-Robots-Tag` | `noindex` | Keeps the public URL out of search results. Previews get it from Cloudflare as well. |
| `Cache-Control` on HTML and other unhashed files | `no-cache` | The browser revalidates every time (Cloudflare sends an `ETag`), so a new deploy shows on the next load. |
| `Cache-Control` on `/assets/*` | `public, max-age=31536000, immutable` | Vite puts a content hash in every file name there, so a name never changes meaning. Anything under `/assets/` must be hashed or versioned. |

No `Cross-Origin-Embedder-Policy`: nothing in the code uses `SharedArrayBuffer`, and the policy would block any
cross-origin file that does not opt in. Add it, with `require-corp`, when a threaded engine needs it.

### Routing

- `not_found_handling: "single-page-application"`: a page navigation to a path with no file gets `index.html` with 200,
  so client side routes survive a reload.
- Any other request for a missing file (a script, a model, a texture, usually a hashed file from an older deploy)
  reaches `not-found.js`, which answers 404. Without it Cloudflare would answer `index.html`, and a browser would keep
  that HTML for a year under the asset's URL.
- Build with Vite's `base: "/"` (the default) if the app has client side routes. With `base: "./"`, a page at
  `/room/42` would look for `/room/assets/...`.

### Opening other origins

`connect-src 'self'` means the app cannot fetch from another host. The spike build shows what that refuses today: the
Immersive Web SDK loads controller models from `cdn.jsdelivr.net` (`@webxr-input-profiles/assets`) and its default
Draco decoder from `unpkg.com`. The SDK catches the failed model load, so input should still work, but controllers may
show no model. The fix is to serve those files from the app itself. A backend the app must talk to, such as a voice
service, is added to `connect-src` in `_headers` as an exact origin, in its own PR.

## Opening it on the headset

The headset needs Wi-Fi and nothing else:

- In the headset, open the Meta Quest Browser and type the URL.
- Or send it from your Mac with the Meta Horizon CLI:

  ```bash
  export PATH="$HOME/.metavr/bin:$PATH"
  metavr device list                                   # the headset must show up
  metavr device browser https://iynkware-xr.almahmud-zero.workers.dev
  ```

  `metavr device browser` talks to the headset over ADB. Plug in USB once and run `metavr device wifi enable`; after
  that the commands work over Wi-Fi with the cable out.

In the browser, press **Enter** (the test page) or the spike's enter panel, and allow any permission prompt. The test
page tries `immersive-ar` (passthrough) with hand tracking optional, then falls back to `immersive-vr`. Its status
list shows whether the page is a secure context, whether the policy allows `xr-spatial-tracking` and `microphone`,
whether WebAssembly compiles and a `blob:` worker runs, and which session and features were granted.

Checked on 2026-11-14 in desktop Chromium (no headset): both URLs load with no CSP errors, the policy allows
`xr-spatial-tracking` and `microphone`, WebAssembly compiles and a `blob:` worker runs. Neither URL has been opened in
a Quest yet.

## Not set up

- **Custom domain.** Only the `workers.dev` address. A domain would be bought and attached by zero-abd.
- **Access restriction.** Anyone with the URL can open it. Cloudflare Access (Zero Trust) can put a sign-in in front
  of production and Previews; it is an account-level setting for zero-abd to decide on.
- **Deploys from GitHub.** Nothing deploys on push or merge; someone with the Cloudflare login runs the commands above.
  Workers Builds could connect the repo; not done.
- **Logs and analytics.** `wrangler.jsonc` configures no observability; nothing records requests beyond what the
  Cloudflare dashboard shows by default.
- **Byte ranges.** Static files answer a `Range` request with the whole file, which some video players need. Fine for
  short audio and models.
- **Limits** (Free plan): 20,000 files per deploy, 25 MiB per file, 100 rules in `_headers`.
