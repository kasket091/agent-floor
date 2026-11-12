import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screensOn } from '../src/world/screens.ts';
import { looksFor } from '../src/world/palette.ts';

test('the lounge TV is on only while someone is sitting in the lounge', () => {
  assert.deepEqual(screensOn([]), { lounge: false, meeting: false });
  assert.equal(screensOn([{ spot: 'south:lounge:1', atSpot: false }]).lounge, false, 'still walking there');
  assert.equal(screensOn([{ spot: 'south:lounge:1', atSpot: true }]).lounge, true);
  assert.equal(screensOn([{ spot: 'north:kitchen:0', atSpot: true }]).lounge, false);
});

test('the meeting room screen shows charts while a briefing is seated', () => {
  assert.equal(screensOn([{ spot: 'north:meeting:0', meeting: true, atSpot: false }]).meeting, false);
  assert.equal(screensOn([{ spot: 'north:meeting:0', meeting: true, atSpot: true }]).meeting, true);
});

test('the receptionist has fair skin, long dark hair and a hairstyle no one else gets', () => {
  const r = looksFor('front-desk', 'Receptionist');
  assert.equal(r.skin, '#f6d5bd');
  assert.equal(r.hairStyle, 6);
  assert.equal(r.glasses, false);
  for (let i = 0; i < 200; i++) assert.notEqual(looksFor(`claude-code:${i}`, 'Mia').hairStyle, 6);
});
