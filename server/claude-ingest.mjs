// Raw Claude Code hook payloads -> Agent Floor events, with site rooms and the lead's task list.
import { fromClaude } from '../adapters/claude.mjs';
import { shortId } from '../adapters/common.mjs';
import { redactDeep } from './redact.mjs';
import { siteForPayload } from './sites.mjs';
import { applyPlan, planText } from './plan.mjs';
import { createStaffDesk, parseTag, stripTags } from './staff-desk.mjs';

export { parseTag };

export const LOBBY = { id: 'lobby', name: "Manager's Office" };
const PLAN_TOOL = 'mcp__ccd_turn__update_plan';
export const LEAD_HOME_MS = 5 * 60_000; // a lead with no event this long walks back to the Manager's Office
export const OWNER = 'Mark Dave'; // the first Claude lead on the floor
// Local first names, picked by a hash of the agent id: no AI, no tokens.
export const NAMES = ['Mia', 'Leo', 'Ava', 'Noah', 'Zoe', 'Liam', 'Ella', 'Finn', 'Ivy', 'Jack', 'Ruby', 'Owen', 'Nina', 'Hugo', 'Lily',
  'Theo', 'Isla', 'Max', 'Cleo', 'Sam', 'Aria', 'Kai', 'Lucy', 'Eli', 'Rosa', 'Ben', 'Maya', 'Alex', 'Jade', 'Oscar',
  'Tess', 'Ravi', 'Lena', 'Jon', 'Kira', 'Milo', 'Sara', 'Toby', 'Nora', 'Ezra'];

export function createClaudeIngest({ getSites, getState }) {
  const env = process.env.AGENT_FLOOR_TEAM;
  const start = env ? { id: env, name: env } : LOBBY;
  const sessions = new Map(); // session_id -> { room: { id, name }, plan: PlanItem[], name, lead, seen, skill? }
  const named = new Map(); // agent id -> name, so an agent keeps its name
  const desk = createStaffDesk({ getState });

  // Stable per agent; skips names already on the floor while there are free ones.
  function nameFor(id, live) {
    if (named.has(id)) return named.get(id);
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    let name = NAMES[h % NAMES.length];
    for (let i = 0; i < NAMES.length && live.has(name); i++) name = NAMES[(h + i + 1) % NAMES.length];
    named.set(id, name);
    return name;
  }

  function translate(payload, now = Date.now()) {
    const p = redactDeep(payload, 2000);
    if (!p || typeof p !== 'object' || Array.isArray(p) || !p.session_id || !p.hook_event_name) return [];
    const lead = `claude-code:${shortId(p.session_id)}`;
    let session = sessions.get(p.session_id);
    if (!session) {
      const live = new Set(Object.values(getState().agents).filter((a) => a?.status !== 'offline').map((a) => a?.name));
      const name = named.get(lead) ?? (live.has(OWNER) ? nameFor(lead, live) : OWNER);
      named.set(lead, name);
      sessions.set(p.session_id, (session = { room: start, plan: [], name, lead, seen: now }));
    }
    session.seen = now;
    let out = [];

    const site = siteForPayload(getSites() ?? [], p.tool_name, p.tool_input);
    if (site && site.host !== session.room.id) {
      session.room = { id: site.host, name: site.name };
      for (const [id, agent] of Object.entries(getState().agents)) {
        if (agent?.status === 'done' || agent?.status === 'offline') continue; // let finished helpers go
        if (id === lead || id.startsWith(lead + ':')) out.push({ type: 'status', agent: id });
      }
      for (const id of desk.members(p.session_id)) out.push({ type: 'status', agent: id }); // staff follow the lead
      const task = planText(session.plan); // the whiteboard moves with the session
      if (task) out.push({ type: 'task', agent: lead, task });
    }

    // PreToolUse only: the PostToolUse of the same call would advance the plan twice.
    if (p.tool_name === PLAN_TOOL && !p.agent_id && p.hook_event_name === 'PreToolUse') {
      session.plan = applyPlan(session.plan, p.tool_input ?? {});
      const task = planText(session.plan);
      if (task) out.push({ type: 'task', agent: lead, task });
    }

    out.push(...fromClaude(p));
    if (p.hook_event_name === 'SessionEnd') sessions.delete(p.session_id);
    const live = new Set(Object.values(getState().agents).map((a) => a?.name));
    for (const ev of out) {
      if (ev.agent === lead && ev.name) ev.name = process.env.AGENT_FLOOR_NAME || session.name;
      else if (ev.type === 'join' && ev.parent === lead) ev.name = nameFor(ev.agent, live);
      // A helper seen only through its own tool calls: the reducer uses this name only for a new desk.
      else if (ev.subagent) ev.name = nameFor(`${lead}:${ev.subagent.key ?? ev.subagent.type}`, live);
    }
    // After naming: an extra brings its own name, and the employee keeps its own.
    const routed = desk.route(p, lead, session, out, now);
    out = routed.events;
    // normalizeEvent reads the room name only from an object team. Home-going staff keep their own room.
    const events = [...out.map((ev) => ({ ...ev, team: { ...session.room } })), ...routed.home];
    for (const ev of events) for (const k of ['activity', 'text', 'task']) if (ev[k] != null) ev[k] = stripTags(ev[k]);
    return events;
  }

  const ingest = (payload) => {
    try {
      return translate(payload);
    } catch {
      return []; // one bad payload must never break the endpoint
    }
  };
  /** Called every 2 s: idle leads walk back to the Manager's Office, long-gone staff go home. */
  ingest.tick = (now = Date.now()) => {
    try {
      const out = desk.tick(now);
      for (const s of sessions.values()) {
        if (s.room.id === start.id || now - s.seen <= LEAD_HOME_MS) continue;
        s.room = start; // the next site call walks it back
        out.push({ type: 'status', agent: s.lead, team: { ...start } });
      }
      return out;
    } catch {
      return [];
    }
  };
  return ingest;
}
