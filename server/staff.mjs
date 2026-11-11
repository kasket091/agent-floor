// Permanent "skill staff": one standby employee per desk in the Build and QA Rework rooms.
// The roster lives in staff.json (edited by hand when the skills change), not parsed from the skills.
import { readFileSync } from 'node:fs';
import { NAMES } from './claude-ingest.mjs';

export function loadRoster() {
  return JSON.parse(readFileSync(new URL('./staff.json', import.meta.url), 'utf8'));
}

export const STAFF_ROOMS = loadRoster().rooms.map(({ id, name }) => ({ id, name }));

/** n is 1-based: 'staff:build:reviewer:2'. */
export function staffId(roomId, tag, n) {
  return `staff:${roomId}:${tag}:${n}`;
}

function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function staffEvents(roster) {
  const events = [];
  const taken = new Set();
  for (const room of roster.rooms) {
    for (const role of room.roles) {
      for (let n = 1; n <= role.desks; n++) {
        const id = staffId(room.id, role.tag, n);
        let i = hash(id);
        while (taken.has(NAMES[i % NAMES.length])) i++; // fixed per desk, unique across staff
        const name = NAMES[i % NAMES.length];
        taken.add(name);
        events.push({
          type: 'join', agent: id, name, role: role.label, staff: true,
          team: { id: room.id, name: room.name }, status: 'idle', activity: 'Standby',
        });
      }
    }
  }
  return events;
}
