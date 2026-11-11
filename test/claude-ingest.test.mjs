import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeIngest, LOBBY, NAMES, parseTag } from '../server/claude-ingest.mjs';
import { loadRoster, staffEvents } from '../server/staff.mjs';
import { applyEvent, createState, normalizeEvent } from '../shared/protocol.js';

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
  assert.equal(ev.teamName, "Manager's Office");
  assert.deepEqual(LOBBY, { id: 'lobby', name: "Manager's Office" });
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

test('the first Claude lead is Mark Dave; later leads and helpers get stable random names', () => {
  const agents = {};
  const ingest = createClaudeIngest({ getSites: () => SITES, getState: () => ({ agents }) });
  const first = normalizeEvent(ingest(p('SessionStart'))[0]);
  assert.equal(first.name, 'Mark Dave');
  agents[first.agent] = { id: first.agent, name: first.name, status: 'idle' };

  const second = normalizeEvent(ingest(p('SessionStart', { session_id: 's2' }))[0]);
  assert.notEqual(second.name, 'Mark Dave');
  assert.notEqual(second.name, 'Claude');
  agents[second.agent] = { id: second.agent, name: second.name, status: 'idle' };
  const again = normalizeEvent(ingest(p('UserPromptSubmit', { session_id: 's2', prompt: 'hi' }))[0]);
  assert.equal(again.name, second.name, 'a session keeps its name');

  const spawn = ingest(p('PreToolUse', { tool_name: 'Agent', tool_use_id: 'tu_1', tool_input: { subagent_type: 'code-reviewer', description: 'Review' } }));
  const helper = normalizeEvent(spawn.find((e) => e.type === 'join'));
  assert.equal(helper.role, 'code-reviewer');
  assert.ok(!['Mark Dave', 'Code Reviewer', second.name].includes(helper.name), helper.name);
  const spawnAgain = ingest(p('PreToolUse', { tool_name: 'Agent', tool_use_id: 'tu_1', tool_input: { subagent_type: 'code-reviewer', description: 'Review' } }));
  assert.equal(normalizeEvent(spawnAgain.find((e) => e.type === 'join')).name, helper.name, 'same helper, same name');
});

test('Mark Dave passes to the next new lead once the first one has left', () => {
  const agents = { 'claude-code:old': { id: 'claude-code:old', name: 'Mark Dave', status: 'offline' } };
  const ingest = createClaudeIngest({ getSites: () => SITES, getState: () => ({ agents }) });
  assert.equal(normalizeEvent(ingest(p('SessionStart', { session_id: 's3' }))[0]).name, 'Mark Dave');
});

test('a helper that first shows up through its own tool calls gets a first name, not its id', async () => {
  const { applyEvent, createState } = await import('../shared/protocol.js');
  const state = createState();
  const ingest = createClaudeIngest({ getSites: () => SITES, getState: () => state });
  const feed = (payload) => ingest(payload).forEach((e) => applyEvent(state, normalizeEvent(e)));
  feed(p('SessionStart'));
  feed(p('PreToolUse', { agent_id: 'a95ac388e689d426a', tool_name: 'Read', tool_input: { file_path: '/x/a.ts' } }));
  const helper = Object.values(state.agents).find((a) => a.parent === LEAD);
  assert.ok(helper);
  assert.ok(!/a95ac388/i.test(helper.name), helper.name);
  assert.match(helper.name, /^[A-Z][a-z]+$/);
  feed(p('PostToolUse', { agent_id: 'a95ac388e689d426a', tool_name: 'Read', tool_input: { file_path: '/x/a.ts' } }));
  assert.equal(state.agents[helper.id].name, helper.name, 'keeps its name');
});

test('a spawned helper keeps its name when its own tool calls arrive', async () => {
  const { applyEvent, createState } = await import('../shared/protocol.js');
  const state = createState();
  const ingest = createClaudeIngest({ getSites: () => SITES, getState: () => state });
  const feed = (payload) => ingest(payload).forEach((e) => applyEvent(state, normalizeEvent(e)));
  feed(p('SessionStart'));
  feed(p('PreToolUse', { tool_name: 'Agent', tool_use_id: 'tu_9', tool_input: { subagent_type: 'Explore', description: 'Look' } }));
  const helper = Object.values(state.agents).find((a) => a.parent === LEAD);
  feed(p('PreToolUse', { agent_id: 'ag_1', agent_type: 'Explore', tool_name: 'Read', tool_input: { file_path: '/x/a.ts' } }));
  assert.equal(Object.values(state.agents).filter((a) => a.parent === LEAD).length, 1);
  assert.equal(state.agents[helper.id].name, helper.name);
});

// ---- Skill staff: role-tagged agents wake their employee ----

const AGENT_ID = 'a95ac388e689d426a'; // real shape: short hex, must survive redaction
const SITE_TOOL = { tool_name: 'mcp__penrith-plastering-and-gyprock-elementor__x', tool_input: {} };
const REVIEWER = 'staff:build:reviewer:1';

function office() {
  const state = createState();
  for (const e of staffEvents(loadRoster())) applyEvent(state, normalizeEvent(e));
  const ingest = createClaudeIngest({ getSites: () => SITES, getState: () => state });
  const apply = (events) => (events.forEach((e) => applyEvent(state, normalizeEvent(e))), events);
  return { state, ingest, apply, feed: (payload) => apply(ingest(payload)) };
}
const spawn = (id, description, extra = {}) =>
  p('PreToolUse', { tool_name: 'Agent', tool_use_id: id, tool_input: { description, prompt: 'Do it', subagent_type: 'general-purpose' }, ...extra });
const launched = (id, agentId, isAsync = true) =>
  p('PostToolUse', {
    tool_name: 'Agent', tool_use_id: id, tool_input: { description: 'x', subagent_type: 'general-purpose' },
    tool_response: { isAsync, status: isAsync ? 'async_launched' : 'completed', agentId, description: 'x' },
  });
const stop = (agentId) => p('SubagentStop', { agent_id: agentId, agent_type: 'general-purpose' });
const helpers = (state) => Object.keys(state.agents).filter((id) => id.startsWith(`${LEAD}:`));

test('parseTag reads the room, the tag and the rest', () => {
  assert.deepEqual(parseTag('[build:reviewer] Review hero section'), { room: 'build', tag: 'reviewer', rest: 'Review hero section' });
  assert.deepEqual(parseTag('[qa:batch] Fix rows 3-5'), { room: 'qa-rework', tag: 'batch', rest: 'Fix rows 3-5' });
  for (const d of ['Review hero', 'x [build:reviewer] y', '[other:reviewer] y', '', null, undefined]) assert.equal(parseTag(d), null);
});

test('untagged spawns stay ordinary helpers', () => {
  const { state, feed } = office();
  feed(p('PreToolUse', { tool_name: 'Skill', tool_input: { skill: 'superpowers:brainstorming' } }));
  const events = feed(spawn('tu_1', 'Review hero', { tool_input: { description: 'Review hero', model: 'haiku' } }));
  assert.ok(events.some((e) => e.type === 'join' && e.agent === `${LEAD}:tu1`));
  feed(spawn('tu_2', '[build:nope] Something'));
  assert.deepEqual(helpers(state).sort(), [`${LEAD}:tu1`, `${LEAD}:tu2`]);
  assert.equal(state.agents[`${LEAD}:tu2`].activity, 'Something', 'an unknown tag is still stripped');
  for (const a of Object.values(state.agents)) if (a.staff) assert.equal(a.activity, 'Standby');
});

test('a tagged spawn moves the first free employee to the session room, working', () => {
  const { state, feed } = office();
  feed(p('PreToolUse', SITE_TOOL));
  const events = feed(spawn('tu_1', '[build:reviewer] Review hero section'));
  assert.ok(!events.some((e) => e.type === 'join'), 'no ordinary helper desk');
  assert.ok(!JSON.stringify(events).includes('[build:'), 'tag stripped everywhere');
  const emp = state.agents[REVIEWER];
  assert.deepEqual([emp.team, emp.status, emp.activity, emp.parent], [PENRITH, 'working', 'Review hero section', LEAD]);
  feed(spawn('tu_2', '[build:reviewer] Review footer'));
  assert.equal(state.agents['staff:build:reviewer:2'].team, PENRITH);
  feed(launched('tu_1', AGENT_ID));
  assert.equal(state.agents[REVIEWER].status, 'working', 'a background launch is not the end');
  assert.deepEqual(helpers(state), []);
});

test('the employee goes home on SubagentStop and shows Standby', () => {
  const { state, feed } = office();
  feed(p('PreToolUse', SITE_TOOL));
  feed(spawn('tu_1', '[build:reviewer] Review hero section'));
  feed(launched('tu_1', AGENT_ID));
  feed(stop(AGENT_ID));
  const emp = state.agents[REVIEWER];
  assert.deepEqual([emp.team, emp.status, emp.activity, emp.parent], ['build', 'idle', 'Standby', undefined]);
  assert.deepEqual(helpers(state), []);
  // A foreground call ends at its PostToolUse.
  feed(spawn('tu_2', '[qa:batch] Fix rows'));
  assert.equal(state.agents['staff:qa-rework:batch:1'].team, PENRITH);
  feed(launched('tu_2', 'b1', false));
  assert.deepEqual([state.agents['staff:qa-rework:batch:1'].team, state.agents['staff:qa-rework:batch:1'].activity], ['qa-rework', 'Standby']);
});

test('subagent tool calls show on the employee', () => {
  const { state, feed } = office();
  feed(p('PreToolUse', SITE_TOOL));
  feed(spawn('tu_1', '[build:reviewer] Review hero section'));
  feed(launched('tu_1', AGENT_ID));
  feed(p('PreToolUse', { agent_id: AGENT_ID, agent_type: 'general-purpose', tool_name: 'Read', tool_input: { file_path: '/x/a.ts' } }));
  const emp = state.agents[REVIEWER];
  assert.deepEqual([emp.tool, emp.status, emp.team], ['Read', 'working', PENRITH]);
  assert.match(emp.activity, /a\.ts/);
  assert.deepEqual(helpers(state), []);
});

test('parallel sessions use extras: Lee Pay Kho, then Kram Evad, then a random name', () => {
  const { state, feed } = office();
  feed(spawn('tu_1', '[build:header] Build header'));
  assert.equal(state.agents['staff:build:header:1'].parent, LEAD);
  const extra = (s) => {
    const events = feed(spawn(`tu_${s}`, '[build:header] Build header', { session_id: s }));
    const join = events.find((e) => e.type === 'join');
    assert.ok(join, `an extra joins for ${s}`);
    const a = state.agents[join.agent];
    assert.deepEqual([a.parent, a.role, a.status, a.activity], [`claude-code:${s}`, 'Header agent', 'working', 'Build header']);
    return a.name;
  };
  assert.equal(extra('s2'), 'Lee Pay Kho');
  assert.equal(extra('s3'), 'Kram Evad');
  const fourth = extra('s4');
  assert.ok(NAMES.includes(fourth), fourth);
  const live = Object.values(state.agents).filter((a) => a.name === fourth);
  assert.equal(live.length, 1, 'never a name already on the floor');
});

test('session end sends staff home and extras out', () => {
  const { state, feed } = office();
  feed(p('PreToolUse', SITE_TOOL));
  feed(spawn('tu_1', '[build:header] Build header'));
  const join = feed(spawn('tu_2', '[build:header] Build header again')).find((e) => e.type === 'join');
  assert.equal(state.agents[join.agent].name, 'Lee Pay Kho');
  feed(p('SessionEnd'));
  assert.deepEqual([state.agents['staff:build:header:1'].team, state.agents['staff:build:header:1'].activity], ['build', 'Standby']);
  assert.equal(state.agents[join.agent].status, 'offline');
});

test("staff follow the lead's room", () => {
  const { state, feed } = office();
  feed(spawn('tu_1', '[build:section] Build hero'));
  assert.equal(state.agents['staff:build:section:1'].team, 'lobby');
  feed(p('PreToolUse', SITE_TOOL));
  assert.equal(state.agents['staff:build:section:1'].team, PENRITH);
});

test("tick moves an idle lead to the Manager's Office after 5 minutes", () => {
  const { state, ingest, feed, apply } = office();
  feed(p('PreToolUse', SITE_TOOL));
  feed(spawn('tu_1', '[build:section] Build hero'));
  feed(launched('tu_1', AGENT_ID)); // linked, so only the 2-hour rule applies to it
  const now = Date.now();
  assert.deepEqual(ingest.tick(now), []);
  apply(ingest.tick(now + 5 * 60_000 + 5000));
  assert.equal(state.agents[LEAD].team, 'lobby');
  assert.equal(state.agents['staff:build:section:1'].team, PENRITH, 'only the lead goes');
  assert.deepEqual(ingest.tick(now + 5 * 60_000 + 6000), [], 'once');
  apply(ingest.tick(now + 2 * 60 * 60_000 + 5000));
  assert.deepEqual([state.agents['staff:build:section:1'].team, state.agents['staff:build:section:1'].activity], ['build', 'Standby']);
  feed(p('PreToolUse', SITE_TOOL));
  assert.equal(state.agents[LEAD].team, PENRITH, 'back on the next site call');
});

test("a resumed agent's tool calls bring the same employee back", () => {
  const { state, feed } = office();
  feed(p('PreToolUse', SITE_TOOL));
  feed(spawn('tu_1', '[qa:batch] Triage rows'));
  feed(launched('tu_1', AGENT_ID));
  feed(stop(AGENT_ID));
  const id = 'staff:qa-rework:batch:1';
  assert.equal(state.agents[id].team, 'qa-rework');
  feed(p('PreToolUse', { agent_id: AGENT_ID, agent_type: 'general-purpose', tool_name: 'Edit', tool_input: { file_path: '/x/b.ts' } }));
  const emp = state.agents[id];
  assert.deepEqual([emp.team, emp.status, emp.tool, emp.parent], [PENRITH, 'working', 'Edit', LEAD]);
  assert.deepEqual(helpers(state), []);
});

test('an untagged haiku or fable helper in a figma skill session takes that skill’s evidence or escalation desk', () => {
  const { state, feed } = office();
  feed(p('PreToolUse', { tool_name: 'Skill', tool_input: { skill: 'figma-to-elementor-qa-rework' } }));
  feed(p('PreToolUse', { tool_name: 'Skill', tool_input: { skill: 'figma-to-elementor-build' } }));
  feed(spawn('tu_1', 'Download shots', { tool_input: { description: 'Download shots', model: 'haiku' } }));
  feed(spawn('tu_2', 'Hard one', { tool_input: { description: 'Hard one', model: 'fable' } }));
  feed(spawn('tu_3', 'Plain', { tool_input: { description: 'Plain', model: 'sonnet' } }));
  assert.equal(state.agents['staff:qa-rework:evidence:1'].activity, 'Download shots', 'qa-rework sticks');
  assert.equal(state.agents['staff:qa-rework:escalation:1'].activity, 'Hard one');
  assert.deepEqual(helpers(state), [`${LEAD}:tu3`]);
});

test('the lead briefs each employee it wakes, also when an agent resumes', () => {
  const { state, ingest } = office();
  const briefs = [];
  const feed = (payload) => ingest(payload).forEach((e) => {
    for (const fx of applyEvent(state, normalizeEvent(e)).effects) if (fx.kind === 'message' && fx.from === LEAD) briefs.push([fx.to, fx.text]);
  });
  feed(p('PreToolUse', SITE_TOOL));
  feed(p('UserPromptSubmit', { prompt: 'go' }));
  feed(spawn('tu_1', '[build:reviewer] Review hero section'));
  assert.deepEqual(briefs, [[REVIEWER, 'Review hero section']]);
  assert.equal(state.agents[LEAD].status, 'working', 'the brief does not change the lead');
  feed(launched('tu_1', AGENT_ID));
  feed(stop(AGENT_ID));
  feed(p('PreToolUse', { agent_id: AGENT_ID, agent_type: 'general-purpose', tool_name: 'Read', tool_input: { file_path: '/x/a.ts' } }));
  assert.equal(briefs.length, 2);
  assert.equal(briefs[1][0], REVIEWER);
});

test("a foreground spawn's inner tool calls show on the employee before its PostToolUse", () => {
  const { state, feed } = office();
  feed(p('PreToolUse', SITE_TOOL));
  feed(spawn('tu_1', '[build:reviewer] Review hero section'));
  feed(spawn('tu_2', 'Explore code', { tool_input: { description: 'Explore code', subagent_type: 'Explore' } }));
  feed(p('PreToolUse', { agent_id: 'f1', agent_type: 'general-purpose', tool_name: 'Read', tool_input: { file_path: '/x/a.ts' } }));
  assert.deepEqual([state.agents[REVIEWER].tool, state.agents[REVIEWER].status], ['Read', 'working']);
  assert.deepEqual(helpers(state), [`${LEAD}:tu2`], 'no extra helper desk for the reviewer');
  feed(launched('tu_1', 'f1', false));
  assert.deepEqual([state.agents[REVIEWER].team, state.agents[REVIEWER].activity], ['build', 'Standby']);
});

test('a spawn that never links releases its employee after 2 minutes; extras leave', () => {
  const { state, ingest, feed, apply } = office();
  feed(p('PreToolUse', SITE_TOOL));
  feed(spawn('tu_1', '[build:escalation] Hard one'));
  const extra = feed(spawn('tu_2', '[build:escalation] Hard one again')).find((e) => e.type === 'join').agent;
  const now = Date.now();
  assert.deepEqual(ingest.tick(now + 60_000).filter((e) => e.agent !== LEAD), [], 'not yet');
  apply(ingest.tick(now + 2 * 60_000 + 5000));
  const emp = state.agents['staff:build:escalation:1'];
  assert.deepEqual([emp.team, emp.activity], ['build', 'Standby']);
  assert.equal(state.agents[extra].status, 'offline');
  feed(launched('tu_1', 'late1'));
  assert.equal(state.agents['staff:build:escalation:1'].team, 'build', 'a stale PostToolUse does not wake it');
});

test('a failed spawn releases its employee at once', () => {
  const { state, feed } = office();
  feed(p('PreToolUse', SITE_TOOL));
  feed(spawn('tu_1', '[build:escalation] Hard one'));
  assert.equal(state.agents['staff:build:escalation:1'].team, PENRITH);
  feed(p('PostToolUseFailure', { tool_name: 'Agent', tool_use_id: 'tu_1', tool_input: { description: 'x' }, error: 'denied' }));
  const emp = state.agents['staff:build:escalation:1'];
  assert.deepEqual([emp.team, emp.activity], ['build', 'Standby']);
  feed(spawn('tu_2', '[build:escalation] Retry'));
  assert.equal(state.agents['staff:build:escalation:1'].activity, 'Retry', 'the retry gets the real employee');
});
