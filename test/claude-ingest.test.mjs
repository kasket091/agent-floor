import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeIngest, LOBBY } from '../server/claude-ingest.mjs';
import { normalizeEvent } from '../shared/protocol.js';

const SITES = [
  {
    id: 'penrithplastering.com.au',
    host: 'penrithplastering.com.au',
    name: 'Penrith Plastering And Gyprock',
    servers: ['penrith-plastering-and-gyprock-elementor'],
  },
];
const PENRITH = 'penrithplastering-com-au';
const LEAD = 'claude-code:s1';

function setup(agents = {}) {
  return createClaudeIngest({ getSites: () => SITES, getState: () => ({ agents }) });
}
const p = (hook, extra = {}) => ({ session_id: 's1', hook_event_name: hook, cwd: '/x/proj', ...extra });
const teams = (events) => events.map((e) => normalizeEvent(e).team);

test('SessionStart joins the lead in the Lobby', () => {
  const events = setup()(p('SessionStart'));
  assert.equal(events.length, 1);
  const ev = normalizeEvent(events[0]);
  assert.equal(ev.type, 'join');
  assert.equal(ev.agent, LEAD);
  assert.equal(ev.team, 'lobby');
  assert.equal(ev.teamName, 'Lobby');
  assert.deepEqual(LOBBY, { id: 'lobby', name: 'Lobby' });
});

test('a site MCP tool moves the session; later tools stay in that room', () => {
  const ingest = setup();
  const first = ingest(p('PreToolUse', { tool_name: 'mcp__penrith-plastering-and-gyprock-elementor__x', tool_input: {} }));
  assert.ok(first.length);
  assert.deepEqual(new Set(teams(first)), new Set([PENRITH]));
  assert.equal(normalizeEvent(first.at(-1)).teamName, 'Penrith Plastering And Gyprock');
  const later = ingest(p('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/a/b.txt' } }));
  assert.deepEqual(teams(later), [PENRITH]);
});

test('a helper touching a site moves the whole session', () => {
  const agents = {
    [LEAD]: { status: 'working' },
    [`${LEAD}:abc`]: { status: 'thinking' },
    [`${LEAD}:old`]: { status: 'done' },
    [`${LEAD}:gone`]: { status: 'offline' },
    'claude-code:s2': {},
    'claude-code:s1x': {},
  };
  const events = setup(agents)(
    p('PreToolUse', {
      agent_id: 'h1',
      agent_type: 'general-purpose',
      tool_name: 'Bash',
      tool_input: { command: 'curl https://penrithplastering.com.au/wp-json/wp/v2/pages' },
    }),
  );
  const moved = events.filter((e) => e.type === 'status').map((e) => normalizeEvent(e));
  assert.deepEqual(moved.map((e) => e.agent).sort(), [LEAD, `${LEAD}:abc`]);
  for (const e of moved) assert.equal(e.team, PENRITH);
  assert.deepEqual(new Set(teams(events)), new Set([PENRITH]));
});

test('the lead task list drives the whiteboard; helpers do not', () => {
  const ingest = setup();
  const plan = (tool_input, extra = {}) =>
    ingest(p('PreToolUse', { tool_name: 'mcp__ccd_turn__update_plan', tool_input, ...extra })).filter((e) => e.type === 'task');
  const items = [
    { content: 'Read the brief', status: 'in_progress' },
    { content: 'Write tests', status: 'pending' },
    { content: 'Ship', status: 'pending' },
  ];
  assert.deepEqual(plan({ items }).map((e) => e.task), ['1/3 · Read the brief']);
  assert.deepEqual(plan({ advance: true }).map((e) => e.task), ['2/3 · Write tests']);
  assert.deepEqual(plan({ advance: true }, { agent_id: 'h1', agent_type: 'general-purpose' }), []);
  // PostToolUse of the same call must not advance a second time.
  ingest(p('PostToolUse', { tool_name: 'mcp__ccd_turn__update_plan', tool_input: { advance: true } }));
  assert.deepEqual(plan({ start: 3 }).map((e) => e.task), ['2/3 · Write tests']);
});

test('secrets never reach an event', () => {
  const events = setup()(
    p('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'curl -H "Authorization: Bearer secret123" https://x.test' } }),
  );
  assert.ok(events.length);
  assert.ok(!JSON.stringify(events).includes('secret123'));
});

test('payloads without a session or hook name give nothing', () => {
  const ingest = setup();
  assert.deepEqual(ingest({}), []);
  assert.deepEqual(ingest({ session_id: 's1' }), []);
  assert.deepEqual(ingest(null), []);
  assert.deepEqual(ingest([1, 2]), []);
});

test('bad payloads never throw', () => {
  const ingest = setup();
  let deep = {};
  for (let i = 0; i < 5000; i++) deep = { d: deep };
  assert.doesNotThrow(() => ingest(p('PreToolUse', { tool_name: 'Bash', tool_input: deep })));
  for (const tool_input of [null, { items: null }, { done: 3 }, { done: 'x' }, { items: [null] }, 'str']) {
    assert.doesNotThrow(() => ingest(p('PreToolUse', { tool_name: 'mcp__ccd_turn__update_plan', tool_input })));
  }
  const broken = createClaudeIngest({ getSites: () => { throw new Error('boom'); }, getState: () => ({ agents: {} }) });
  assert.deepEqual(broken(p('SessionStart')), []);
});

test('a plan set in the Lobby follows the session to the site room', () => {
  const ingest = setup();
  ingest(p('PreToolUse', { tool_name: 'mcp__ccd_turn__update_plan', tool_input: { items: [
    { content: 'Plan', status: 'completed' },
    { content: 'Build hero', status: 'in_progress' },
  ] } }));
  const events = ingest(p('PreToolUse', { tool_name: 'mcp__penrith-plastering-and-gyprock-elementor__x', tool_input: {} }));
  const tasks = events.filter((e) => e.type === 'task').map((e) => normalizeEvent(e));
  assert.deepEqual(tasks.map((e) => [e.team, e.task]), [[PENRITH, '2/2 · Build hero']]);
});

test('a quoted curl -u application password never reaches the activity text', () => {
  const app = 'abcd efgh ijkl mnop qrst uvwx';
  for (const command of [
    `curl -u "admin:${app}" https://example.test/wp-json`,
    `curl --user 'admin:${app}' https://example.test/wp-json`,
    `curl -u admin:"${app}" https://example.test/wp-json`,
  ]) {
    const text = JSON.stringify(setup()(p('PreToolUse', { tool_name: 'Bash', tool_input: { command } })));
    for (const g of app.split(' ')) assert.ok(!text.includes(g), `leaked ${g}: ${text}`);
  }
});
