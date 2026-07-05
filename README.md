# why-no-tools 🔍

**Your MCP server shows "Connected" — but no tools appear in Claude Code. This tool tells you why.**

## The problem

MCP servers can fail *silently*: the config says everything is fine, and yet
zero tools show up in your session. One documented cause: the first `npx` run
downloads the package from scratch, and if that takes longer than Claude Code's
30s MCP startup limit, the connection dies without any visible error
(see ruvnet/ruflo#1748).

## Real measurement

Run on a MacBook Pro (Apple Silicon, fast connection):
A 50-second cold install on a *fast* machine — any first-time user of a large
MCP package hits the silent failure.

## Usage
Reads MCP servers from `~/.claude.json` and `./.mcp.json`, then times each
npx-based server twice: with your normal cache (warm) and with a throwaway
empty cache (cold — simulates a first-time install without touching your real
cache). Verdict per server, with the exact fix when it would fail.

- Read-only: never modifies your configs or your real npm cache
- Zero dependencies, single file, Node 18+
- Exit code 0 = all safe, 1 = something would fail (CI-friendly)

## Roadmap

- npm publication (`npx why-no-tools`)
- 64KB tools/list truncation check (ruvnet/ruflo#2426)
- Config JSON validation with exact error location
