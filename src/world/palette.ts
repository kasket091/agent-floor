import type { Status } from '../../shared/protocol';
import { BRAND } from './brand.ts';

export type ThemeName = 'light' | 'dark';

export interface WorldPalette {
  sky: string;
  skyHorizon: string;
  floor: string;
  wall: string;
  wallTrim: string;
  wood: string;
  woodDark: string;
  metal: string;
  chair: string;
  screenOff: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunColor: string;
  sunIntensity: number;
  lampIntensity: number;
  bloom: number;
  carpetLightness: number;
  carpetSaturation: number;
  /** Lobby brand pieces (logo-wall frame, reception rug, waiting rug). Literals, not BRAND: brand.ts imports this file. */
  lobbyLight: string;
  lobbyAccent: string;
}

export const PALETTES: Record<ThemeName, WorldPalette> = {
  light: {
    sky: '#e7ebf0',
    skyHorizon: '#f4f6f8',
    floor: '#e9edf1',
    wall: '#f7f8fa',
    wallTrim: '#d9dee5',
    wood: '#c9a77f',
    woodDark: '#8c6a4a',
    metal: '#9aa3ae',
    chair: '#2d3340',
    screenOff: '#1b1f27',
    hemiSky: '#ffffff',
    hemiGround: '#c4ccd6',
    hemiIntensity: 1.55,
    sunColor: '#fff4e6',
    sunIntensity: 2.3,
    lampIntensity: 0.25,
    bloom: 0.12,
    carpetLightness: 0.76,
    carpetSaturation: 0.45,
    lobbyLight: '#EBE0F6',
    lobbyAccent: '#C5A8E3',
  },
  dark: {
    sky: '#0b0e13',
    skyHorizon: '#131821',
    floor: '#141920',
    wall: '#1d232c',
    wallTrim: '#2a313c',
    wood: '#6b5440',
    woodDark: '#3e3026',
    metal: '#5d6672',
    chair: '#11141a',
    screenOff: '#07090c',
    hemiSky: '#8fa3c7',
    hemiGround: '#1a1f27',
    hemiIntensity: 0.8,
    sunColor: '#9fb4ff',
    sunIntensity: 0.7,
    lampIntensity: 1.6,
    bloom: 0.9,
    carpetLightness: 0.2,
    carpetSaturation: 0.22,
    lobbyLight: '#2A1446',
    lobbyAccent: '#3B1D63',
  },
};

/** Semantic status colours. Used on screens, badges and name tags. */
export const STATUS_COLORS: Record<Status, string> = {
  idle: '#8a94a6',
  thinking: '#38bdf8',
  working: '#3b82f6',
  waiting: '#f5a524',
  done: '#22c55e',
  error: '#ef4444',
  offline: '#5b6170',
};

export const STATUS_LABEL: Record<Status, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  working: 'Working',
  waiting: 'Needs you',
  done: 'Done',
  error: 'Error',
  offline: 'Left',
};

export const ACCENT = '#ff5f2e';

/** Shirt colours, keyed by role so the same role looks the same in every team. */
const SHIRTS = ['#3d5a80', '#e07a5f', '#81b29a', '#f2cc8f', '#6d597a', '#457b9d', '#e76f51', '#2a9d8f', '#bc6c25', '#577590', '#d62828', '#4d908e'];
const SKIN = ['#f1c7a5', '#e0ac85', '#c68863', '#9c6644', '#7a4a2e', '#f6d5bd', '#d9a066'];
const HAIR = ['#1f1a17', '#3b2a20', '#6b4423', '#a5682a', '#d9b26f', '#b6b6b6', '#2f2f3a', '#7c2d12'];

export function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function shirtFor(role: string) {
  const key = role.toLowerCase();
  return key === 'lead' ? BRAND.purple : SHIRTS[hash(key) % SHIRTS.length];
}

export function looksFor(id: string) {
  const h = hash(id);
  return {
    skin: SKIN[h % SKIN.length],
    hair: HAIR[(h >>> 4) % HAIR.length],
    hairStyle: (h >>> 8) % 5,
    glasses: ((h >>> 12) & 7) === 0,
    pants: ['#2b2f3a', '#3a4252', '#4a3f35', '#23324a'][(h >>> 14) % 4],
  };
}

export function sourceLabel(source: string) {
  const map: Record<string, string> = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    cursor: 'Cursor',
    cli: 'CLI',
    custom: 'Custom',
  };
  return map[source] || source;
}
