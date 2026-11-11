import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../shared/protocol.js';
import { workingList } from '../src/ui/working.ts';

function floor() {
  const s = createState();
  s.teams.lobby = { id: 'lobby', name: 'Lobby', order: 1 };
  s.teams.penrith = { id: 'penrith', name: 'Penrith', order: 0 };
  const a = (id, team, status, lastSeen) => (s.agents[id] = { id, name: id, role: 'Lead', team, status, lastSeen, joinedAt: 0, history: [] });
  a('idle1', 'lobby', 'idle', 900);
  a('done1', 'lobby', 'done', 900);
  a('gone1', 'lobby', 'offline', 900);
  a('lobbyWork', 'lobby', 'working', 500);
  a('penOld', 'penrith', 'thinking', 100);
  a('penNew', 'penrith', 'working', 800);
  a('needsYou', 'lobby', 'waiting', 50);
  a('broke', 'penrith', 'error', 60);
  return s;
}

test('lists only busy agents: working, thinking, needs you, error', () => {
  const ids = workingList(floor()).map((a) => a.id);
  assert.deepEqual(new Set(ids), new Set(['lobbyWork', 'penOld', 'penNew', 'needsYou', 'broke']));
});

test('needs-you and errors first, then by room order, newest activity first within a room', () => {
  assert.deepEqual(workingList(floor()).map((a) => a.id), ['broke', 'needsYou', 'penNew', 'penOld', 'lobbyWork']);
});

test('an empty floor gives an empty list', () => {
  assert.deepEqual(workingList(createState()), []);
});
