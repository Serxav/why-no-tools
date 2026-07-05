# why-no-tools — v0.1 spec

One check, done well: detect MCP servers that will fail on first
run because npx cold-cache install exceeds Claude Code's 30s limit.

## Command
npx why-no-tools

## Steps
1. Read MCP servers from ~/.claude.json (mcpServers key) and ./.mcp.json if present
2. Skip non-npx servers (report as "skipped")
3. For each npx server, time two runs of `npx -y <package> --version`:
   - warm: user's normal cache
   - cold: npm_config_cache pointing to a fresh temp dir (validated by hand: npm writes _cacache/_npx there)
4. Verdict per server: OK if cold < 25s, FAIL if more (25s = safety margin under the 30s limit)
5. On FAIL, print the fix: pre-warm command or global install

## Rules
- Read-only: never touch the user's real cache or configs
- Clean up temp dirs
- Node 18+, zero dependencies if possible
- Exit code 0 = all safe, 1 = something would fail

## NOT in v0.1
64KB check · JSON validation · HTTP servers · Cursor/other clients
