#!/usr/bin/env node
// why-no-tools v0.1 — detect MCP servers whose cold-cache npx install
// would exceed Claude Code's 30s startup limit.

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const COLD_LIMIT_MS = 25_000; // safety margin under Claude Code's 30s hard limit
const RUN_TIMEOUT_MS = 60_000; // kill npx if it hangs well past the limit we care about

// Step 1: read mcpServers from ~/.claude.json and ./.mcp.json (if present).
// Each entry is tagged with its source file so duplicates across the two
// configs are reported separately rather than merged.
function readMcpServers(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    const json = JSON.parse(raw);
    return json.mcpServers || {};
  } catch {
    return {}; // missing file or unreadable/invalid JSON: treat as no servers here
  }
}

function collectServers() {
  const sources = [
    join(homedir(), '.claude.json'),
    join(process.cwd(), '.mcp.json'),
  ];
  const servers = [];
  for (const source of sources) {
    const mcpServers = readMcpServers(source);
    for (const [name, config] of Object.entries(mcpServers)) {
      servers.push({ name, source, config });
    }
  }
  return servers;
}

// Step 2: pull the package spec (e.g. "@scope/pkg" or "pkg@1.2.3") out of an
// npx server's args, skipping flags like -y/--yes. Runtime args after the
// package (e.g. a filesystem path) are irrelevant to timing --version.
function extractPackage(args) {
  for (const arg of args) {
    if (!arg.startsWith('-')) return arg;
  }
  return null;
}

// Step 3: run `npx -y <package> --version` once, optionally pointing
// npm's cache at a throwaway directory to force a cold install. Read-only
// with respect to the user's real cache/config; never touches either.
function timedNpxRun(pkg, { cacheDir } = {}) {
  const env = { ...process.env };
  if (cacheDir) env.npm_config_cache = cacheDir;

  const start = Date.now();
  const result = spawnSync('npx', ['-y', pkg, '--version'], {
    env,
    timeout: RUN_TIMEOUT_MS,
    stdio: 'ignore',
  });
  const elapsedMs = Date.now() - start;

  return { elapsedMs, timedOut: result.error?.code === 'ETIMEDOUT' };
}

// Step 3 (cold half): create a fresh temp dir for npm_config_cache so the
// run can't reuse anything from the user's real cache, then clean it up.
function timedColdRun(pkg) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'why-no-tools-'));
  try {
    return timedNpxRun(pkg, { cacheDir });
  } finally {
    rmSync(cacheDir, { recursive: true, force: true }); // always clean up, even on failure
  }
}

function formatSeconds(ms) {
  return (ms / 1000).toFixed(1) + 's';
}

function printFix(pkg) {
  console.log(`  Fix: pre-warm the cache before starting Claude Code:`);
  console.log(`    npx -y ${pkg} --version`);
  console.log(`  or install it globally so npx never has to fetch it:`);
  console.log(`    npm i -g ${pkg}`);
}

// Step 4/5: run the check for one server and report OK/FAIL/skipped.
function checkServer(server) {
  const { name, source, config } = server;
  const label = `${name} (${source})`;

  if (config.command !== 'npx') {
    console.log(`SKIP  ${label} — not an npx server (command: "${config.command}")`);
    return true;
  }

  const pkg = extractPackage(config.args || []);
  if (!pkg) {
    console.log(`SKIP  ${label} — could not determine package from args`);
    return true;
  }

  const warm = timedNpxRun(pkg);
  const cold = timedColdRun(pkg);

  const coldLabel = cold.timedOut ? `>${formatSeconds(RUN_TIMEOUT_MS)} (timed out)` : formatSeconds(cold.elapsedMs);
  const isFail = cold.timedOut || cold.elapsedMs > COLD_LIMIT_MS;

  if (isFail) {
    console.log(`FAIL  ${label} — cold ${coldLabel}, warm ${formatSeconds(warm.elapsedMs)} (limit ${formatSeconds(COLD_LIMIT_MS)})`);
    printFix(pkg);
  } else {
    console.log(`OK    ${label} — cold ${coldLabel}, warm ${formatSeconds(warm.elapsedMs)}`);
  }

  return !isFail;
}

// Entry point: collect servers, check each, exit 1 if anything would fail.
function main() {
  const servers = collectServers();

  if (servers.length === 0) {
    console.log('No MCP servers found in ~/.claude.json or ./.mcp.json.');
    process.exit(0);
  }

  let allSafe = true;
  for (const server of servers) {
    const ok = checkServer(server);
    if (!ok) allSafe = false;
  }

  process.exit(allSafe ? 0 : 1);
}

main();
