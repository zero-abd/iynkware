# iynkware: read this first

iynkware is the immersive headset version of iynk, a hardware lab in the browser. On a Meta Quest 3S (controllers and
hand tracking) a person builds hardware projects on a spatial workbench, runs and stress tests them, and learns along
the way. It is WebXR on Meta's Immersive Web SDK (three.js), reusing iynk's simulation, project, content and i18n code.

The code was copied from iynk on 2026-11-14 with no shared history. It holds the full 2D iynk product (Next.js 16,
React 19, TypeScript, all simulation in the browser) and, in `xr/`, the headset app: its own Vite package that imports
iynk's `src/` and `content/`. Today `xr/` is a walking skeleton (Uno Blink on a bench, Run and Stop by controller or
hand). Its layout, data flow, shared contract files and run commands are in
[docs/XR_ARCHITECTURE.md](docs/XR_ARCHITECTURE.md). Work on it is on the issue board, one `ws:<pillar>` label per
pillar; an issue names the folders it owns.

Four people each run a fleet of agents against this repo at once. Read, in this order:

1. [docs/COLLABORATION.md](docs/COLLABORATION.md): the whole process (claiming, worktrees, ports, checks, PRs).
2. [docs/STATE.md](docs/STATE.md): what exists today and what does not.
3. [docs/XR_ARCHITECTURE.md](docs/XR_ARCHITECTURE.md): the headset app, for any issue labelled `ws:*`.
4. [docs/XR_DESIGN.md](docs/XR_DESIGN.md): the interaction and experience spec every headset feature builds to.
5. [CONTRIBUTING.md](CONTRIBUTING.md): strings in six languages, lessons, parts.
6. `node_modules/next/dist/docs/`: this Next.js differs from the one you remember.

[HANDOFF.md](HANDOFF.md) is iynk's handoff, kept for reference. Its paths, services, ports and commit rules belong to
iynk's owner, not to this project.

## Hard rules

1. Never push to `main` and never force push it. Every change lands as a squash merged PR.
2. Work only on an issue assigned to you. One issue, one branch, one worktree, one PR. Never share a worktree.
3. Shared contract files and `package-lock.json` change only in their own small PR (labels `contract-change`,
   `lockfile`), merged before the code that depends on them.
4. Never print, log, commit or quote a secret. `.env.local` is never committed.
5. Nothing is ever pushed to the iynk repository. This repo stays private. Say "free", never "open source".
6. A user facing string ships in all six languages (en de es fr hi zh) in the same PR.
7. Ask zero-abd before creating cloud resources, spending money or adding a large dependency.

## The loop

Run from your main checkout, which stays on `main`. `<n>` is the issue number, `<pr>` the PR number.

```bash
gh issue edit <n> --add-assignee @me                                   # 1. claim
git fetch origin                                                        # 2. branch and worktree
git worktree add -b <handle>/<n>-<slug> ../iynkware-wt-<slug> origin/main
cd ../iynkware-wt-<slug> && npm ci
git commit --allow-empty -m "Start #<n>"                                # 3. draft PR within the hour
git push -u origin HEAD
gh pr create --draft --base main --title "<what changes>" --body-file .github/pull_request_template.md
PORT=$((20000 + <n>)) npm run dev                                       # 4. build, on your own port
NODE_OPTIONS=--max-old-space-size=4096 bash scripts/ci-local.sh --only content,typecheck,lint,ui,no-only,copy
npx vitest run <folders you touched> < /dev/null                        # 5. check
node scripts/secret-scan.mjs --diff origin/main..HEAD
git fetch origin && git rebase origin/main && git push --force-with-lease   # 6. rebase, rerun the checks
gh pr ready <pr>                                                        # 7. paste commands and results first
gh pr merge <pr> --squash && git push origin --delete <handle>/<n>-<slug>   # 8. merge
```

Then remove the worktree (`docs/COLLABORATION.md`, section 3). When the full gate is required instead of the fast
set, and every trap, is in section 6 of that file.

For a `ws:*` issue, steps 4 and 5 happen in `xr/` (it has its own `package.json`; run `npm ci` there too):

```bash
cd xr && npm ci
npx vite --mode http --port $((23000 + <n>))                            # 4. IWER emulator in the page
npm run typecheck && npx vitest run < /dev/null && npm run build        # 5. check
node scripts/emulator-check.mjs http://localhost:$((23000 + <n>))/      #    the skeleton still works
```

Headset steps are in `docs/COLLABORATION.md` section 7. Agents never accept a consent dialog, licence or terms on the
headset, and never install a root certificate.

The block below is written by `next dev`. Leave it exactly as it is, or every dev run dirties the tree.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
