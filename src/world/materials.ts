import { BoxGeometry, CapsuleGeometry, Color, CylinderGeometry, MeshStandardMaterial, SphereGeometry, type BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PALETTES, type ThemeName, type WorldPalette } from './palette';
import { DETAIL } from './quality';

// Clay-like look: soft roughness, no metalness, so the whole floor reads as one
// physical model rather than a mix of styles.

const solid = new Map<string, MeshStandardMaterial>();

/** A shared material for a fixed colour (character parts, books, plants). */
export function clay(color: string, opts: { roughness?: number; emissive?: string; emissiveIntensity?: number } = {}) {
  const key = `${color}|${opts.roughness ?? 0.85}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? 0}`;
  let m = solid.get(key);
  if (!m) {
    m = new MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.85,
      metalness: 0,
      emissive: opts.emissive ? new Color(opts.emissive) : new Color(0),
      emissiveIntensity: opts.emissiveIntensity ?? 0,
    });
    // Plain colours can be baked into vertex colours when batched (see kit.ts).
    if (!opts.emissive) m.userData.bake = true;
    solid.set(key, m);
  }
  return m;
}

type ThemedKey = keyof Pick<WorldPalette, 'floor' | 'wall' | 'wallTrim' | 'wood' | 'woodDark' | 'metal' | 'chair' | 'screenOff' | 'lobbyLight' | 'lobbyAccent'>;

const themed = new Map<ThemedKey, MeshStandardMaterial>();
let currentTheme: ThemeName = 'light';

/** A shared material whose colour follows the theme (walls, desks, floor). */
export function themedMat(key: ThemedKey) {
  let m = themed.get(key);
  if (!m) {
    m = new MeshStandardMaterial({
      color: PALETTES[currentTheme][key],
      roughness: key === 'metal' ? 0.45 : 0.82,
      metalness: key === 'metal' ? 0.35 : 0,
    });
    themed.set(key, m);
  }
  return m;
}

export function applyThemeToMaterials(theme: ThemeName) {
  currentTheme = theme;
  for (const [key, m] of themed) m.color.set(PALETTES[theme][key]);
}

const geo = new Map<string, BufferGeometry>();
function cached<T extends BufferGeometry>(key: string, make: () => T): T {
  let g = geo.get(key) as T | undefined;
  if (!g) {
    g = make();
    geo.set(key, g);
  }
  return g;
}

export const G = {
  box: (w: number, h: number, d: number) => cached(`box${w},${h},${d}`, () => new BoxGeometry(w, h, d)),
  rbox: (w: number, h: number, d: number, r = 0.04) =>
    cached(`rbox${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 2 * DETAIL, r)),
  sphere: (r: number, w = 16, h = 12) => cached(`sph${r},${w},${h}`, () => new SphereGeometry(r, w * DETAIL, h * DETAIL)),
  hemi: (r: number) => cached(`hemi${r}`, () => new SphereGeometry(r, 18 * DETAIL, 8 * DETAIL, 0, Math.PI * 2, 0, Math.PI / 2)),
  capsule: (r: number, l: number) => cached(`cap${r},${l}`, () => new CapsuleGeometry(r, l, 3 * DETAIL, 10 * DETAIL)),
  cyl: (rt: number, rb: number, h: number, s = 14) => cached(`cyl${rt},${rb},${h},${s}`, () => new CylinderGeometry(rt, rb, h, s * DETAIL)),
};
