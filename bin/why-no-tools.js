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
  } catch (err) {
    // A missing file is normal (e.g. no ./.mcp.json in this folder). A file that
    // exists but cannot be parsed is not: one stray comma makes Claude Code
    // ignore every server in it, so say so instead of silently reporting none.
    if (err.code !== 'ENOENT') {
      console.error(`WARN  could not read ${path}: ${err.message}`);
    }
    return {};
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

  return {
    elapsedMs,
    timedOut: result.error?.code === 'ETIMEDOUT',
    // Set when npx could not even be launched (e.g. ENOENT: npx not installed).
    spawnError: result.error && result.error.code !== 'ETIMEDOUT' ? result.error.code : null,
    exitCode: result.status,
  };
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

// Progress goes to stderr, BEFORE each slow step, so the user can see the tool
// is working (a cold run of a big package can take a minute or more) while the
// final report on stdout stays clean and easy to pipe.
function progressStart(text) {
  process.stderr.write(text);
}

// Step 4/5: run the check for one server and report OK/FAIL/skipped.
// `progress` ({ done, total }) only counts npx servers that are actually timed.
function checkServer(server, progress) {
  const { name, source, config } = server;
  const label = `${name} (${source})`;

  if (config.command !== 'npx') {
    // Remote servers have no "command" (they use "type"/"url"); don't print the
    // url, since it can carry tokens.
    const what = config.command ? `command: "${config.command}"` : `type: "${config.type ?? 'unknown'}"`;
    console.log(`SKIP  ${label} — not an npx server (${what})`);
    return true;
  }

  const pkg = extractPackage(config.args || []);
  if (!pkg) {
    console.log(`SKIP  ${label} — could not determine package from args`);
    return true;
  }

  progress.done += 1;
  const tag = `[${progress.done}/${progress.total}] ${name}`;

  progressStart(`${tag} — warm run... `);
  const warm = timedNpxRun(pkg);
  progressStart(`${formatSeconds(warm.elapsedMs)}\n`);

  progressStart(`${tag} — cold run (downloads from scratch, may take a while)... `);
  const cold = timedColdRun(pkg);
  progressStart(cold.timedOut ? 'timed out\n' : `${formatSeconds(cold.elapsedMs)}\n`);

  const coldLabel = cold.timedOut ? `>${formatSeconds(RUN_TIMEOUT_MS)} (timed out)` : formatSeconds(cold.elapsedMs);
  const isFail = cold.timedOut || cold.elapsedMs > COLD_LIMIT_MS;

  // A run that errors out fast (package not found, npx missing...) would look
  // like a very quick, healthy install. Say so instead of reporting a false OK.
  // Not a FAIL: many servers exit non-zero on --version even though they installed fine.
  let unreliable = null;
  if (cold.spawnError) unreliable = `could not launch npx (${cold.spawnError})`;
  else if (!cold.timedOut && cold.exitCode !== 0) unreliable = `npx exited with code ${cold.exitCode}`;

  if (isFail) {
    console.log(`FAIL  ${label} — cold ${coldLabel}, warm ${formatSeconds(warm.elapsedMs)} (limit ${formatSeconds(COLD_LIMIT_MS)})`);
    printFix(pkg);
  } else if (unreliable) {
    console.log(`WARN  ${label} — ${unreliable}, so the timing may not be reliable`);
    if (!cold.spawnError) console.log(`  (the package may not exist, or it may not support --version)`);
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

  const progress = {
    done: 0,
    total: servers.filter((s) => s.config.command === 'npx').length,
  };
  console.error(`Found ${progress.total} npx server(s)`);

  let allSafe = true;
  for (const server of servers) {
    const ok = checkServer(server, progress);
    if (!ok) allSafe = false;
  }

  process.exit(allSafe ? 0 : 1);
}

main();
