# Working on iynkware in parallel

This is the process for everyone who works in this repo, people and agents alike. Four people each run a fleet of
coding agents here at the same time, so a dozen or more agents can be editing at once. The rules below exist so that
their work does not collide. The short version is [AGENTS.md](../AGENTS.md); what the code can do today is in
[STATE.md](STATE.md).

## 1. Access and setup

- The repo `zero-abd/iynkware` is private. zero-abd adds each person as a collaborator with write access; accept the
  invitation at https://github.com/zero-abd/iynkware/invitations.
- Clone it:

  ```bash
  git clone https://github.com/zero-abd/iynkware.git
  cd iynkware
  nvm use            # Node 24, from .nvmrc; scripts/ci-local.sh refuses any other major version
  npm ci
  ```

- You also need Python 3 (the figure tests run `figures/tools/cfbuild.py`). Before the first Playwright run on a
  machine, install its browsers with `npx playwright install`.
- Run the app with `PORT=<port> npm run dev` (section 4 says which port). `npm run dev` first runs `npm run content`,
  then `next dev`. Without `PORT` it takes 3000, which every other copy wants too.
- `.env.local` is never committed (`.gitignore` ignores every `.env*` file except `.env.example`) and its values are
  never printed, logged or quoted. You do not need one: every variable is optional, and AI and search stay off
  without keys.
- `next dev` writes a block of Next.js instructions into `AGENTS.md` when it detects a coding agent. The committed
  file already carries that block, so the tree stays clean. If a Next upgrade changes the block, commit the new text
  in the same PR as the upgrade.

## 2. Claiming work

- GitHub issues are the board. One issue is one slice of one workstream. The workstream issues arrive with the
  foundation PR and `docs/XR_ARCHITECTURE.md`.
- Find open work: `gh issue list --state open --search "no:assignee"`.
- Claim an issue by assigning yourself, then open a draft PR within the hour, so other fleets see what you are on:

  ```bash
  gh issue view <n>                       # check that nobody is assigned
  gh issue edit <n> --add-assignee @me
  ```

  The draft PR commands are in section 3. Put `Closes #<n>` in its body.
- Never work on an issue assigned to someone else. Comment on it instead: `gh issue comment <n> --body "..."`.
- Work that is not on the board gets an issue first (`gh issue create --title "..." --body "..."`), then you claim
  it.
- If you stop, say so on the issue, unassign yourself (`gh issue edit <n> --remove-assignee @me`) and close the draft
  PR. If you are waiting on something, add the `blocked` label and say what you are waiting on.

## 3. Branches and worktrees

One issue is one branch, one worktree and one PR. Agents never share a worktree, and nobody edits in the main
checkout: it stays on `main` and only creates and removes worktrees.

- Branch name: `<github-handle>/<issue-number>-<slug>`, for example `naeemexe/7-wire-snap`.
- Worktree: a sibling folder of the main checkout named `iynkware-wt-<slug>`.

Start an issue, from the main checkout:

```bash
git fetch origin
git worktree add -b <handle>/<n>-<slug> ../iynkware-wt-<slug> origin/main
cd ../iynkware-wt-<slug>
npm ci                                   # every worktree has its own node_modules
git commit --allow-empty -m "Start #<n>"
git push -u origin HEAD
gh pr create --draft --base main --title "<what changes>" --body-file .github/pull_request_template.md
```

- `git worktree list` shows every worktree and its branch.
- Keep worktrees outside the main checkout. `eslint.config.mjs` ignores only the folders it names, so `npm run lint`
  in the main checkout would also lint a worktree nested inside it.
- If your tool makes its own worktree and branch (Claude Code puts them in `.claude/worktrees/`), rename the branch to
  the convention before the first push: `git branch -m <handle>/<n>-<slug>`.

After the PR is merged, from the main checkout:

```bash
git worktree remove ../iynkware-wt-<slug>
git branch -D <handle>/<n>-<slug>        # -D, because git does not see a squash merged branch as merged
git fetch --prune origin
git pull --ff-only                       # main stays level with origin/main
```

`git worktree remove` refuses while the worktree has changed or untracked files. Look at them before you reach for
`--force`.

## 4. Running many copies on one machine

Each copy needs its own port and its own Next build folder. This is what the repo reads:

| Setting | Read by | Default |
|---|---|---|
| `PORT` (or `-p`) | `next dev`, `next start` | 3000 |
| `NEXT_DIST_DIR` | `next.config.ts` (`distDir`), and `playwright.config.ts` for its build | `.next`; Playwright uses `.next-e2e` |
| `E2E_PORT`, `E2E_SERVER_PORT`, `E2E_DEAD_PORT` | `playwright.config.ts` | random, 40000 to 49999, never 3000 or 43117 |
| `IYNK_PORT` | the collaboration server in `server/` | 8787 |

The build folder is relative to the worktree, so each worktree already has its own `.next`. `scripts/ci-local.sh`
builds into `.next-ci` and Playwright into `.next-e2e`, so neither touches your dev copy. Set `NEXT_DIST_DIR` only
for a second Next process in the same worktree, and name it `.next-wt`: `tsconfig.json` already lists `.next`,
`.next-ci`, `.next-e2e` and `.next-wt`, and any other name makes `next typegen` or `next build` add two lines to
`tsconfig.json`.

Derive your ports from the issue number, so they stay the same for the life of the issue and differ from every other
issue's (unique while issue numbers stay under 1000):

```bash
N=42                                                  # your issue number
PORT=$((20000 + N)) npm run dev                       # http://localhost:20042

# a second copy in the same worktree, for example a production build next to dev:
NEXT_DIST_DIR=.next-wt npm run build
NEXT_DIST_DIR=.next-wt PORT=$((21000 + N)) npx next start

# the collaboration server, only for Together, rooms and buddies (setup in SELF_HOSTING.md):
IYNK_PORT=$((22000 + N))
```

- Set `NEXT_DIST_DIR` on the command, never with `export`. Playwright builds into `NEXT_DIST_DIR` when it is set, so an
  exported value sends the e2e build into your dev folder.
- Playwright picks its own ports for every run; you do not set them.
- If you have a `.env.local`, blank the service variables when you build by hand, as [CONTRIBUTING.md](../CONTRIBUTING.md)
  shows.
- Checked on 2026-11-14: `npm run dev` on 20042 with `.next` and a second `npm run dev` in the same worktree on 20043
  with `NEXT_DIST_DIR=.next-wt` both answered `/en` with 200.
- [HANDOFF.md](../HANDOFF.md) reserves ports 3000 and 43117 (never used), 47100 (a local web copy) and 47101 (a local
  server). Those reservations are for Amar's machine, not ours. `playwright.config.ts` still refuses 3000 and 43117 on
  every machine.
- Many fleets on one machine make it slow. HANDOFF.md notes that e2e timings fail when the load average is above
  about 10: check `uptime`, wait and rerun before you blame the code. Timing budgets (`npm run test:perf` and the
  Playwright `perf` project) need a quiet machine.

## 5. Keeping PRs mergeable

- One concern per PR. Small PRs merge; large ones conflict.
- Before you ask for a merge, rebase on `origin/main`, rerun the checks and push your branch:

  ```bash
  git fetch origin && git rebase origin/main
  git push --force-with-lease
  ```

  Force pushing your own branch is fine. Never force push `main` and never push to it directly.
- Merge with a squash, then delete the branch (the repo does not delete merged branches by itself):

  ```bash
  gh pr merge <pr> --squash
  git push origin --delete <handle>/<n>-<slug>
  ```

- `main` has no branch protection: GitHub offers neither protection nor rulesets for a private repo on this account's
  plan. These rules hold because everyone keeps them.
- **Shared contract files** are the types and interfaces that other workstreams import. Their list will be in
  `docs/XR_ARCHITECTURE.md`. A change to one goes in its own small PR with the `contract-change` label, merged before
  any code that depends on it. Until the list exists, treat the inherited shared cores the same way: `src/core`,
  `src/protocol` and `src/project`, which package.json exposes as `#core/*`, `#protocol/*` and `#project/*`.
- **Lockfile changes** (`package-lock.json`, and `server/package-lock.json`) go in their own PR with the `lockfile`
  label, because parallel dependency edits are the commonest conflict. Pin an exact version as package.json does
  (`npm install <package>@<version>`). Never merge a lockfile conflict by hand: take main's file
  (`git checkout origin/main -- package-lock.json`), run `npm install` again and commit the result. After a lockfile
  PR merges, everyone runs `npm ci` in their worktrees.

## 6. Checks before a PR is marked ready

There is no hosted CI. GitHub Actions is not used for checks (no paid CI), so checks run on your machine and the PR
body is the record. iynk kept Actions off on purpose and ran its checks locally; this repo does the same.

- The two workflows inherited from iynk were removed on 2026-11-14 (PR #5): `ci.yml` ran the full gate on every push
  and PR, `perf-editor.yml` ran the editor budgets nightly. Every run here ended in `startup_failure` before a job was
  created. The same `ci.yml` did create jobs in iynk, which points at the account rather than the file, so no edit to
  the file was likely to fix it. Run as written, `ci.yml` would spend up to 90 runner minutes on every push, and on a
  private repo those minutes count against the account's Actions allowance.
- `action.yml` at the root stays. It is not CI: it is the "iynk check" Action other repos call to check project files
  ([CLI.md](CLI.md)), and `src/cli/cli.test.ts` tests it.
- Do not add a workflow without asking zero-abd first.

**Every PR** runs this fast set (about half a minute on the owner's machine on 2026-11-14):

```bash
NODE_OPTIONS=--max-old-space-size=4096 bash scripts/ci-local.sh --only content,typecheck,lint,ui,no-only,copy
npx vitest run <folders you touched> < /dev/null
node scripts/secret-scan.mjs --diff origin/main..HEAD
```

- `ci-local.sh --only` runs the same steps as the full gate and prints a summary table: `content:check`, `npm run
  typecheck` (content, `next typegen`, `tsc`, the portable `tsc`), `npm run lint`, the UI rules
  (`node scripts/ui-check.mjs`), the no `.only(` check and the copy rules (`node scripts/copy-check.mjs`). The UI and
  copy steps are the ones that matter when UI or copy changed, and they are cheap enough to run every time.
- `copy-check` also scans README.md, CONTRIBUTING.md, SECURITY.md and every `docs/*.md` file, and fails on a relative
  link to a file git does not track.
- Strings changed: also `npx vitest run src/i18n < /dev/null` (the six languages must keep the same keys).
- Lab content changed: run `npm run content` and commit `src/content/index.generated.ts`.
- A UI flow changed: also run its Playwright spec, `npx playwright test e2e/<spec>.spec.ts`. It builds and serves its
  own copy in `.next-e2e`; `E2E_SKIP_BUILD=1` serves the build already there.

Traps (from [HANDOFF.md](../HANDOFF.md) section 5, plus what the scripts do):

- Close stdin for Vitest (`< /dev/null`), or it can hang.
- `npx vitest run` skips `pretest`, which `npm test` runs (`npm run content`, `npm run engines:build`,
  `npm run physics:build`). Run those first if a test needs generated content or the engine files.
- `tsconfig.json`: `next typegen` and `next build` add your build folder to it when that folder is not `.next`,
  `.next-ci`, `.next-e2e` or `.next-wt`. Restore it with `git checkout tsconfig.json` before you commit, unless you
  meant to change it.
- The type check needs about 2.4 GB of heap; hence `NODE_OPTIONS=--max-old-space-size=4096`.
- One-off Playwright scripts go in `scripts/.tmp-*.mjs` and are deleted before you commit.
- Locale files are rewritten with Python `json.dumps(d, ensure_ascii=False, indent=2) + "\n"`, so diffs stay small.
- UI rules R4, R7, R8 and R17, class conflicts in `cx()`, dynamic routes and the Settings button on workspace pages
  are explained in HANDOFF.md section 5 and [UI.md](UI.md).

**The full gate** is required when a PR touches a shared core (`src/core`, `src/protocol`, `src/project`, `src/sim`,
`src/sim-host`, `src/parts`) or a contract file, config (`next.config.ts`, `src/lib/csp.ts`, `tsconfig*.json`,
`eslint.config.mjs`, `vitest*.mts`, `playwright.config.ts`, `scripts/`), dependencies (`package.json` or either
lockfile) or `server/`:

```bash
NODE_OPTIONS=--max-old-space-size=4096 bash scripts/ci-local.sh
```

Every row of its summary must say `passed`. It runs content, schema, typecheck, lint, ui, no-only, copy, provenance,
unit, perf, server, build, e2e (Chromium, WebKit and Firefox), secrets and audit, and stops at the first failure.
`bash scripts/ci-local.sh --list` prints the steps; `CI_SKIP_AUDIT=1` skips the audit when you are offline. It takes
much longer than the fast set, so run it when the machine is quiet.

The PR description pastes the commands you ran and their results: the summary table, and the last lines of every
other command.

## 7. Headset testing

- The target is a Meta Quest 3S, with both controllers and hand tracking.
- WebXR needs a secure context. `http://localhost` is one; a LAN address over plain http is not. So the headset either
  opens localhost forwarded over USB to your dev port, or an HTTPS address. `next dev --experimental-https` serves a
  self signed certificate; whether the Quest browser accepts it has not been tried.
- The USB setup with the Meta Horizon CLI and the recipe for a desktop emulator will be in `docs/XR_ARCHITECTURE.md`
  when the foundation lands.
- Today every page sends a Permissions-Policy that refuses `xr-spatial-tracking` and `microphone` (`next.config.ts`,
  asserted by `e2e/headers.spec.ts`), so an immersive session cannot start until the foundation changes it.
- Until headset testing is set up, a PR that could not be tried in a headset or an emulator says so in the template
  and carries the label: `gh pr edit <pr> --add-label needs-headset-test`.

## 8. Commits and PRs

- Commit under your own git identity (`git config user.name` and `user.email`). The commit command in HANDOFF.md
  belongs to iynk.
- Agent co-author trailers (`Co-Authored-By: ...`) are fine here, unlike in iynk.
- Messages are one plain line in the imperative, for example `Snap wires to the nearest pin`.
- The PR title says what changed. The body follows `.github/pull_request_template.md`: what, why, how it was checked
  (commands and results), what was not checked, whether a contract or the lockfile changed, and whether it was tried
  in a headset or an emulator.
- A PR stays a draft until the checks pass; then `gh pr ready <pr>`.

## 9. Rules that hold everywhere

- The repo is private. Only zero-abd decides otherwise.
- Nothing is ever pushed to the iynk repository. The code was copied from iynk on 2026-11-14 with no shared history,
  and this project has no remote for iynk. A fix from iynk comes over by hand as an ordinary PR: open an issue that
  names the iynk change, apply it here, and check it like any other change.
- Secrets: never print, log, commit or quote a key, a token or a `.env.local` value; say only whether a name is set.
  Tests that need one use the fixed strings the existing tests use.
- User facing strings ship in all six languages in the same PR, with the same keys and placeholders. How is in
  [CONTRIBUTING.md](../CONTRIBUTING.md).
- No licence is chosen ([LICENSE-PENDING.md](../LICENSE-PENDING.md)), so copy says "free", never "open source".
- Ask zero-abd before creating cloud resources, spending money, adding a large dependency or changing repo settings.
- `public/figures` is build output. Change the source in `figures/` and rebuild.

## 10. When two fleets collide

- Before you edit a file another open PR also touches, look at the open PRs: `gh pr list --state open`, then
  `gh pr diff <pr> --name-only`.
- If two PRs need the same file, the PR whose issue was assigned first wins the file. The other waits for it to merge,
  then rebases onto `origin/main`.
- A disagreement about a contract goes to an issue, tagged for zero-abd (assign or mention them), not into competing
  PRs. Nobody reverts another fleet's work without its owner agreeing.
