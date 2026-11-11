import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Color } from 'three';
import { LOBBY_SHADE, ROOM_SHADES, roomAccent, roomCarpet } from '../src/world/brand.ts';
import { STATUS_COLORS } from '../src/world/palette.ts';

test('order 0 gets primary purple and shades wrap after 8', () => {
  assert.equal(roomAccent({ id: 'a', order: 0 }).getHexString(), '5a15a0');
  assert.equal(ROOM_SHADES.length, 8);
  assert.equal(roomAccent({ id: 'x', order: 9 }).getHexString(), roomAccent({ id: 'y', order: 1 }).getHexString());
});

test('the lobby has its fixed pale lilac whatever its order', () => {
  assert.equal(roomAccent({ id: 'lobby', order: 0 }).getStyle(), roomAccent({ id: 'lobby', order: 5 }).getStyle());
  assert.equal(roomAccent({ id: 'lobby', order: 0 }).getHexString(), new Color(LOBBY_SHADE).getHexString());
});

test('room shades are purple or lilac, never amber-like, and the first four differ clearly', () => {
  for (const s of ROOM_SHADES) {
    const h = new Color(s).getHSL({}).h * 360;
    assert.ok(h >= 250 && h <= 305, `${s} hue ${h}`);
  }
  const hsl = ROOM_SHADES.slice(0, 4).map((s) => new Color(s).getHSL({}));
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++) {
      const dl = Math.abs(hsl[i].l - hsl[j].l);
      const dh = Math.abs(hsl[i].h - hsl[j].h) * 360;
      assert.ok(dl >= 0.12 || dh >= 15, `shades ${i} and ${j} are too close`);
    }
});

test('status colours are untouched', () => {
  assert.equal(STATUS_COLORS.waiting, '#f5a524');
});

test('carpets stay light in light mode and dark but not black in dark mode', () => {
  for (let o = 0; o < 8; o++) {
    assert.ok(roomCarpet({ id: 't', order: o }, 'light').getHSL({}).l >= 0.65);
    const l = roomCarpet({ id: 't', order: o }, 'dark').getHSL({}).l;
    assert.ok(l >= 0.12 && l <= 0.3, `dark carpet ${o} lightness ${l}`);
  }
});
