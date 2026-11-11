import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { join } from 'node:path';
import { loadRoster, staffEvents, staffId } from '../server/staff.mjs';
import { LOBBY } from '../server/claude-ingest.mjs';
import { applyEvent, createState, normalizeEvent, sweep } from '../shared/protocol.js';
import { startServer } from '../server/index.mjs';

const desks = (room) => room.roles.reduce((n, r) => n + r.desks, 0);

test('roster has 14 Build and 8 QA Rework desks', () => {
  const [build, qa] = loadRoster().rooms;
  assert.deepEqual([build.id, build.name, desks(build)], ['build', 'Build', 14]);
  assert.deepEqual([qa.id, qa.name, desks(qa)], ['qa-rework', 'QA Rework', 8]);
  assert.equal(staffId('build', 'reviewer', 2), 'staff:build:reviewer:2');
});

test('staff events join every desk on standby with stable names', () => {
  const a = staffEvents(loadRoster());
  assert.equal(a.length, 22);
  assert.deepEqual(a.map((e) => e.name), staffEvents(loadRoster()).map((e) => e.name));
  for (const e of a) {
    assert.equal(e.staff, true);
    assert.equal(e.status, 'idle');
    assert.equal(e.activity, 'Standby');
    assert.ok(!['Mark Dave', 'Lee Pay Kho', 'Kram Evad'].includes(e.name));
  }
});

test('sweep never removes staff', () => {
  const s = createState();
  const now = Date.now();
  for (const e of staffEvents(loadRoster())) applyEvent(s, normalizeEvent({ ...e, ts: now - 3 * 3600_000 }));
  assert.ok(s.agents['staff:build:reviewer:2'].staff);
  assert.deepEqual(sweep(s, now), []);
  assert.equal(Object.keys(s.agents).length, 22);
});

test('server start shows staff and the two rooms; reset brings them back', async () => {
  const floor = await startServer({ port: 0, log: () => {}, claudeConfig: join(os.tmpdir(), 'af-no-such-config.json') });
  const base = `http://127.0.0.1:${floor.server.address().port}`;
  const check = async () => {
    const st = await (await fetch(`${base}/state`)).json();
    assert.equal(Object.values(st.agents).filter((a) => a.staff).length, 22);
    assert.equal(st.teams.build.pinned, true);
    assert.equal(st.teams['qa-rework'].name, 'QA Rework');
  };
  try {
    await check();
    await fetch(`${base}/reset`, { method: 'POST' });
    await check();
  } finally {
    await floor.close();
  }
});

test("the lobby room is named Manager's Office", () => {
  assert.equal(LOBBY.name, "Manager's Office");
});
