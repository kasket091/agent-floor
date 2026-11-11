import type { Agent, Status, WorldState } from '../../shared/protocol';

const BUSY: Status[] = ['waiting', 'error', 'working', 'thinking'];
const urgent = (s: Status) => (s === 'waiting' || s === 'error' ? 0 : 1);

/** Agents doing something right now: needs-you and errors first, then by room, newest activity first. */
export function workingList(state: WorldState): Agent[] {
  const order = (a: Agent) => state.teams[a.team]?.order ?? Infinity;
  return Object.values(state.agents)
    .filter((a) => BUSY.includes(a.status))
    .sort((a, b) => urgent(a.status) - urgent(b.status) || order(a) - order(b) || b.lastSeen - a.lastSeen);
}
