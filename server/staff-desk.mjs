// Role-tagged helper agents -> the matching standby employee, or an extra when every desk of the role is busy.
// "[build:reviewer] Review hero" wakes the Build room's first free Reviewer; untagged spawns stay ordinary helpers.
import { NAMES } from './claude-ingest.mjs';
import { loadRoster, staffId } from './staff.mjs';

const TAG = /^\s*\[(build|qa):([a-z-]+)\]\s*/;
const ANY_TAG = /\[(?:build|qa):[a-z-]+\]\s*/g;
const ROOMS = { build: 'build', qa: 'qa-rework' };
const SKILLS = { 'figma-to-elementor-build': 'build', 'figma-to-elementor-qa-rework': 'qa-rework' };
const BY_MODEL = { haiku: 'evidence', fable: 'escalation' }; // untagged helpers in a figma skill session only
const EXTRAS = ['Lee Pay Kho', 'Kram Evad'];
const SPAWN_TOOLS = new Set(['Task', 'Agent']);
const STALE_MS = 2 * 60 * 60_000;
const PENDING_MS = 2 * 60_000; // a spawn that never linked an agent (failed or denied) by then is let go

/** @returns {{ room: 'build' | 'qa-rework', tag: string, rest: string } | null} */
export function parseTag(description) {
  const m = typeof description === 'string' ? description.match(TAG) : null;
  return m ? { room: /** @type {any} */ (ROOMS[m[1]]), tag: m[2], rest: description.slice(m[0].length) } : null;
}

export const stripTags = (text) => (typeof text === 'string' ? text.replace(ANY_TAG, '') : text);

export function createStaffDesk({ getState }) {
  const rooms = new Map(loadRoster().rooms.map((r) => [r.id, r]));
  // id -> { id, home?, name?, role?, session?, lead?, agent?, ts }. Staff have a home room; extras do not.
  const workers = new Map();
  const byTool = new Map(); // spawn tool_use_id -> { w, sid, type }
  // shortcut: links live until SessionEnd; a session that never ends keeps a few short strings, fine for a local server.
  const byAgent = new Map(); // subagent agent_id -> { w, sid }
  let extras = 0;

  function roleFor(input, skill) {
    const t = parseTag(input?.description);
    const [roomId, tag, rest] = t ? [t.room, t.tag, t.rest] : skill && BY_MODEL[input?.model] ? [skill, BY_MODEL[input.model], input.description] : [];
    const room = rooms.get(roomId);
    const role = room?.roles.find((r) => r.tag === tag);
    return role ? { room, role, rest: stripTags(rest) || 'Starting' } : null;
  }

  function pick({ room, role }, session) {
    const agents = getState().agents;
    for (let n = 1; n <= role.desks; n++) {
      const id = staffId(room.id, role.tag, n);
      if (agents[id]?.team !== room.id || workers.get(id)?.session) continue; // away or taken
      if (!workers.has(id)) workers.set(id, { id, home: { id: room.id, name: room.name } });
      return workers.get(id);
    }
    const live = new Set(Object.values(agents).filter((a) => a?.status !== 'offline').map((a) => a?.name));
    live.add(session.name);
    const free = NAMES.filter((n) => !live.has(n));
    const pool = free.length ? free : NAMES;
    const name = EXTRAS.find((n) => !live.has(n)) ?? pool[Math.floor(Math.random() * pool.length)];
    const w = { id: `extra:${++extras}`, name, role: role.label };
    workers.set(w.id, w);
    return w;
  }

  // Assign and walk to the session's room (ingest stamps the room on every non-home event).
  function wake(w, sid, lead, activity, now) {
    Object.assign(w, { session: sid, lead, agent: undefined, ts: now });
    workers.set(w.id, w); // an extra coming back for a resumed agent
    if (!w.home) return [{ type: 'join', agent: w.id, name: w.name, role: w.role, parent: lead, source: 'claude-code', status: 'working', activity }];
    // A join's parent briefs the newcomer; an employee already exists, so the lead briefs it with a message.
    return [
      { type: 'status', agent: w.id, parent: lead, status: 'working', activity },
      { type: 'message', agent: lead, to: w.id, text: activity ?? 'Picking up again' },
    ];
  }

  function goHome(w) {
    w.session = w.lead = w.agent = undefined;
    if (!w.home) {
      workers.delete(w.id);
      return [{ type: 'leave', agent: w.id, activity: 'Left the building' }];
    }
    return [{ type: 'status', agent: w.id, team: { ...w.home }, parent: '', status: 'idle', activity: 'Standby' }];
  }

  /**
   * Rewrites the adapter's events for staff. `events` get the session's room; `home` events carry their own team.
   * @returns {{ events: any[], home: any[] }}
   */
  function route(p, lead, session, out, now) {
    const sid = p.session_id;
    const home = [];
    const spawn = SPAWN_TOOLS.has(p.tool_name);

    if (p.tool_name === 'Skill' && p.hook_event_name === 'PreToolUse' && !p.agent_id) {
      const skill = SKILLS[p.tool_input?.skill];
      if (skill && session.skill !== 'qa-rework') session.skill = skill; // qa-rework loads build as background
    }

    if (spawn && p.hook_event_name === 'PreToolUse') {
      const match = roleFor(p.tool_input, session.skill);
      if (match) {
        const w = pick(match, session);
        if (p.tool_use_id) byTool.set(p.tool_use_id, { w, sid, type: p.tool_input?.subagent_type || 'general-purpose' });
        out = [...out.filter((e) => e.type !== 'join'), ...wake(w, sid, lead, match.rest, now)];
      }
    } else if (spawn && p.hook_event_name === 'PostToolUseFailure' && byTool.has(p.tool_use_id)) {
      const { w } = byTool.get(p.tool_use_id);
      byTool.delete(p.tool_use_id);
      if (w.session === sid && !w.agent) home.push(...goHome(w));
    } else if (spawn && p.hook_event_name === 'PostToolUse' && byTool.has(p.tool_use_id)) {
      const { w } = byTool.get(p.tool_use_id);
      byTool.delete(p.tool_use_id);
      out = out.filter((e) => e.agent === lead); // no "Report ready" helper desk
      const r = p.tool_response;
      if (w.session === sid && r?.agentId) {
        w.agent = String(r.agentId);
        byAgent.set(w.agent, { w, sid });
      }
      // A background launch returns at once; anything else (a foreground call) has finished.
      if (w.session === sid && r?.isAsync !== true) home.push(...goHome(w));
    }

    let link = p.agent_id != null ? byAgent.get(String(p.agent_id)) : undefined;
    if (!link && p.agent_id != null) {
      // Before its spawn's PostToolUse (always, for a foreground call): the oldest pending spawn of this type.
      for (const v of byTool.values()) {
        if (v.sid !== sid || v.w.session !== sid || v.w.agent || v.type !== p.agent_type) continue;
        v.w.agent = String(p.agent_id);
        byAgent.set(v.w.agent, (link = { w: v.w, sid }));
        break;
      }
    }
    const w = link?.w;
    if (w && !(w.session && w.agent !== String(p.agent_id))) {
      if (p.hook_event_name === 'SubagentStop') {
        out = out.filter((e) => !e.subagent); // no "Finished" helper desk
        if (w.session) home.push(...goHome(w));
      } else if (out.some((e) => e.subagent)) {
        const back = w.session ? [] : wake(w, sid, lead, undefined, now); // a resumed agent
        w.agent = String(p.agent_id);
        w.ts = now;
        out = [...back, ...out.map((e) => {
          if (!e.subagent) return e;
          const { subagent, name, ...rest } = e; // the employee keeps its own name
          return { ...rest, agent: w.id, parent: lead };
        })];
      }
    }

    if (p.hook_event_name === 'SessionEnd') {
      for (const x of [...workers.values()]) if (x.session === sid) home.push(...goHome(x));
      for (const map of [byTool, byAgent]) for (const [k, v] of map) if (v.sid === sid) map.delete(k);
    }
    return { events: out, home };
  }

  return {
    route,
    /** Ids of the employees and extras working for this session, so they follow it between rooms. */
    members: (sid) => [...workers.values()].filter((w) => w.session === sid).map((w) => w.id),
    /** Employees away for 2 hours with no event go home; so do those whose spawn never linked an agent. */
    tick: (now) => {
      const gone = [...workers.values()].filter((w) => w.session && now - w.ts > (w.agent ? STALE_MS : PENDING_MS));
      for (const [k, v] of byTool) if (gone.includes(v.w)) byTool.delete(k);
      return gone.flatMap(goHome);
    },
  };
}
