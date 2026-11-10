#!/usr/bin/env node
// agent-floor CLI
//
//   agent-floor [start] [--port 4317] [--open]   run the floor
//   agent-floor hook <claude|codex|cursor>      used by agent hooks (reads stdin / argv)
//   agent-floor emit --agent id --status working --activity "..."  [--team x] [--to id --text "..."]
//   agent-floor setup <claude|codex|cursor> [--write] [--project]
//   agent-floor demo                             push a scripted demo into a running floor
//   agent-floor quiet [hours] | stop             pause auto-open | stop the floor
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const SELF = resolve(here, 'agent-floor.mjs');
const PORT = Number(process.env.AGENT_FLOOR_PORT) || 4317;
const URL_BASE = (process.env.AGENT_FLOOR_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(URL_BASE);
const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [, , cmd = 'app', ...rest] = process.argv;

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

async function post(events, path = '/events') {
  if (!events || !Object.keys(events).length) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1200);
  try {
    await fetch(`${URL_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(events),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- auto-launch

async function healthy() {
  try {
    const res = await fetch(`${URL_BASE}/health`, { signal: AbortSignal.timeout(400) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Send events (or a raw payload to `path`); if the floor is not running, open
 * it and resend. Guarded so it never spams windows: one launcher at a time
 * (lock file), `agent-floor quiet`, and AGENT_FLOOR_AUTOLAUNCH=0 to turn it off.
 */
async function postOrLaunch(events, path) {
  if (!events || !Object.keys(events).length) return;
  try {
    await post(events, path);
    return;
  } catch {
    /* not running (or slow); fall through */
  }
  if (!IS_LOCAL || process.env.AGENT_FLOOR_AUTOLAUNCH === '0') return;
  const { isSnoozed, takeLaunchLock } = require('./state.cjs');
  if (isSnoozed()) return;
  if (takeLaunchLock()) await openApp();
  // Wait for the floor (ours or one another hook is starting), then resend.
  for (let i = 0; i < 35; i++) {
    await sleep(100);
    if (await healthy()) {
      await post(events, path).catch(() => {});
      return;
    }
  }
}

function findChromium() {
  if (process.platform === 'darwin') {
    for (const app of ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium', 'Arc'])
      if (existsSync(`/Applications/${app}.app`)) return { mac: app };
    return null;
  }
  const names = process.platform === 'win32' ? ['chrome', 'msedge'] : ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'];
  for (const n of names) {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [n], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return { bin: r.stdout.trim().split(/\r?\n/)[0] };
  }
  return null;
}

/**
 * Open the floor in a Chromium "app window" (no tabs, no address bar), falling
 * back to the default browser. Starts the server in the background first.
 */
async function openApp({ browser = false } = {}) {
  const detached = { detached: true, stdio: 'ignore' };
  if (!(await healthy())) {
    spawn(process.execPath, [SELF, 'start'], detached).unref();
    for (let i = 0; i < 30 && !(await healthy()); i++) await sleep(100);
  }
  const url = `http://127.0.0.1:${PORT}/?app=1`;
  const chromium = browser ? null : findChromium();
  if (chromium?.mac) spawn('open', ['-na', chromium.mac, '--args', `--app=${url}`, '--new-window'], detached).unref();
  else if (chromium?.bin) spawn(chromium.bin, [`--app=${url}`], detached).unref();
  else {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(opener, args, detached).unref();
  }
  return chromium ? 'app-window' : 'browser';
}

async function app(args) {
  const f = flags(args);
  require('./state.cjs').unsnooze(); // opened by hand: hooks may reopen it again (undoes stop / quiet)
  const how = await openApp({ browser: Boolean(f.browser) });
  console.log(
    how === 'app-window'
      ? 'Agent Floor is opening in an app window. Closing it leaves the floor running; `agent-floor stop` stops it.'
      : `Agent Floor is running at http://127.0.0.1:${PORT}`,
  );
}

// ---------------------------------------------------------------- hook
// A hook must never slow down or break the agent. Every failure is swallowed
// and the process always exits 0.

/** Long strings (a Write's content) only cost bytes: the floor shows a line of them. */
function clip(v) {
  if (typeof v === 'string') return v.length > 2000 ? v.slice(0, 2000) : v;
  if (Array.isArray(v)) return v.map(clip);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clip(x)]));
  return v;
}

async function hook(kind) {
  let response = '';
  try {
    if (kind === 'claude') {
      // Fallback for claudeHookCommand's curl: the server translates the raw payload.
      await postOrLaunch(clip(parseJson(await readStdin())), '/hooks/claude');
    } else if (kind === 'codex') {
      const { fromCodex } = await import('../adapters/codex.mjs');
      // notify passes JSON as the last argv entry; hooks pass it on stdin.
      const arg = rest.slice(1).find((x) => x.trim().startsWith('{'));
      const input = parseJson(arg) || parseJson(await readStdin());
      await postOrLaunch(fromCodex(input));
    } else if (kind === 'cursor') {
      const { fromCursor, cursorResponse } = await import('../adapters/cursor.mjs');
      const input = parseJson(await readStdin());
      response = cursorResponse(input?.hook_event_name);
      await postOrLaunch(fromCursor(input));
    }
  } catch {
    // Floor not running, or bad payload. Stay silent.
  }
  if (response) process.stdout.write(response);
  process.exit(0);
}

// ---------------------------------------------------------------- emit
async function emit(args) {
  const f = flags(args);
  if (!f.agent) {
    console.error('Usage: agent-floor emit --agent <id> [--type status] [--status working] [--activity "..."] [--team name] [--role role] [--to id --text "..."]');
    process.exit(1);
  }
  const ev = {
    type: f.type || (f.to ? 'message' : f.tool ? 'tool' : f.task ? 'task' : 'status'),
    agent: f.agent,
    team: f.team,
    name: f.name,
    role: f.role,
    source: f.source || 'cli',
    parent: f.parent,
    status: f.status,
    activity: f.activity,
    tool: f.tool,
    task: f.task,
    to: f.to ? String(f.to).split(',') : undefined,
    text: f.text,
  };
  try {
    await post([ev]);
  } catch (err) {
    console.error(`Could not reach ${URL_BASE}. Is the floor running? (${err.message})`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- setup
// Hooks always run this checkout by absolute path. An npx cache is thrown away, so setup refuses it.
const viaNpx = /[\\/]_npx[\\/]/.test(SELF);
const hookCmd = (kind) => `node "${SELF}" hook ${kind}`;

/**
 * The Claude Code hook: curl the raw payload to the floor (a few ms). Only if
 * that fails, hand it to the Node fallback in the background, which can launch
 * the floor. Prints nothing and always exits 0, so Claude never waits on it.
 * shortcut: `self` goes inside double quotes unescaped, so a checkout path with `"`, `$` or a backtick breaks it; escape it if that ever happens.
 */
export function claudeHookCommand(port, self) {
  return `p=$(cat); printf '%s' "$p" | curl -sf -m 1 -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${port}/hooks/claude >/dev/null 2>&1 || { printf '%s' "$p" | nohup node "${self}" hook claude >/dev/null 2>&1 & }; exit 0`;
}

export function claudeHooks() {
  const command = claudeHookCommand(PORT, SELF);
  const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop', 'PreCompact', 'SessionEnd'];
  const hooks = {};
  for (const e of events) {
    const entry = { hooks: [{ type: 'command', command, timeout: 5 }] };
    if (e === 'PreToolUse' || e === 'PostToolUse') entry.matcher = '*';
    hooks[e] = [entry];
  }
  return hooks;
}

function cursorHooks() {
  const command = hookCmd('cursor');
  const names = ['beforeSubmitPrompt', 'afterAgentThought', 'afterAgentResponse', 'afterFileEdit', 'afterShellExecution', 'afterMCPExecution', 'stop'];
  return { version: 1, hooks: Object.fromEntries(names.map((n) => [n, [{ command }]])) };
}

async function readJsonFile(path) {
  if (!existsSync(path)) return {};
  const parsed = parseJson(await readFile(path, 'utf8'));
  if (!parsed) throw new Error(`${path} is not valid JSON. Fix it or merge the snippet by hand.`);
  return parsed;
}

async function backupAndWrite(path, data) {
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const dated = `${path}.before-agent-floor-${new Date().toLocaleDateString('en-CA')}`; // YYYY-MM-DD, local
    let backup = dated;
    for (let n = 2; existsSync(backup); n++) backup = `${dated}-${n}`;
    await copyFile(path, backup);
    await copyFile(path, `${path}.bak`);
  }
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}

function isOurs(entry) {
  return JSON.stringify(entry).includes('agent-floor');
}

async function setup(args) {
  const f = flags(args);
  const kind = f._[0];
  if (viaNpx) {
    console.error('Agent Floor cannot be set up from npx: its cache is temporary. Clone the repo and run node bin/agent-floor.mjs setup from there.');
    process.exit(1);
  }
  if (kind === 'claude') {
    const hooks = claudeHooks();
    const path = f.project ? resolve('.claude/settings.json') : join(homedir(), '.claude', 'settings.json');
    if (!f.write) {
      console.log(`Add this to ${path} (or rerun with --write to merge it for you):\n`);
      console.log(JSON.stringify({ hooks }, null, 2));
      return;
    }
    const settings = await readJsonFile(path);
    settings.hooks ||= {};
    for (const [event, entries] of Object.entries(hooks)) {
      const kept = (settings.hooks[event] || []).filter((e) => !isOurs(e));
      settings.hooks[event] = [...kept, ...entries];
    }
    await backupAndWrite(path, settings);
    console.log(`Merged Agent Floor hooks into ${path} (backup next to it as .before-agent-floor-<date> and .bak). Agent Floor will open by itself the next time a Claude Code session starts.`);
  } else if (kind === 'cursor') {
    const config = cursorHooks();
    const path = f.project ? resolve('.cursor/hooks.json') : join(homedir(), '.cursor', 'hooks.json');
    if (!f.write) {
      console.log(`Add this to ${path} (or rerun with --write to merge it for you):\n`);
      console.log(JSON.stringify(config, null, 2));
      return;
    }
    const current = await readJsonFile(path);
    current.version ||= 1;
    current.hooks ||= {};
    for (const [event, entries] of Object.entries(config.hooks)) {
      const kept = (current.hooks[event] || []).filter((e) => !isOurs(e));
      current.hooks[event] = [...kept, ...entries];
    }
    await backupAndWrite(path, current);
    console.log(`Merged Agent Floor hooks into ${path} (backup next to it as .before-agent-floor-<date> and .bak). Agent Floor will open by itself the next time a Cursor agent runs.`);
  } else if (kind === 'codex') {
    const path = join(homedir(), '.codex', 'config.toml');
    console.log(`Add this line near the top of ${path}:\n`);
    console.log(`notify = ["node", "${SELF}", "hook", "codex"]\n`);
    console.log('Codex allows one notify program. If you already have one, chain them in a small script.');
  } else {
    console.log('Usage: agent-floor setup <claude|codex|cursor> [--write] [--project]');
    process.exit(1);
  }
}

// ---------------------------------------------------------------- start
async function start(args) {
  const f = flags(args);
  const { startServer } = await import('../server/index.mjs');
  const port = Number(f.port) || undefined;
  const host = f.host || undefined;
  try {
    const floor = await startServer({
      port,
      host,
      // POST /shutdown (agent-floor stop). The timer covers a connection that will not close.
      onShutdown: () => {
        setTimeout(() => process.exit(0), 1000).unref();
        floor.close().finally(() => process.exit(0));
      },
    });
    if (f.open) await openApp({ browser: Boolean(f.browser) });
    console.log('Connect an agent:  agent-floor setup claude | codex | cursor');
    console.log('Press Ctrl+C to stop.');
  } catch (err) {
    console.error(err.code === 'EADDRINUSE' ? `Port ${port || 4317} is already in use. Try --port 4318.` : err.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- quiet / stop
async function quiet(args) {
  const hours = Number(flags(args)._[0]) || 6;
  require('./state.cjs').snooze(hours);
  console.log(`Hooks will not open Agent Floor for ${hours} hour${hours === 1 ? '' : 's'}. Run agent-floor to open it yourself.`);
}

async function stop() {
  const res = await fetch(`${URL_BASE}/shutdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(2000),
  }).catch(() => null);
  // Otherwise the next hook (even the one for this very command) relaunches it.
  require('./state.cjs').snooze(6);
  console.log(res?.ok ? `Stopped the floor at ${URL_BASE}.` : `No floor was running at ${URL_BASE}.`);
  console.log('Hooks will not reopen it for 6 hours. Run agent-floor to open it again.');
}

// ---------------------------------------------------------------- demo
async function demo(args) {
  const f = flags(args);
  const { createScript } = await import('../shared/demo-script.js');
  const script = createScript(Date.now(), { agents: Number(f.agents) || 0 });
  console.log(`Streaming a demo into ${URL_BASE}. Ctrl+C to stop.`);
  let failures = 0;
  for (;;) {
    const step = script.next();
    try {
      await post(step.events);
      failures = 0;
    } catch {
      // A slow moment is fine; give up only if the floor is really gone.
      if (++failures >= 5) {
        console.error(`Could not reach ${URL_BASE}. Start the floor first: agent-floor start`);
        process.exit(1);
      }
    }
    await new Promise((r) => setTimeout(r, step.wait));
  }
}

const commands = { app, start, hook: () => hook(rest[0]), emit, setup, demo, quiet, stop };
// Run only as the CLI, so tests can import the exports. realpath: npm links bin files.
const isMain = (() => {
  try {
    return realpathSync(process.argv[1]) === SELF;
  } catch {
    return false;
  }
})();
if (!isMain) {
  // Imported by a test: export only.
} else if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
  console.log(`agent-floor: a live 3D office for your coding agents

  agent-floor                              open the floor in an app window (starts it too)
  agent-floor start [--port 4317] [--open] run the floor without a window
  agent-floor stop                         stop the floor
  agent-floor quiet [hours]                hooks don't open the floor for a while (default 6)
  agent-floor setup <claude|codex|cursor> [--write] [--project]
  agent-floor emit --agent <id> --status working --activity "Writing tests" [--team checkout]
  agent-floor demo [--agents 60]          (stress test with many agents)
  agent-floor hook <claude|codex|cursor>    (called by agent hooks)

Environment: AGENT_FLOOR_URL, AGENT_FLOOR_PORT, AGENT_FLOOR_TEAM, AGENT_FLOOR_NAME,\n             AGENT_FLOOR_AUTOLAUNCH=0 (hooks never open the app)`);
} else if (commands[cmd]) {
  await commands[cmd](rest);
} else if (cmd.startsWith('--')) {
  await start([cmd, ...rest]);
} else {
  console.error(`Unknown command "${cmd}". Try agent-floor --help`);
  process.exit(1);
}
