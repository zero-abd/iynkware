# Command line and GitHub Action

`iynk` checks a project without a browser. It runs the same circuit rules the Problems panel shows, the same headless
interpreter that runs a project's checks in the Studio, and the same file readers and writers. It needs Node 24 and the
repo's own `node_modules`; it adds no dependency.

## Install

From a checkout, after `npm ci`:

```sh
node bin/iynk.mjs check path/to/project.iynk   # straight from the repo
npm install --global .                          # or put `iynk` on your PATH (a link to the checkout)
```

The app's code is TypeScript with `@/` imports, which Node does not resolve by itself. Each start bundles `src/cli/main.ts`
with esbuild (already a dev dependency) into a temporary folder and runs it from there; that takes about 0.3 s and leaves
nothing behind. Nothing under `src/cli` is imported by the app, so the Next build and the server image do not carry it.

## Commands

| Command | What it does |
| --- | --- |
| `iynk check <files or globs>` | For each project: the circuit rules, a headless run of its code for each test's duration, and the project's own checks. Prints a report, and `--json` or `--junit` write it as data. Exit code 1 when anything fails |
| `iynk run <file> --for 5s` | Runs the project's code and prints the serial output, then every pin event, in time order. `--test <id>` takes that test's input script; `--json` prints the same as data |
| `iynk export <file> --format ino` | Writes the Arduino sketch folder and its `wiring.csv` (`exportIno`), into `--out <folder>` or the current folder |
| `iynk export <file> --format bom` | The parts list as CSV: `qty,refdes,part,manufacturer,model`. Prints it, or writes `--out <file>` |

Exit codes: 0 all good, 1 a project failed, 2 the command line itself was wrong (no file matches, a bad option or duration).

`check` reads `.iynk`, `.iynkz` and project `.json` files (the starters in `src/studio/starters` are project JSON). A folder
stands for every `.iynk`, `.iynkz` and `.project.json` inside it, leaving out `node_modules` and `.git`. A glob is expanded by
iynk itself, so `**` works the same in every shell. A Wokwi `diagram.json` is read through the same
importer the Studio uses (`src/export/wokwi`), with the sketch, `main.py` and `libraries.txt` beside it; a folder with a
`diagram.json` in it counts too. What the import could not carry over is listed under the project, and the imported circuit
goes through the same rules and runs as any other project.

### Grading a submission

`iynk check --assignment teacher.iynk handed-in/*.json` grades student submission files (the `.iynk-submission.json` a student
hands in) against the teacher's assignment. A file is a submission by what it says it is, not by its name. The assignment's
checks run again on the submitted project, with the grader the Studio's Grade submissions page uses; what the student's device
claimed is only compared, never trusted. A submission fails when a check fails, when it names another assignment, when a locked
part was removed or changed, or when the file was edited after the student made it. A submission with no `--assignment` fails
with a message that says so. `--json` and `--junit` carry one entry per check.

Circuit findings that have a fix list it under the finding (`fix:`), in the language of the report, so a failing student project
says what to do; the JSON has them under `fixes` with their `safe` flag.

## What fails a project

- A file that cannot be read or is not a valid project.
- A circuit finding of severity error (`--strict`: warnings too). These are the findings of the Studio's static check
  (`rule:` ids, such as an LED with no series resistor), run through the same sim host and handler the page uses.
- A run that stops with an error or runs out of its time limit.
- A project check that did not hold. A check that needs the analog solver (`node-voltage`, `supply-current`), or a pin check on
  a Verilog board, is reported as skipped, not as passed.

A project with no tests still runs once, so a runtime error in its code fails it. A project with checks and no code fails them.

## Options

`--json`, `--junit <file>` (`-` for standard output), `--strict`, `--for <5s|500ms>`, `--test <id>`, `--format <ino|bom>`,
`--out <path>`, `--assignment <file>`, `--lang <code>`. Messages come in the six languages (`--lang`, then `IYNK_LANG`, then the shell's locale);
ids, statuses and the JSON keys never change with the language. JUnit `time` is simulated seconds, so a report is the same on
every machine.

## GitHub Action

`action.yml` at the root of this repo is a composite action: it sets up Node 24, runs `npm ci` in the action's checkout
(about a minute, because the repo is the install) and runs `iynk check`. A repo of student projects uses it like this:

```yaml
name: Check projects
on: [push, pull_request]
permissions:
  contents: read
jobs:
  iynk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: <owner>/iynk@<ref>
        with:
          files: "projects/**/*.iynk projects/**/*.iynkz"
          junit: iynk-report.xml
      - uses: actions/upload-artifact@v5
        if: always()
        with:
          name: iynk-report
          path: iynk-report.xml
```

| Input | Default | |
| --- | --- | --- |
| `files` | `.` | Files or globs separated by spaces; a folder stands for every project file in it |
| `strict` | `false` | `true` fails on warnings too |
| `junit` | empty | Where to write the JUnit XML |
| `assignment` | empty | The teacher's assignment that submission files in `files` are graded against |
| `lang` | `en` | Language of the messages |

The inputs reach the shell as environment variables, never spliced into the script, and shell globbing is off so iynk reads
the patterns as written. The step fails when `iynk check` exits with 1. `src/cli/cli.test.ts` runs the action's Check step
from `action.yml` on a passing and a failing project.

This repo's own CI does not use the action: it already runs the content tests on every starter.

## Speed

Checking all 26 starters takes about 0.6 s wall time from the command (bundling included) on the reference Mac, and the
perf test `src/cli/check.perf.test.ts` holds it under 60 s (scaled on other machines like the other perf budgets). The
interpreter runs a simulated second in a few milliseconds.

## What it does not do

- It does not run the circuit solver: a check on a node voltage or supply current is skipped, and the findings that need a
  solved run (a burnt LED, say) are not made. The Studio shows them while the circuit runs.
- It runs the code in the interpreter, as the Studio's Checks tab does. A project that runs a compiled hex image (Firmware
  mode) has no code to run here.
