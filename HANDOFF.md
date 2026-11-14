> iynk's own handoff, copied with the code on 2026-11-14 and kept for reference. Its paths, services, ports, commit
> hashes and commit rules belong to iynk. iynkware's process is in [AGENTS.md](AGENTS.md) and
> [docs/COLLABORATION.md](docs/COLLABORATION.md); the current state is in [docs/STATE.md](docs/STATE.md).

# Continue building iynk

Read this first if you are picking up iynk (a person, Claude Code, Cursor). It says where things stand, how the
machine is set up, how a change gets to https://iynk.tech, the rules, and what is still open.

Last updated 2026-11-13. The last code change is `fef3ea58`; the commits after it touch only documentation.

## 1. Where things stand

- **Live:** https://iynk.tech serves `main`. Vercel builds every push to `main`; there is no other deploy step.
- **Branches on GitHub** (`kushwahaamar-dev/iynk`, private):

  | Branch | What it is |
  |---|---|
  | `main` | Production. |
  | `build/v1` | The working branch. Commit here, then push it to `main`. |
  | `iynk-v1` | The old pull request branch, kept level with `main`. Production comes only from `main`. |

  All three point at the same commit after every ship.

  No pull requests are open. GitHub Actions is turned off on purpose (no paid CI); checks run on this machine.
- **The product:** a hardware lab in the browser, in six languages (en, de, es, fr, hi, zh).
  - Board lab: 12 boards with lessons.
  - Robotics lab: 13 benches.
  - Drone lab: 13 drones and a flight sim.
  - Studio: your own projects on a canvas, with a circuit solver, firmware engines and sharing.
  - Together: rooms and buddies, which need the collaboration server in `server/`.
- **iynk.tech runs with no server.** Rooms and buddies are hidden there. Studio's "Share a link" puts the whole
  project inside the link (`#project=`), so a share needs nothing stored anywhere.

## 2. Read before you change anything

1. This is Next.js 16 with Cache Components (`next.config.ts`), and its APIs differ from older versions. Read the
   guide in `node_modules/next/dist/docs/` before using a Next API from memory; for dynamic routes start with
   `01-app/02-guides/migrating-to-cache-components.md`.
2. `README.md`: what the product is and is not.
3. `CONTRIBUTING.md`: how to add a string in six languages, a lesson or a part.
4. The docs in `docs/` for the area you touch (map in section 7).
5. `docs/MASTER_PLAN/` is the planning record from October 2026. It is history, not instructions; its
   `RESUME.md` describes the planning phase only.

## 3. Rules

These are Amar's standing rules. Follow them unless he says otherwise.

- **Commits** are authored as Amar, with plain messages and **no** `Co-Authored-By` or "Generated with" lines:

  ```bash
  git -c user.name="Amar Kushwaha" -c user.email="247959358+kushwahaamar-dev@users.noreply.github.com" commit -q -F msg.txt
  ```

- **Ask Amar first** before creating cloud resources or spending money, changing Vercel environment variables,
  force-pushing, or making the repository public.
- **Never** push `backup/simlab-history`.
- **Secrets:** `.env.local` holds real keys. Never print, log, copy or quote a value; only say whether a name is set.
- **Ports:** never use 3000 or 43117 on this machine. The local web copy is on 47100 and the server on 47101.
- **Licence:** none is chosen (`LICENSE-PENDING.md`). Until Amar picks one, the site and docs say "free" and
  "the code opens with the public release", never "open source".
- **This file** is tracked while the repository is private. Before the code goes public, decide whether it stays:
  it names this machine's paths and the deploy setup.
- **Other folders:** `/Users/amar/Codes/ak/simlab` is another project. Do not edit it or run git there.
  `/Users/amar/Codes/ak/utd` is read only.
- Do not kill Amar's own apps (browsers, Cursor, his Python processes) to free the machine.

## 4. This machine

| What | Where |
|---|---|
| Checkout (`build/v1`) | `/Users/amar/iynk-build/v1` |
| Build notes outside the repo | `/Users/amar/iynk-build/state/` (`BUILD_LOG.md`, `FOLLOWUPS.md`, `UI_RULES.md`) |
| Local web copy | launchd `dev.iynk.web`: `next start` on http://localhost:47100 from `.next-local`; log `/Users/amar/iynk-build/local/web.log` |
| Local server | launchd `dev.iynk.server`: `server/src/main.ts` on 127.0.0.1:47101; data `/Users/amar/iynk-build/local/data`; log `/Users/amar/iynk-build/local/server.log` |

The local copy has a server, so it shows Together and the server version of Studio sharing. iynk.tech does not.

**Rebuild and restart the local copy** with no keys, so nothing reaches a paid provider:

```bash
cd /Users/amar/iynk-build/v1
env META_API_KEY= GEMINI_API_KEY= SERPAPI_KEY= NEXT_PUBLIC_REALTIME_URL= IYNK_SERVER_TOKEN= \
  IYNK_AI_ENABLE= IYNK_SEARCH_ENABLE= \
  IYNK_CONNECT_ORIGINS=http://127.0.0.1:47101,ws://127.0.0.1:47101,http://localhost:47101,ws://localhost:47101 \
  NEXT_PUBLIC_SITE_URL=http://localhost:47100 SITE_URL=http://localhost:47100 NEXT_DIST_DIR=.next-local \
  npm run build
git checkout tsconfig.json          # the build adds a line to it
launchctl kickstart -k gui/$(id -u)/dev.iynk.web
```

An empty variable in the shell wins over `.env.local`, which is why the keys are set to nothing.

## 5. Everyday commands and their traps

```bash
npx next typegen && npx tsc --noEmit -p . ; git checkout tsconfig.json   # typecheck
npx eslint . --quiet                                                    # lint
npx vitest run <paths> < /dev/null                                      # unit tests (stdin closed, or it can hang)
npx playwright test <spec>                                              # e2e; builds and serves its own copy
node scripts/ui-check.mjs <paths>                                       # UI rules
node scripts/copy-check.mjs                                             # copy rules
```

- **One-off Playwright scripts** go in `scripts/.tmp-*.mjs`, so they can import `@playwright/test`. Delete them
  before you commit.
- **Locales:** all six `src/i18n/messages/<lang>/*.json` files keep the same keys. Rewrite them with Python
  `json.dumps(d, ensure_ascii=False, indent=2) + "\n"` so the diff stays clean.
- **UI rules** (`scripts/ui-check.mjs`, exceptions in `scripts/ui-check.allow.json`):
  - R4: spacing stays on the scale, so no `gap-5` or `p-5`.
  - R7: no `ease`, `linear` or `transition-all`. Use `ease-(--ease-iynk)`.
  - R8: z-index only through the `z-*` tokens.
  - R17: no scroll listeners. Use an IntersectionObserver.
- **English copy rules** (R14 and `copy-check`): no "!", no " - ", no em dashes, no filler, no hyphenated words
  such as "read-only".
- **Class conflicts:** `cx()` joins class names and does not resolve conflicts. A `className` that fights a
  component's own class (for example `whitespace-normal` against `whitespace-nowrap`) silently loses. Give the
  component a prop instead, like `Chip wrap`.
- **Dynamic routes** (`[board]`, `[lesson]`, `[bench]`, `[drone]`): reject an unknown id with `notFound()` in the
  page's default export, before the `<Suspense>` boundary. Inside the boundary it breaks the stream, and the first
  click throws React error 419. `dynamicParams` is not allowed with Cache Components.
- **Workspace pages** hide the site header just above the top edge. A test that opens Settings there must move the
  mouse to the top edge first (`page.mouse.move(400, 1)`), then wait for the button to be in the viewport.
- **Busy machine:** e2e timings fail when the load average is above about 10. Check `uptime`, wait, and rerun
  before you blame the code.

## 6. Shipping a change

Every step has to pass. Nothing ships on a red step.

1. Commit on `build/v1` (rules in section 3).
2. `NODE_OPTIONS=--max-old-space-size=4096 bash scripts/ci-local.sh`. Every row in its summary must say `passed`.
   It runs content, schema, typecheck, lint, ui, no-only, copy, provenance, unit, perf, server, build, e2e,
   secrets and audit.
3. Rebuild the local copy (section 4), then run `node scripts/perf-budget.mjs http://localhost:47100 --runs 3`.
   Every metric must say `ok`.
4. `node scripts/secret-scan.mjs --diff origin/main..HEAD` must report 0 hits. `--history` reports 11 hits, all
   allowed.
5. `git push origin build/v1:main`, `git push origin build/v1` and `git push origin build/v1:iynk-v1`.
6. Check the live site within about 5 minutes:
   - the change is served;
   - https://iynk.tech/engines/manifest.json lists `avr8js`, `rp2040js`, `yosys` and `rapier`;
   - a quick browser pass of what you changed shows no page errors.
7. Add a line to `/Users/amar/iynk-build/state/BUILD_LOG.md`.

## 7. Map of the code

| Folder | What lives there | Read |
|---|---|---|
| `src/app` | Pages and API routes, one page per lab item, in six languages | `node_modules/next/dist/docs/` |
| `src/components` | Lab UIs, Studio, the shell, the landing page (`home`, `editorial`), shared `ui` | `docs/UI.md` |
| `src/content` | Boards, benches, drones: lessons, steps, faults, checks | `CONTRIBUTING.md` |
| `src/project` | The project document, its schema, storage, files and conversion of lab items to projects | `docs/PROJECT_CORE.md`, `docs/PROJECT_FILES.md` |
| `src/studio` | Studio: the SVG renderer, overlays such as the flow lens, link sharing, assignments | |
| `src/export` | Wokwi import, KiCad netlist and SPICE export (the Studio's Project menu) | `docs/INTEROP.md` |
| `src/cli` | The `iynk` command line | `docs/CLI.md` |
| `src/sim`, `src/sim-host` | The circuit solver, part models and the engine host (avr8js, rp2040js, yosys, rapier) | `docs/SIM_ANALOG.md`, `docs/SIM_RP2040.md`, `docs/PART_STATE.md` |
| `src/parts` | The parts registry the palette and the solver read | `docs/PART_STATE.md` |
| `src/lib` | Interpreters, drone calculator, flight model, settings, progress | |
| `src/collab`, `src/server-client`, `server/` | Rooms, buddies and server shares | `docs/SERVER_AND_KEYS.md`, `docs/SELF_HOSTING.md` |
| `src/ai` | The optional AI partner (off unless the person running the server turns it on) | `docs/DATA_HANDLING.md` |
| `src/i18n` | Messages and lesson prose in six languages | `CONTRIBUTING.md` |
| `figures` | Figure sources and engines, built into `public/figures` | `docs/FIGURES*.md` |
| `e2e` | Playwright tests, with axe checks | |
| `deploy` | Dockerfiles, compose and Caddy for running your own copy | `docs/SELF_HOSTING.md` |

## 8. How the last audit was done

A full pass on 2026-11-13 found the problems fixed in `fe86ce13`. Repeat it after a large change. The scripts were
one-offs; each is short to rewrite in `scripts/.tmp-*.mjs`.

1. **Crawl:** take every URL from `/sitemap.xml` for one language, at 1440×900 and 375×760.
   - Record page errors, console errors, failed requests and responses of 400 or above.
   - Record `document.documentElement.scrollWidth - innerWidth`; anything above 0 overflows the screen.
   - Record buttons and links with no name, images with no `alt`, and controls smaller than 24 px.
   - Fetch every internal link once to find broken ones.
2. **Every button:** for each page type, reload the page, click one button by its accessible name, then press
   Escape. Record page errors.
   - Index-based clicking drifts as panels load, so use names.
   - A disabled button is a finding only if nothing on screen says why.
3. **Accessibility:** run `@axe-core/playwright` with the WCAG 2.2 AA tags on each page type, in light and in dark.
   Force dark with `data-theme="dark"`, because the default theme is light whatever the OS prefers.
4. **Read it as a newcomer:** take screenshots while you scroll (content fades in, so full-page shots come out
   blank), and walk landing → Open the workbench → lesson → Run, and Studio → Start with Blink → Run.
5. Repeat the phone crawl in German (`/de`), whose long words find overflow first.

Last result: no broken links, no button that throws, axe clean in both themes, and no page wider than a phone in
en, de and hi.

## 9. Open items

Checked against the code on 2026-11-13.

| Item | Why it is open |
|---|---|
| Licence | Amar's decision. Provenance rows P-01 to P-06 (`npm run provenance:check -- --strict`) must be settled first; when a licence is picked, `LICENSE-PENDING.md` becomes `LICENSE` and the copy may say "open source" again. |
| Translations | The de, es, fr, hi and zh copy has not been read by native speakers. |
| `minimatch` advisory | 7 moderate advisories, all under `@typescript-eslint` (lint only, not shipped). Only an alpha release fixes it so far. `npm audit --omit=dev` is clean. |
| Content Security Policy | Script elements keep `'unsafe-inline'` because pages are prerendered and Next writes flight data into inline scripts; inline handlers are refused (`script-src-attr 'none'`). A nonce needs a render per request, so it would cost the static shell and the CDN cache. Trusted Types was measured and left off: Next runs its async chunks before any inline script can define the policy, and a chunk won the race in testing (notes in `src/lib/csp.ts`). |
| Microphone | `Permissions-Policy` refuses it because nothing records audio. Change `microphone=()` in `next.config.ts` (and `e2e/headers.spec.ts`) if voice input is built. |
| Server docs | `docs/SELF_HOSTING.md`, `docs/SERVER_AND_KEYS.md`, `docs/DATA_HANDLING.md` and the README's "How it works" still describe the old Next `/api/*` routes and `IYNK_AI_PROVIDER`. AI, search and MCP now live in `server/` (`/v1/ai`, `/v1/search`, `/v1/mcp`), configured by `server/src/config.ts`; `/config.json` answers `{ server, protocol }`. `NEXT_PUBLIC_REALTIME_URL` in `.env.example` is read by nothing. |
| Self-hosting stack | `deploy/compose.yaml` has been checked with `docker compose config` only; one real `docker compose up` run is still owed. |

## 10. Recent releases

`git log --oneline` has the whole story. The latest:

| Commit | Date | What shipped |
|---|---|---|
| `131ca91a` | 2026-11-13 | Security headers: no inline handlers or blob workers, opener and resource isolation, every unused device feature refused. |
| `fef3ea58` | 2026-11-13 | The Studio axe test reaches the top edge before opening Settings (a race under load). |
| `d0154b23` | 2026-11-13 | "Free", not "open source", until a licence is chosen, in six languages. |
| `fe86ce13` | 2026-11-13 | Audit fixes: the landing pill steps aside from the last call to action and the footer; benches fit a phone; unknown ids 404 before streaming; 24 px press areas. |
| `7ff0fe04` | 2026-11-13 | Studio shares a project as a link with no server; run tags readable over wires; hono patched. |
| `198326ec` | 2026-11-13 | First-run coach (`?try=1`), the What if button in lessons, the self-hosting guide, art for the last plain parts. |
| `8d9e3ded` | 2026-11-12 | Workspaces take the whole screen: the nav waits at the top edge, fly goes full screen. |
| `7d72b59b` | 2026-11-12 | The landing hero: a lit workshop drawn in glyphs, with a time-of-day slider. |
