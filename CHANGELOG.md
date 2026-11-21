# Changelog

## 0.1.1 — 2026-11-21

- Progress is printed to stderr while measuring, so the tool no longer looks frozen.
- `WARN` instead of a false `OK` when npx exits with an error or cannot be launched.
- A config file that exists but is not valid JSON now prints the parse error
  (with position) instead of silently reporting "no servers".
- SKIP lines for remote (HTTP) servers show their type instead of `command: "undefined"`.
- README: usage via `npx`, new Limitations section.

## 0.1.0 — 2026-07-05

- First release: cold-cache vs warm-cache timing of npx-based MCP servers
  against Claude Code's 30s startup limit.
