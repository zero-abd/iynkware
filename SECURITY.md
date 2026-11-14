# Security

## Reporting a problem

iynkware is a private repository, and GitHub's private vulnerability reporting is not available on it. Report a
vulnerability to zero-abd privately, not in an issue or a pull request: every collaborator can read those.

Include what you found, the steps to reproduce it, and which commit you tested. Do not include anyone else's data or a
working key.

## What is in scope

- The code in this repository: the 2D app and the server inherited from iynk, and the headset app in `xr/` as it
  lands.
- Handling of the keys a person pastes into Settings: a way to read them back, log them, send them to a third party,
  or store them where they should not be kept.
- The server token check and the rules that decide who may call the AI and search routes.
- Anything that lets a page run script it should not, such as a gap in the content security policy or in how figure
  pages are loaded.
- Prompt injection that makes the AI route leak data or take an action the person did not ask for.

## What is not in scope

- Findings that need a modified browser, or access to the machine running the app.
- Missing hardening headers with no demonstrated effect.
- Problems in a third-party package with no way to reach it from this code. Report those upstream.
- Any hosted copy run by someone else. Tell its operator.

If the problem is in code inherited from iynk, say so in the report: iynk may have it too.

## What to expect

A maintainer reads each report, replies to say whether it is accepted, and says when a fix lands. No response time is
promised.

How the 2D app handles data is described in [docs/DATA_HANDLING.md](docs/DATA_HANDLING.md).
