// Raw Claude Code hook payloads -> Agent Floor events, with site rooms and the lead's task list.
import { fromClaude } from '../adapters/claude.mjs';
import { shortId } from '../adapters/common.mjs';
import { redactDeep } from './redact.mjs';
import { siteForPayload } from './sites.mjs';
import { applyPlan, planText } from './plan.mjs';

export const LOBBY = { id: 'lobby', name: 'Lobby' };
const PLAN_TOOL = 'mcp__ccd_turn__update_plan';

export function createClaudeIngest({ getSites, getState }) {
  const env = process.env.AGENT_FLOOR_TEAM;
  const start = env ? { id: env, name: env } : LOBBY;
  const sessions = new Map(); // session_id -> { room: { id, name }, plan: PlanItem[] }

  function translate(payload) {
    const p = redactDeep(payload, 2000);
    if (!p || typeof p !== 'object' || Array.isArray(p) || !p.session_id || !p.hook_event_name) return [];
    let session = sessions.get(p.session_id);
    if (!session) sessions.set(p.session_id, (session = { room: start, plan: [] }));
    const lead = `claude-code:${shortId(p.session_id)}`;
    const out = [];

    const site = siteForPayload(getSites() ?? [], p.tool_name, p.tool_input);
    if (site && site.host !== session.room.id) {
      session.room = { id: site.host, name: site.name };
      for (const [id, agent] of Object.entries(getState().agents)) {
        if (agent?.status === 'done' || agent?.status === 'offline') continue; // let finished helpers go
        if (id === lead || id.startsWith(lead + ':')) out.push({ type: 'status', agent: id });
      }
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
    // normalizeEvent reads the room name only from an object team.
    return out.map((ev) => ({ ...ev, team: { ...session.room } }));
  }

  return (payload) => {
    try {
      return translate(payload);
    } catch {
      return []; // one bad payload must never break the endpoint
    }
  };
}
