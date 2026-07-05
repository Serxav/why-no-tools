# why-no-tools 🔍

**Your MCP server shows "Connected" — but no tools appear. This tool tells you why.**

## The problem

MCP servers in Claude Code can fail *silently*: the config says everything is fine,
`claude mcp list` says "Connected", and yet zero tools show up in your session.

Known causes this tool diagnoses:

- ⏱️ **Cold-cache timeout** — first `npx` run downloads the package and blows past
  Claude Code's 30s MCP startup limit (ruvnet/ruflo#1748)
- 📦 **Oversized tools/list** — response exceeds the 64KB macOS pipe buffer and gets
  truncated (ruvnet/ruflo#2426)
- 📝 **Broken config JSON** — one trailing comma silently disables *all* your servers
- 🧰 **Environment issues** — wrong Node version, missing command, unset env vars

## Status

🚧 Early development. First check (cold-cache timeout) in progress.