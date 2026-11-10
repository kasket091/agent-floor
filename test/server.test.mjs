import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.mjs';

test('server accepts events and serves state', async () => {
  const floor = await startServer({ port: 0, log: () => {}, claudeConfig: join(os.tmpdir(), 'af-no-such-config.json') });
  const { port } = floor.server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${base}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'join', agent: 'a', team: 'T' }, { type: 'bogus' }]),
    });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { accepted: 1, rejected: 1 });
    const state = await (await fetch(`${base}/state`)).json();
    assert.ok(state.agents.a);

    const bad = await fetch(`${base}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 400);

    const simple = await fetch(`${base}/events`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"type":"join","agent":"x"}' });
    assert.equal(simple.status, 415, 'non-JSON posts are refused');
  } finally {
    await floor.close();
  }
});

const SITE_HOST = 'penrithplastering.com.au';
const ROOM = 'penrithplastering-com-au';
const siteConfig = {
  mcpServers: {
    'penrith-plastering-and-gyprock-elementor': {
      type: 'http',
      url: `https://www.${SITE_HOST}/wp-json/elementor/mcp/`,
      headers: { Authorization: 'Bearer fake-test-token' },
    },
  },
};

async function siteFloor(extra = {}) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'af-server-'));
  const claudeConfig = join(dir, 'claude.json');
  fs.writeFileSync(claudeConfig, JSON.stringify(siteConfig));
  const floor = await startServer({ port: 0, log: () => {}, claudeConfig, sitesPollMs: 50, ...extra });
  const base = `http://127.0.0.1:${floor.server.address().port}`;
  const post = (path, body) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const getState = async () => (await fetch(`${base}/state`)).json();
  return { floor, base, post, getState, claudeConfig };
}

async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('site rooms, Claude hooks, body limit and redaction', async () => {
  const { floor, post, getState, claudeConfig } = await siteFloor();
  try {
    let state = await getState();
    assert.equal(state.teams[ROOM]?.pinned, true);
    assert.ok(!JSON.stringify(state).includes('fake-test-token'));

    const hook = await post('/hooks/claude', { session_id: 's1', hook_event_name: 'SessionStart', cwd: '/x/proj' });
    assert.equal(hook.status, 202);
    assert.deepEqual(await hook.json(), { accepted: 1 });
    state = await getState();
    assert.equal(state.agents['claude-code:s1'].team, 'lobby');

    const site = await post('/hooks/claude', {
      session_id: 's1',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: `curl -H "Authorization: Bearer secret123" https://${SITE_HOST}/` },
    });
    assert.equal(site.status, 202);
    state = await getState();
    assert.equal(state.agents['claude-code:s1'].team, ROOM);
    assert.ok(!JSON.stringify(state).includes('secret123'));

    const odd = await post('/hooks/claude', { hello: 'world' });
    assert.equal(odd.status, 202);
    assert.deepEqual(await odd.json(), { accepted: 0 });

    const big = await post('/hooks/claude', JSON.stringify({ session_id: 's1', hook_event_name: 'Stop', pad: 'x'.repeat(5 * 1024 * 1024) }));
    assert.equal(big.status, 413);

    await post('/events', { type: 'status', agent: 'a', activity: 'password=x', text: 'token=y', task: 'secret=z', name: 'pwd=w' });
    const text = JSON.stringify(await getState());
    for (const s of ['password=x', 'token=y', 'secret=z', 'pwd=w']) assert.ok(!text.includes(s), s);

    fs.writeFileSync(claudeConfig, JSON.stringify({ mcpServers: {} }));
    await until(async () => (await getState()).teams[ROOM]?.pinned === false);
  } finally {
    await floor.close();
  }
});

test('reset brings the pinned site rooms back', async () => {
  const { floor, post, getState } = await siteFloor();
  try {
    await until(async () => (await getState()).teams[ROOM]?.pinned);
    assert.equal((await post('/reset', {})).status, 200);
    assert.equal((await getState()).teams[ROOM]?.pinned, true);
    await post('/events', { type: 'reset' });
    assert.equal((await getState()).teams[ROOM]?.pinned, true);
  } finally {
    await floor.close();
  }
});

test('browsers hear about a room swept away with no agents in it', async () => {
  const { floor, base, getState, claudeConfig } = await siteFloor();
  const ctrl = new AbortController();
  try {
    await until(async () => (await getState()).teams[ROOM]?.pinned);
    const res = await fetch(`${base}/stream`, { signal: ctrl.signal });
    const reader = res.body.getReader();
    let seen = '';
    const removed = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return false;
        seen += new TextDecoder().decode(value);
        if (seen.includes('event: removed')) return true;
      }
    })().catch(() => false);
    fs.writeFileSync(claudeConfig, JSON.stringify({ mcpServers: {} }));
    const timeout = new Promise((r) => setTimeout(() => r('timed out'), 6000));
    assert.equal(await Promise.race([removed, timeout]), true);
    assert.equal((await getState()).teams[ROOM], undefined);
  } finally {
    ctrl.abort();
    await floor.close();
  }
});

test('POST /shutdown answers 200 then calls onShutdown', async () => {
  let called = false;
  const { floor, post } = await siteFloor({ onShutdown: () => (called = true) });
  try {
    assert.equal((await post('/shutdown', {})).status, 200);
    assert.equal(called, true);
  } finally {
    await floor.close();
  }
});
