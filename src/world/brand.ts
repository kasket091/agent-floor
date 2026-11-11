import { Color } from 'three';
import { PALETTES, type ThemeName } from './palette.ts';

// Digital Recipe brand values, from digitalrecipe.com.au (Elementor globals, 2026-11-12).
// See docs/superpowers/specs/2026-11-12-digital-recipe-brand-design.md.
export const BRAND = {
  purple: '#5A15A0',
  ink: '#140524',
  amber: '#FCB80D', // reception desk top and primary buttons only: it is close to the "Needs you" status amber
  lilac: '#C5A8E3',
  paleLilac: '#EBE0F6',
  white: '#FFFFFF',
} as const;

/** Room colours: purple and lilac only, alternating deep and light so the first rooms differ most. */
export const ROOM_SHADES: readonly string[] = [
  BRAND.purple,
  BRAND.lilac,
  '#2E0A55',
  '#9D6BD8',
  '#7B3FC4',
  '#DCC9F0',
  '#6B2F8F',
  '#B488D9',
];

/** The Lobby room (where every Claude session starts) has its own fixed colour. */
export const LOBBY_SHADE = '#D9C8EE';

type RoomRef = { id: string; order: number };

const shadeOf = (team: RoomRef) => (team.id === 'lobby' ? LOBBY_SHADE : ROOM_SHADES[team.order % ROOM_SHADES.length]);

export function roomAccent(team: RoomRef) {
  return new Color(shadeOf(team));
}

/** Carpet: the shade's hue at the theme's carpet lightness, nudged by the shade so rooms differ. */
export function roomCarpet(team: RoomRef, theme: ThemeName) {
  const p = PALETTES[theme];
  const { h, l } = new Color(shadeOf(team)).getHSL({ h: 0, s: 0, l: 0 });
  const nudged = p.carpetLightness + (l - 0.5) * 0.1;
  const light = theme === 'dark' ? Math.min(0.3, Math.max(0.12, nudged)) : Math.max(0.65, nudged);
  return new Color().setHSL(h, p.carpetSaturation, light);
}
