import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { startServer } from '../server/index.mjs';
import { shortId } from '../adapters/common.mjs';
import { claudeHookCommand, claudeHooks } from '../bin/agent-floor.mjs';

const SELF = resolve(dirname(fileURLToPath(import.meta.url)), '../bin/agent-floor.mjs');
const tmp = fs.mkdtempSync(join(os.tmpdir(), 'af-hook-'));
const noConfig = join(tmp, 'no-claude.json');
// Never touch the real ~/.claude, ~/.agent-floor or a live floor, and never open a window.
const env = { ...process.env, HOME: tmp, AGENT_FLOOR_HOME: join(tmp, 'state'), AGENT_FLOOR_AUTOLAUNCH: '0', AGENT_FLOOR_CLAUDE_CONFIG: noConfig };
delete env.AGENT_FLOOR_URL;
const FALLBACK = `${SELF} hook claude`;

after(() => {
  spawnSync('pkill', ['-f', FALLBACK]);
  spawnSync('pkill', ['-f', `${SELF} start`]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((r) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => r(port));
    });
  });

// Async, not spawnSync: the in-test floor shares this event loop and must answer while the hook runs.
function runHook(port, payload, extraEnv = {}) {
  return new Promise((done) => {
    const t0 = performance.now();
    const child = spawn('/bin/sh', ['-c', claudeHookCommand(port, SELF)], { env: { ...env, AGENT_FLOOR_PORT: String(port), ...extraEnv } });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.on('close', (status) => done({ status, stdout, ms: performance.now() - t0 }));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

async function leadAppears(base, sessionId, ms = 5000) {
  const id = `claude-code:${shortId(sessionId)}`;
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const state = await (await fetch(`${base}/state`)).json();
    if (state.agents[id]) return true;
  }
  return false;
}

const floorUp = () => startServer({ port: 0, log() {}, claudeConfig: noConfig });

test('hook command: floor up -> silent, exit 0, fast, lead on the floor', async () => {
  const floor = await floorUp();
  const port = floor.server.address().port;
  try {
    const r = await runHook(port, { session_id: 'hook-up', hook_event_name: 'SessionStart', cwd: tmp });
    console.log(`hook (floor up): ${r.ms.toFixed(1)} ms`);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.ok(r.ms < 1000, `took ${r.ms} ms`);
    assert.ok(await leadAppears(`http://127.0.0.1:${port}`, 'hook-up'));
  } finally {
    await floor.close();
  }
});

test('hook command: floor down, launch off -> silent, exit 0, fast, no leftover process', async () => {
  const port = await freePort();
  const r = await runHook(port, { session_id: 'hook-down', hook_event_name: 'SessionStart', cwd: tmp });
  console.log(`hook (floor down): ${r.ms.toFixed(1)} ms`);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(r.ms < 1000, `took ${r.ms} ms`);
  await sleep(3000);
  assert.equal(spawnSync('pgrep', ['-f', FALLBACK]).status, 1, 'the Node fallback is still running');
});

test('hook command: 5 MB payload -> silent, exit 0, under 1.5 s, clipped and still delivered', async () => {
  const floor = await floorUp();
  const port = floor.server.address().port;
  try {
    const payload = {
      session_id: 'hook-big',
      hook_event_name: 'PreToolUse',
      cwd: tmp,
      tool_name: 'Write',
      tool_input: { file_path: join(tmp, 'big.txt'), content: 'x'.repeat(5 * 1024 * 1024) },
    };
    const r = await runHook(port, payload);
    console.log(`hook (5 MB): ${r.ms.toFixed(1)} ms`);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.ok(r.ms < 1500, `took ${r.ms} ms`);
    assert.ok(await leadAppears(`http://127.0.0.1:${port}`, 'hook-big'));
  } finally {
    await floor.close();
  }
});

test('claudeHooks: no npx, every command runs this checkout by absolute path', () => {
  const hooks = claudeHooks();
  assert.ok(!JSON.stringify(hooks).includes('npx'));
  const commands = Object.values(hooks).flatMap((entries) => entries.flatMap((e) => e.hooks.map((h) => h.command)));
  assert.ok(commands.length >= 9);
  for (const c of commands) {
    assert.ok(c.includes(`"${SELF}"`), c);
    assert.ok(c.includes('/hooks/claude'), c);
  }
});

const cli = (args, extraEnv = {}, self = SELF) => spawnSync(process.execPath, [self, ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8' });

test('quiet snoozes auto-open (default 6 hours)', () => {
  const r = cli(['quiet']);
  assert.equal(r.status, 0, r.stderr);
  const until = Number(fs.readFileSync(join(tmp, 'state', 'snoozed-until'), 'utf8'));
  assert.ok(Math.abs(until - (Date.now() + 6 * 3600_000)) < 60_000);
  cli(['quiet', '1']);
  const one = Number(fs.readFileSync(join(tmp, 'state', 'snoozed-until'), 'utf8'));
  assert.ok(Math.abs(one - (Date.now() + 3600_000)) < 60_000);
});

test('stop shuts a running floor down and says whether one was running', async () => {
  const port = await freePort();
  const portEnv = { AGENT_FLOOR_PORT: String(port) };
  const child = spawn(process.execPath, [SELF, 'start', '--port', String(port)], { env: { ...env, ...portEnv }, stdio: 'ignore' });
  const exited = new Promise((r) => child.once('exit', r));
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await sleep(100);
      up = await fetch(`http://127.0.0.1:${port}/health`).then((res) => res.ok, () => false);
    }
    assert.ok(up, 'floor did not start');
    const r = cli(['stop'], portEnv);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /stopped/i);
    assert.equal(await Promise.race([exited.then(() => 'exited'), sleep(3000).then(() => 'running')]), 'exited');
    const again = cli(['stop'], portEnv);
    assert.equal(again.status, 0);
    assert.match(again.stdout, /no floor/i);
  } finally {
    child.kill();
  }
});

test('setup claude --write keeps other hooks, replaces old Agent Floor entries, dated backups', () => {
  const home = fs.mkdtempSync(join(tmp, 'home-'));
  const path = join(home, '.claude', 'settings.json');
  fs.mkdirSync(dirname(path), { recursive: true });
  const other = { hooks: [{ type: 'command', command: 'echo other' }] };
  const old = { hooks: [{ type: 'command', command: 'npx -y agent-floor hook claude' }] };
  fs.writeFileSync(path, JSON.stringify({ model: 'x', hooks: { PreToolUse: [other, old] } }));
  const original = fs.readFileSync(path, 'utf8');

  for (let i = 0; i < 2; i++) assert.equal(cli(['setup', 'claude', '--write'], { HOME: home }).status, 0);

  const settings = JSON.parse(fs.readFileSync(path, 'utf8'));
  assert.equal(settings.model, 'x');
  assert.deepEqual(settings.hooks.PreToolUse[0], other);
  assert.equal(settings.hooks.PreToolUse.length, 2);
  assert.ok(!JSON.stringify(settings).includes('npx'));
  const day = new Date().toLocaleDateString('en-CA');
  assert.equal(fs.readFileSync(`${path}.before-agent-floor-${day}`, 'utf8'), original);
  assert.ok(fs.existsSync(`${path}.before-agent-floor-${day}-2`));
  assert.ok(fs.existsSync(`${path}.bak`));
});

test('setup refuses to run from an npx cache', () => {
  const home = fs.mkdtempSync(join(tmp, 'home-'));
  const bin = join(tmp, '_npx', 'abc', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.copyFileSync(SELF, join(bin, 'agent-floor.mjs'));
  const r = cli(['setup', 'claude', '--write'], { HOME: home }, join(bin, 'agent-floor.mjs'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /npx/);
  assert.ok(!fs.existsSync(join(home, '.claude', 'settings.json')));
});

test('after stop, hooks do not relaunch the floor; agent-floor clears that and opens it', async () => {
  const port = await freePort();
  const fakeBin = fs.mkdtempSync(join(tmp, 'bin-'));
  const opened = join(fakeBin, 'opened.log');
  // A stub `open` (macOS window/browser launcher) on PATH: records calls, never opens a real browser.
  fs.writeFileSync(join(fakeBin, 'open'), `#!/bin/sh\necho "$@" >> "${opened}"\n`, { mode: 0o755 });
  const e = {
    AGENT_FLOOR_PORT: String(port),
    AGENT_FLOOR_HOME: fs.mkdtempSync(join(tmp, 'state-')),
    AGENT_FLOOR_AUTOLAUNCH: '1',
    PATH: `${fakeBin}:${process.env.PATH}`,
  };
  const health = () => fetch(`http://127.0.0.1:${port}/health`).then((res) => res.ok, () => false);
  const child = spawn(process.execPath, [SELF, 'start', '--port', String(port)], { env: { ...env, ...e }, stdio: 'ignore' });
  const exited = new Promise((r) => child.once('exit', r));
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await sleep(100);
      up = await health();
    }
    assert.ok(up, 'floor did not start');
    const r = cli(['stop'], e);
    assert.equal(r.status, 0, r.stderr);
    await exited;

    const h = await runHook(port, { session_id: 'after-stop', hook_event_name: 'PostToolUse', cwd: tmp, tool_name: 'Bash', tool_input: { command: 'agent-floor stop' } }, e);
    assert.equal(h.status, 0);
    assert.equal(h.stdout, '');
    await sleep(4500); // longer than the fallback's launch-and-wait
    assert.equal(await health(), false, 'a hook relaunched the floor after stop');
    assert.ok(!fs.existsSync(opened), 'a hook opened a window after stop');
    assert.match(r.stdout, /run agent-floor/i, 'stop says how to open it again');

    // Opening it by hand still works while snoozed, and lifts the snooze.
    const app = cli(['app', '--browser'], e);
    assert.equal(app.status, 0, app.stderr);
    assert.equal(await health(), true);
    for (let i = 0; i < 20 && !fs.existsSync(opened); i++) await sleep(100); // the launcher is spawned detached
    assert.ok(fs.existsSync(opened), 'agent-floor did not open a window');
    assert.ok(!fs.existsSync(join(e.AGENT_FLOOR_HOME, 'snoozed-until')));
  } finally {
    child.kill();
    cli(['stop'], e);
  }
});
