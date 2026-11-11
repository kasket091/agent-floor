import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../shared/protocol.js';
import { SeatBook, computeLayout, idleSpots, meetingSpots, outing, toLocal } from '../src/world/layout.ts';

function floor() {
  const s = createState();
  s.teams.t = { id: 't', name: 'T', hue: 212, order: 0, createdAt: 0 };
  s.agents.a = { id: 'a', name: 'Mia', role: 'Lead', team: 't', source: 'claude-code', status: 'idle', joinedAt: 0, lastSeen: 0, history: [] };
  return computeLayout(s, new SeatBook());
}

test('idle spots are in the kitchen and lounge, each with its own key', () => {
  const L = floor();
  const spots = idleSpots(L);
  const kinds = new Set(spots.map((s) => s.kind));
  assert.ok(kinds.has('kitchen') && kinds.has('lounge'));
  assert.equal(new Set(spots.map((s) => s.key)).size, spots.length);
  assert.ok(spots.some((s) => !s.stand), 'some spots are sofa seats');
  for (const s of spots) {
    const a = L.amenities.find((x) => x.kind === s.kind);
    assert.ok(Math.abs(s.x - a.rect.x) <= a.rect.w / 2 && Math.abs(s.z - a.rect.z) <= a.rect.d / 2, `${s.key} is inside its room`);
  }
});

test('an outing walks out of the office, along the corridor and ends on the spot', () => {
  const L = floor();
  const room = L.rooms.get('t');
  const home = room.seats.get('a');
  const spot = idleSpots(L).find((s) => s.kind === 'lounge');
  const trip = outing(room, home, spot);
  const end = trip.path.at(-1);
  const want = toLocal(room, [spot.x, spot.z]);
  assert.ok(Math.hypot(end[0] - want[0], end[1] - want[1]) < 1e-9);
  assert.deepEqual([trip.x, trip.z], end);
  assert.equal(trip.stand, spot.stand);
  // It leaves through the office door and walks the corridor (world z = 0).
  const door = room.entry.at(-2);
  assert.ok(trip.path.some((p) => p[0] === door[0] && p[1] === door[1]));
  assert.ok(Math.hypot(...trip.path.at(0).map((v, i) => v - home.path.at(-2)[i])) < 1e-9, 'starts by stepping back from the desk');
});

test('meeting seats are 8 chairs in the meeting room, far side first, entered through its door', () => {
  const L = floor();
  const room = L.amenities.find((a) => a.kind === 'meeting');
  const seats = meetingSpots(L);
  assert.equal(seats.length, 8);
  assert.ok(seats.every((s) => s.kind === 'meeting' && !s.stand));
  for (const s of seats) assert.ok(Math.abs(s.x - room.rect.x) < room.rect.w / 2 && Math.abs(s.z - room.rect.z) < room.rect.d / 2, s.key);
  // Far side (away from the corridor) first, so the first sitters face the room's glass front.
  const fromCorridor = (s) => Math.abs(s.z);
  assert.ok(fromCorridor(seats[0]) > fromCorridor(seats[7]));
  // Everyone walks in through the door in the middle of the corridor wall.
  for (const s of seats) {
    assert.ok(Math.abs(s.route[0][0] - room.rect.x) < 1e-9 && Math.abs(s.route[0][1]) < 1e-9, 'starts in the corridor at the door');
    assert.ok(Math.abs(s.route[1][0] - room.rect.x) < 1e-9, 'then steps through the door');
  }
  assert.ok(!idleSpots(L).some((s) => s.kind === 'meeting'), 'breaks never use the meeting room');
});
