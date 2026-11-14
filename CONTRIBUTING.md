# Contributing to iynkware

iynkware is a private repository. Four people work in it at once, each with a fleet of coding agents, so the process
is written down and everyone keeps it. Read these first:

- [AGENTS.md](AGENTS.md): the entry point, the hard rules and the loop from issue to merged PR.
- [docs/COLLABORATION.md](docs/COLLABORATION.md): access and setup (with the clone address), claiming an issue,
  branches and worktrees, ports, the checks every PR runs, commits and PRs.
- [docs/STATE.md](docs/STATE.md): what exists today and what does not.

This page keeps the how-tos for the 2D app inherited from iynk: the test commands, adding a string in six languages,
and adding a board, a lesson or a part. The headset app's own guides will be in `docs/XR_ARCHITECTURE.md`,
`docs/XR_ASSETS.md` and `docs/XR_DEPLOY.md`.

## Docs

- [docs/FIGURES.md](docs/FIGURES.md): how the 3D figures are written, built and shot
- [docs/FIGURES-BENCH.md](docs/FIGURES-BENCH.md): the data format for boards, parts, modules and robotics benches
- [docs/FIGURES-DRONE.md](docs/FIGURES-DRONE.md): the data format for drones
- [docs/PROJECT_CORE.md](docs/PROJECT_CORE.md): the shared project code, its import rules and commands
- [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md): running your own copy
- [docs/DATA_HANDLING.md](docs/DATA_HANDLING.md): what is stored, where, and what leaves your machine
- [docs/SERVER_AND_KEYS.md](docs/SERVER_AND_KEYS.md): `/config.json`, where keys live, the caps and the usage route
- [docs/LOW_END_TESTING.md](docs/LOW_END_TESTING.md): testing on slow devices
- [docs/PROVENANCE.md](docs/PROVENANCE.md): where the content came from

## Run the checks

The set every PR runs, and when the full gate is required instead, are in section 6 of
[docs/COLLABORATION.md](docs/COLLABORATION.md). The single commands behind them:

```bash
npm run content:check        # every board, robotics and drone item loads and its text keys exist
npm run typecheck
npm run lint
npm test                     # unit tests (vitest)
npm run test:perf            # timing budgets, one file at a time
npm run check                # all of the above plus the Playwright specs
bash scripts/ci-local.sh     # the local gate, step by step; --list shows the steps, --only a,b picks some
```

A test that asserts a wall-clock budget under one second lives in a `*.perf.test.ts` file next to the code it
measures. `npm test` skips those files, because a budget measured while every core runs other tests says nothing about
the code; `npm run test:perf` runs them one file at a time. The Playwright save budget (`e2e/save-perf.spec.ts`) works
the same way: it has its own `perf` project that waits for all the others.

Write the budget in a perf test with `budgetMs()` from `src/core/perf.testing.ts`, set to what it should be on the
reference machine (iynk's: a quiet 14-CPU arm64 Mac). On another machine `budgetMs()` scales it by a calibration run
and adds a 2x margin, so there a budget catches a gross regression, not a small one. Never raise a budget to make a run
pass: a timing test that fails on a quiet machine is a real failure.

`scripts/ci-local.sh` blanks the variables that switch a real service on. If you run Playwright or `next build` by
hand, do the same:

```bash
env META_API_KEY= GEMINI_API_KEY= SERPAPI_KEY= NEXT_PUBLIC_REALTIME_URL= IYNK_SERVER_TOKEN= IYNK_AI_ENABLE= IYNK_SEARCH_ENABLE= npm run build
```

## Add or change a string

The app speaks six languages: `en de es fr hi zh`. UI strings live in `src/i18n/messages/<lang>/<namespace>.json`. The
English file defines the keys. Add the key to the English file, then add the same key, with the same `{placeholders}`,
to the other five. Change copy in all six files in one commit.

```bash
npx vitest run src/i18n < /dev/null
```

The parity test fails if a language misses a key or drops a placeholder. Lesson and part prose is separate: it lives in
`src/i18n/content/<lang>/<lab>/<id>.json`, one file per item and language.

## Add a board, lesson or part

1. Write the item data in `src/content/boards/<id>.ts` (or `robotics/`, `drones/`). Copy a neighbour, for example
   `uno-r3.ts`. Lesson text is written as keys; the words go in the content files above.
2. Run `npm run content`. `scripts/gen-content-index.mjs` rescans the folders and rewrites
   `src/content/index.generated.ts`. Commit that file with your change.
3. Write the figure in `figures/<kind>/<id>.js`. The formats are in `docs/FIGURES.md`, `docs/FIGURES-BENCH.md` and
   `docs/FIGURES-DRONE.md`. Build it with `python3 -I figures/tools/cfbuild.py boards/<id>`.
4. Add a fact sheet at `docs/facts/<id>.md` with the sources for every number you used.
5. Run `npm run content:check` and `npm test`.

Want a part that is not there? Open an issue with the "Request a part" template.

## Rules

- Do not edit `public/figures` by hand. Those pages are build output from `figures/`; change the source and rebuild.
- Do not put a key, a token or a `.env.local` value in a pull request, an issue or a test. Tests that need one use
  the fixed strings the existing tests use.
- The rest (one change per PR, commit messages, what a PR description holds) is in docs/COLLABORATION.md.

## Conduct and security

Please read the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, follow [SECURITY.md](SECURITY.md)
and do not open an issue: every collaborator can read those.
