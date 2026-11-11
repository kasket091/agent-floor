import { BRAND } from './brand';
import { BoxGeometry, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, type BufferGeometry } from 'three';
import { Kit } from './kit';
import { clay, G, themedMat } from './materials';
import { clockMaterial, posterMaterial } from './textures';

// The furniture catalogue. Every prop is described into a Kit in its own local
// frame (origin on the floor, front facing +Z) and merged with the rest of the room.

// ---------------------------------------------------------------- materials

export const M = {
  white: () => clay('#f4f5f7', { roughness: 0.55 }),
  offWhite: () => clay('#e6e8ec'),
  black: () => clay('#22252b', { roughness: 0.45 }),
  charcoal: () => clay('#3a3f48'),
  // Fixed colours bake into one batched mesh; night comes from the lighting.
  steel: () => clay('#9aa3ae', { roughness: 0.45 }),
  wood: () => clay('#c9a77f', { roughness: 0.75 }),
  woodDark: () => clay('#8c6a4a', { roughness: 0.8 }),
  wall: () => themedMat('wall'),
  pot: () => clay('#d9d3c9'),
  potDark: () => clay('#4a4f57'),
  terracotta: () => clay('#c8734f'),
  soil: () => clay('#4b3a2c'),
  leaf: () => clay('#4f8a5b'),
  leafDark: () => clay('#386a45'),
  leafLight: () => clay('#79a86b'),
  cork: () => clay('#c9a26b'),
  paper: () => clay('#fbfaf6', { roughness: 0.9 }),
  cardboard: () => clay('#c49a6c'),
  screen: () => clay('#14181f', { roughness: 0.25 }),
  fridge: () => clay('#dfe3e8', { roughness: 0.35 }),
  tableGreen: () => clay('#2f7d5b'),
};

export const FABRICS = ['#4a6fa5', '#7d8f69', '#c8734f', '#d6a84f', '#5b5f6b', '#9b6b8e', '#3f7f7a', '#b55a4c'];
export const NOTE_COLORS = ['#ffe680', '#ffb3c1', '#a8e0ff', '#b9f2a1', '#ffd1a1'];
const BOOKS = ['#3d5a80', '#e07a5f', '#f2cc8f', '#81b29a', '#6d597a', '#e9ecf1', '#264653', '#b56576', '#2a9d8f'];

/** Glass for partitions, doors and windows. */
export const glassMat = new MeshStandardMaterial({
  color: '#cfe6f2',
  roughness: 0.08,
  metalness: 0.1,
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
  side: DoubleSide,
});

/** Bulbs glow above 1.0 at night so only they catch the bloom. */
export const bulbMat = new MeshBasicMaterial({ color: '#fff1d6', toneMapped: false });
const ledGreen = new MeshBasicMaterial({ color: '#4ade80', toneMapped: false });
const ledBlue = new MeshBasicMaterial({ color: '#60a5fa', toneMapped: false });
const ledAmber = new MeshBasicMaterial({ color: '#fbbf24', toneMapped: false });
const vendGlow = new MeshBasicMaterial({ color: '#dff3ff', toneMapped: false });

export function setNightGlow(night: boolean) {
  bulbMat.color.set(night ? '#ffe2b0' : '#f1eadc');
  if (night) bulbMat.color.multiplyScalar(3);
  for (const [m, c] of [[ledGreen, '#4ade80'], [ledBlue, '#60a5fa'], [ledAmber, '#fbbf24']] as const) {
    m.color.set(c);
    if (night) m.color.multiplyScalar(2.4);
  }
  vendGlow.color.set('#dff3ff');
  if (night) vendGlow.color.multiplyScalar(1.6);
  glassMat.opacity = night ? 0.14 : 0.2;
}

/** A flat floor plane with UVs scaled to world size, so tiles keep their size. */
export function floorGeo(w: number, d: number, tile: number): BufferGeometry {
  const g = new PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * d) / tile);
  return g;
}

/** A box whose UVs are scaled to its size (for textured slabs). */
export function texturedBox(w: number, h: number, d: number, tile: number) {
  const g = new BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const [a, b] = ay > 0.5 ? [w, d] : ax > 0.5 ? [d, h] : [w, h];
    uv.setXY(i, (uv.getX(i) * a) / tile, (uv.getY(i) * b) / tile);
  }
  return g;
}

let r = 1;
/** Deterministic pseudo-random for prop variety. Reseed per room. */
export function reseed(n: number) {
  r = (n % 2147483646) + 1;
}
export function rand() {
  r = (r * 16807) % 2147483647;
  return (r - 1) / 2147483646;
}
const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];

// ---------------------------------------------------------------- plants

export function plantTall(k: Kit, x: number, z: number, variant = Math.floor(rand() * 4)) {
  k.push(x, 0, z, rand() * Math.PI);
  const potM = variant % 2 ? M.pot() : M.terracotta();
  k.add(G.cyl(0.24, 0.18, 0.5, 20), potM, 0, 0.25, 0);
  k.add(G.cyl(0.21, 0.21, 0.02, 20), M.soil(), 0, 0.49, 0, { cast: false });
  if (variant === 0) {
    // Fiddle-leaf fig: a stem with big flat leaves.
    k.add(G.cyl(0.025, 0.03, 1.1, 8), M.woodDark(), 0, 1.0, 0);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.3;
      const y = 0.9 + i * 0.11;
      k.add(G.sphere(0.16, 12, 8), i % 2 ? M.leaf() : M.leafDark(), Math.cos(a) * 0.18, y, Math.sin(a) * 0.18, { sx: 1, sy: 0.4, sz: 1.5, ry: -a, rx: 0.5 });
    }
  } else if (variant === 1) {
    // Snake plant: upright blades.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const h = 0.6 + rand() * 0.45;
      k.add(G.rbox(0.07, h, 0.02, 0.01), i % 2 ? M.leafDark() : M.leaf(), Math.cos(a) * 0.08, 0.5 + h / 2, Math.sin(a) * 0.08, { ry: a, rz: Math.cos(a) * 0.15, rx: Math.sin(a) * 0.15 });
    }
  } else if (variant === 2) {
    // Round topiary.
    k.add(G.cyl(0.03, 0.03, 0.5, 8), M.woodDark(), 0, 0.75, 0);
    k.add(G.sphere(0.36, 18, 12), M.leaf(), 0, 1.2, 0);
    k.add(G.sphere(0.2, 14, 10), M.leafLight(), 0.16, 1.36, 0.1);
  } else {
    // Palm: drooping fronds.
    k.add(G.cyl(0.035, 0.05, 0.9, 8), M.woodDark(), 0, 0.92, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.add(G.capsule(0.06, 0.6), i % 2 ? M.leaf() : M.leafLight(), Math.cos(a) * 0.3, 1.32, Math.sin(a) * 0.3, { ry: -a, rz: 1.15, sz: 0.3 });
    }
  }
  k.pop();
}

export function plantSmall(k: Kit, x: number, y: number, z: number) {
  k.push(x, y, z, rand() * 3);
  k.add(G.cyl(0.07, 0.055, 0.12, 14), rand() > 0.5 ? M.pot() : M.terracotta(), 0, 0.06, 0);
  if (rand() > 0.5) {
    k.add(G.sphere(0.09, 12, 8), M.leaf(), 0, 0.17, 0);
    k.add(G.sphere(0.06, 10, 8), M.leafLight(), 0.05, 0.22, 0.02);
  } else {
    // Cactus
    k.add(G.capsule(0.04, 0.12), M.leafDark(), 0, 0.2, 0);
    k.add(G.capsule(0.022, 0.05), M.leafDark(), 0.05, 0.22, 0, { rz: -0.9 });
  }
  k.pop();
}

export function hangingPlant(k: Kit, x: number, y: number, z: number) {
  k.add(G.cyl(0.006, 0.006, 3.1 - y, 4), M.black(), x, (3.1 + y) / 2, z);
  k.add(G.cyl(0.13, 0.09, 0.14, 14), M.white(), x, y, z);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.add(G.capsule(0.035, 0.25), i % 2 ? M.leaf() : M.leafLight(), x + Math.cos(a) * 0.12, y - 0.12, z + Math.sin(a) * 0.12, { rz: Math.cos(a) * 0.4, rx: -Math.sin(a) * 0.4 });
  }
}

// ---------------------------------------------------------------- storage

export function bookshelf(k: Kit, x: number, z: number, ry: number, w = 1.0, h = 1.9) {
  k.push(x, 0, z, ry);
  const wood = M.woodDark();
  const d = 0.34;
  k.add(G.box(0.04, h, d), wood, -w / 2, h / 2, 0);
  k.add(G.box(0.04, h, d), wood, w / 2, h / 2, 0);
  k.add(G.box(w, 0.04, d), wood, 0, h, 0);
  k.add(G.box(w, 0.02, 0.02), wood, 0, h / 2, -d / 2 + 0.01, { sy: h / 0.02 });
  const shelves = Math.round(h / 0.42);
  for (let s = 0; s < shelves; s++) {
    const y = 0.06 + s * (h / shelves);
    k.add(G.box(w, 0.03, d), wood, 0, y, 0);
    let bx = -w / 2 + 0.05;
    while (bx < w / 2 - 0.08) {
      const roll = rand();
      if (roll < 0.1 && bx < w / 2 - 0.25) {
        plantSmall(k, bx + 0.09, y + 0.015, 0);
        bx += 0.2;
        continue;
      }
      if (roll < 0.17 && bx < w / 2 - 0.25) {
        k.add(G.rbox(0.2, 0.16, 0.24, 0.01), M.cardboard(), bx + 0.1, y + 0.095, 0);
        bx += 0.24;
        continue;
      }
      const t = 0.03 + rand() * 0.035;
      const bh = 0.2 + rand() * 0.12;
      const lean = roll > 0.93 ? 0.25 : 0;
      k.add(G.box(t, bh, 0.22), M.paper(), bx + t / 2, y + 0.015 + bh / 2, 0.005, { rz: lean });
      k.add(G.box(t + 0.004, bh + 0.004, 0.2), clay(pick(BOOKS)), bx + t / 2, y + 0.015 + bh / 2, 0.02, { rz: lean });
      bx += t + 0.006 + (lean ? 0.06 : 0);
    }
  }
  k.pop();
}

export function credenza(k: Kit, x: number, z: number, ry: number, w = 1.8) {
  k.push(x, 0, z, ry);
  k.add(G.rbox(w, 0.7, 0.48, 0.02), M.wood(), 0, 0.4, 0);
  for (let i = 0; i < Math.floor(w / 0.45); i++) {
    const dx = -w / 2 + 0.225 + i * 0.45;
    k.add(G.box(0.42, 0.6, 0.01), M.offWhite(), dx, 0.4, 0.245);
    k.add(G.box(0.12, 0.015, 0.02), M.steel(), dx, 0.6, 0.26);
  }
  for (const s of [-1, 1]) k.add(G.cyl(0.015, 0.015, 0.06, 6), M.black(), s * (w / 2 - 0.06), 0.03, 0);
  // Things on top
  printer(k, -w / 2 + 0.35, 0.75, 0);
  plantSmall(k, w / 2 - 0.15, 0.75, 0);
  k.add(G.box(0.24, 0.05, 0.3), M.paper(), 0.1, 0.78, 0);
  k.add(G.box(0.24, 0.05, 0.3), clay('#cfd8e3'), 0.1, 0.83, 0, { ry: 0.2 });
  k.pop();
}

export function fileCabinet(k: Kit, x: number, z: number, ry: number) {
  k.push(x, 0, z, ry);
  k.add(G.rbox(0.46, 1.05, 0.55, 0.02), M.charcoal(), 0, 0.525, 0);
  for (let i = 0; i < 3; i++) {
    k.add(G.box(0.4, 0.3, 0.01), M.steel(), 0, 0.2 + i * 0.33, 0.28);
    k.add(G.box(0.14, 0.02, 0.03), M.offWhite(), 0, 0.3 + i * 0.33, 0.29);
  }
  plantSmall(k, 0, 1.05, 0);
  k.pop();
}

export function boxes(k: Kit, x: number, z: number, ry: number) {
  k.push(x, 0, z, ry);
  k.add(G.rbox(0.5, 0.36, 0.4, 0.015), M.cardboard(), 0, 0.18, 0);
  k.add(G.rbox(0.42, 0.3, 0.36, 0.015), M.cardboard(), 0.03, 0.51, 0, { ry: 0.25 });
  k.add(G.box(0.36, 0.005, 0.06), clay('#d9b98e'), 0.03, 0.665, 0, { ry: 0.25 });
  k.pop();
}

// ---------------------------------------------------------------- seating

export function sofa(k: Kit, x: number, z: number, ry: number, w = 2.0, color = pick(FABRICS)) {
  k.push(x, 0, z, ry);
  const f = clay(color, { roughness: 0.95 });
  const seats = Math.max(2, Math.round(w / 0.75));
  k.add(G.rbox(w, 0.22, 0.85, 0.05), f, 0, 0.24, 0);
  for (let i = 0; i < seats; i++) {
    const cw = (w - 0.3) / seats;
    const cx = -w / 2 + 0.15 + cw * (i + 0.5);
    k.add(G.rbox(cw - 0.02, 0.14, 0.62, 0.06), f, cx, 0.42, 0.08);
    k.add(G.rbox(cw - 0.04, 0.42, 0.18, 0.08), f, cx, 0.62, -0.3, { rx: -0.12 });
  }
  for (const s of [-1, 1]) k.add(G.rbox(0.16, 0.5, 0.85, 0.06), f, s * (w / 2 - 0.08), 0.4, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(G.cyl(0.025, 0.02, 0.13, 8), M.woodDark(), sx * (w / 2 - 0.1), 0.065, sz * 0.35);
  // A cushion of a different colour
  k.add(G.rbox(0.36, 0.34, 0.12, 0.06), clay(pick(FABRICS)), -w / 2 + 0.4, 0.62, -0.12, { rz: 0.15, rx: -0.2 });
  k.pop();
}

export function armchair(k: Kit, x: number, z: number, ry: number, color = pick(FABRICS)) {
  k.push(x, 0, z, ry);
  const f = clay(color, { roughness: 0.95 });
  k.add(G.rbox(0.8, 0.2, 0.78, 0.05), f, 0, 0.26, 0);
  k.add(G.rbox(0.56, 0.14, 0.58, 0.06), f, 0, 0.42, 0.06);
  k.add(G.rbox(0.72, 0.5, 0.16, 0.07), f, 0, 0.65, -0.3, { rx: -0.15 });
  for (const s of [-1, 1]) k.add(G.rbox(0.12, 0.42, 0.74, 0.05), f, s * 0.34, 0.42, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(G.cyl(0.02, 0.015, 0.16, 8), M.woodDark(), sx * 0.32, 0.08, sz * 0.3);
  k.pop();
}

export function chair(k: Kit, x: number, z: number, ry: number, color = '#2d3340') {
  k.push(x, 0, z, ry);
  const c = clay(color);
  k.add(G.rbox(0.42, 0.05, 0.42, 0.02), c, 0, 0.46, 0);
  k.add(G.rbox(0.42, 0.36, 0.04, 0.02), c, 0, 0.7, -0.19, { rx: -0.08 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(G.cyl(0.015, 0.015, 0.46, 6), M.steel(), sx * 0.18, 0.23, sz * 0.18);
  k.pop();
}

export function stool(k: Kit, x: number, z: number) {
  k.add(G.cyl(0.18, 0.17, 0.06, 16), M.woodDark(), x, 0.72, z);
  k.add(G.cyl(0.02, 0.025, 0.7, 8), M.steel(), x, 0.36, z);
  k.add(G.cyl(0.15, 0.15, 0.015, 16), M.steel(), x, 0.3, z, { cast: false });
  k.add(G.cyl(0.17, 0.18, 0.02, 16), M.steel(), x, 0.01, z);
}

export function beanbag(k: Kit, x: number, z: number, color = pick(FABRICS)) {
  k.add(G.sphere(0.42, 18, 12), clay(color, { roughness: 1 }), x, 0.24, z, { sy: 0.6 });
  k.add(G.sphere(0.3, 14, 10), clay(color, { roughness: 1 }), x, 0.4, z - 0.16, { sy: 0.7 });
}

// ---------------------------------------------------------------- tables

export function coffeeTable(k: Kit, x: number, z: number, ry: number, w = 1.0, d = 0.55) {
  k.push(x, 0, z, ry);
  k.add(G.rbox(w, 0.05, d, 0.02), M.wood(), 0, 0.4, 0);
  k.add(G.rbox(w - 0.1, 0.02, d - 0.1, 0.01), M.woodDark(), 0, 0.15, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(G.cyl(0.02, 0.02, 0.4, 6), M.black(), sx * (w / 2 - 0.06), 0.2, sz * (d / 2 - 0.06));
  k.add(G.box(0.24, 0.015, 0.32), clay(pick(BOOKS)), -w / 4, 0.432, 0, { ry: 0.3 });
  k.add(G.box(0.22, 0.015, 0.3), clay(pick(BOOKS)), -w / 4, 0.447, 0, { ry: 0.15 });
  k.add(G.cyl(0.04, 0.035, 0.09, 12), clay(pick(FABRICS)), w / 4, 0.47, 0.05);
  plantSmall(k, w / 4 - 0.15, 0.425, -0.1);
  k.pop();
}

export function sideTable(k: Kit, x: number, z: number) {
  k.add(G.cyl(0.22, 0.22, 0.03, 18), M.wood(), x, 0.52, z);
  k.add(G.cyl(0.02, 0.02, 0.5, 8), M.black(), x, 0.26, z);
  k.add(G.cyl(0.16, 0.16, 0.02, 16), M.black(), x, 0.01, z);
  k.add(G.cyl(0.04, 0.035, 0.09, 12), M.white(), x + 0.05, 0.58, z);
}

export function roundTable(k: Kit, x: number, z: number, chairs = 3) {
  k.add(G.cyl(0.5, 0.5, 0.04, 28), M.white(), x, 0.74, z);
  k.add(G.cyl(0.04, 0.05, 0.72, 10), M.black(), x, 0.37, z);
  k.add(G.cyl(0.26, 0.28, 0.03, 20), M.black(), x, 0.015, z);
  const color = pick(FABRICS);
  for (let i = 0; i < chairs; i++) {
    const a = (i / chairs) * Math.PI * 2 + 0.4;
    chair(k, x + Math.cos(a) * 0.72, z + Math.sin(a) * 0.72, -a - Math.PI / 2, color);
  }
  k.add(G.cyl(0.04, 0.035, 0.09, 12), clay('#e07a5f'), x + 0.1, 0.8, z);
  k.add(G.box(0.2, 0.01, 0.28), M.paper(), x - 0.12, 0.765, z + 0.05, { ry: 0.4 });
}

export function meetingTable(k: Kit, x: number, z: number, ry: number, w = 2.6) {
  k.push(x, 0, z, ry);
  k.add(G.rbox(w, 0.06, 1.1, 0.03), M.wood(), 0, 0.74, 0);
  for (const s of [-1, 1]) k.add(G.rbox(0.08, 0.7, 0.8, 0.02), M.charcoal(), s * (w / 2 - 0.35), 0.36, 0);
  const n = Math.floor(w / 0.75);
  const color = pick(FABRICS);
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + 0.4 + i * ((w - 0.8) / Math.max(1, n - 1));
    chair(k, cx, -0.78, 0, color);
    chair(k, cx, 0.78, Math.PI, color);
    if (rand() > 0.5) k.add(G.rbox(0.32, 0.015, 0.22, 0.005), M.charcoal(), cx, 0.78, 0.3 * (rand() > 0.5 ? 1 : -1));
  }
  k.add(G.cyl(0.08, 0.08, 0.04, 16), M.black(), 0, 0.79, 0); // speakerphone
  k.pop();
}

// ---------------------------------------------------------------- lights

export function floorLamp(k: Kit, x: number, z: number) {
  k.add(G.cyl(0.16, 0.18, 0.03, 18), M.black(), x, 0.015, z);
  k.add(G.cyl(0.015, 0.015, 1.5, 8), M.black(), x, 0.77, z);
  k.add(G.cyl(0.14, 0.22, 0.3, 20), clay('#f1e6d3', { roughness: 1 }), x, 1.55, z);
  k.add(G.sphere(0.06, 10, 8), bulbMat, x, 1.48, z, { cast: false });
}

export function pendant(k: Kit, x: number, z: number, y = 2.35, color = '#22252b') {
  k.add(G.cyl(0.006, 0.006, 3.2 - y, 4), M.black(), x, (3.2 + y) / 2 + 0.1, z, { cast: false });
  k.add(G.hemi(0.22), clay(color, { roughness: 0.5 }), x, y, z, { cast: false });
  k.add(G.sphere(0.07, 10, 8), bulbMat, x, y - 0.02, z, { cast: false });
}

// ---------------------------------------------------------------- office equipment

export function printer(k: Kit, x: number, y: number, z: number) {
  k.add(G.rbox(0.42, 0.2, 0.36, 0.03), M.offWhite(), x, y + 0.1, z);
  k.add(G.box(0.3, 0.02, 0.12), M.charcoal(), x, y + 0.21, z - 0.05);
  k.add(G.box(0.22, 0.01, 0.16), M.paper(), x, y + 0.15, z + 0.2);
  k.add(G.box(0.06, 0.02, 0.03), ledGreen, x + 0.14, y + 0.205, z + 0.12, { cast: false });
}

export function waterCooler(k: Kit, x: number, z: number, ry: number) {
  k.push(x, 0, z, ry);
  k.add(G.rbox(0.32, 0.95, 0.32, 0.03), M.white(), 0, 0.475, 0);
  k.add(G.box(0.2, 0.12, 0.02), M.charcoal(), 0, 0.72, 0.16);
  k.add(G.cyl(0.13, 0.13, 0.36, 18), clay('#8fc7ea', { roughness: 0.1 }), 0, 1.13, 0);
  k.add(G.cyl(0.05, 0.13, 0.08, 18), clay('#8fc7ea', { roughness: 0.1 }), 0, 0.92, 0);
  k.add(G.cyl(0.03, 0.025, 0.08, 10), M.paper(), 0.2, 0.9, 0.05);
  k.pop();
}

export function trashBin(k: Kit, x: number, z: number) {
  k.add(G.cyl(0.13, 0.11, 0.34, 16), M.charcoal(), x, 0.17, z);
  k.add(G.sphere(0.04, 8, 6), M.paper(), x + 0.03, 0.33, z, { cast: false });
}

export function coatRack(k: Kit, x: number, z: number) {
  k.add(G.cyl(0.18, 0.2, 0.03, 16), M.black(), x, 0.015, z);
  k.add(G.cyl(0.02, 0.02, 1.75, 8), M.woodDark(), x, 0.88, z);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    k.add(G.capsule(0.012, 0.14), M.woodDark(), x + Math.cos(a) * 0.08, 1.68, z + Math.sin(a) * 0.08, { rz: Math.cos(a) * 0.9, rx: -Math.sin(a) * 0.9 });
  }
  k.add(G.capsule(0.12, 0.6), clay(pick(FABRICS)), x + 0.14, 1.28, z, { sx: 1, sz: 0.55 });
  k.add(G.cyl(0.12, 0.14, 0.1, 16), clay('#3a3f48'), x - 0.1, 1.72, z, { rz: 0.3 });
}

export function serverRack(k: Kit, x: number, z: number, ry: number) {
  k.push(x, 0, z, ry);
  k.add(G.rbox(0.62, 2.0, 0.8, 0.02), M.black(), 0, 1.0, 0);
  for (let u = 0; u < 12; u++) {
    const y = 0.25 + u * 0.14;
    k.add(G.box(0.54, 0.11, 0.01), M.charcoal(), 0, y, 0.405);
    const leds = [ledGreen, ledBlue, ledAmber];
    for (let l = 0; l < 4; l++) if (rand() > 0.35) k.add(G.box(0.02, 0.02, 0.01), leds[(u + l) % 3 === 2 && rand() > 0.6 ? 2 : (u + l) % 2], 0.18 + l * 0.03, y, 0.412, { cast: false });
  }
  k.pop();
}

export function vendingMachine(k: Kit, x: number, z: number, ry: number) {
  k.push(x, 0, z, ry);
  k.add(G.rbox(0.9, 1.9, 0.75, 0.03), clay('#d64545'), 0, 0.95, 0);
  k.add(G.box(0.6, 1.3, 0.01), vendGlow, -0.08, 1.15, 0.38, { cast: false });
  for (let row = 0; row < 5; row++)
    for (let c = 0; c < 4; c++) k.add(G.cyl(0.04, 0.04, 0.16, 10), clay(pick(['#f2cc8f', '#4a6fa5', '#81b29a', '#e07a5f', '#ffffff'])), -0.3 + c * 0.14, 0.62 + row * 0.25, 0.3);
  k.add(G.box(0.16, 0.5, 0.02), M.charcoal(), 0.33, 1.25, 0.38);
  k.add(G.box(0.6, 0.16, 0.02), M.black(), -0.08, 0.28, 0.38);
  k.pop();
}

// ---------------------------------------------------------------- walls things

export function kanban(k: Kit, x: number, y: number, z: number, ry: number, w = 1.8) {
  k.push(x, y, z, ry);
  k.add(G.rbox(w + 0.06, 1.0, 0.04, 0.01), M.woodDark(), 0, 0, 0);
  k.add(G.box(w, 0.94, 0.01), M.cork(), 0, 0, 0.022, { cast: false });
  const cols = 3;
  for (let c = 0; c < cols; c++) {
    const cx = -w / 2 + (w / cols) * (c + 0.5);
    k.add(G.box(w / cols - 0.1, 0.06, 0.005), M.paper(), cx, 0.38, 0.03, { cast: false });
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      k.add(G.box(0.16, 0.16, 0.006), clay(pick(NOTE_COLORS)), cx + (i % 2 ? 0.1 : -0.1), 0.2 - Math.floor(i / 2) * 0.22, 0.03, { rz: (rand() - 0.5) * 0.15, cast: false });
    }
  }
  k.pop();
}

export function poster(k: Kit, x: number, y: number, z: number, ry: number, i = Math.floor(rand() * 6), w = 0.6, h = 0.8) {
  k.push(x, y, z, ry);
  k.add(G.box(w + 0.05, h + 0.05, 0.03), M.black(), 0, 0, 0);
  k.add(new PlaneGeometry(w, h), posterMaterial(i), 0, 0, 0.017, { cast: false });
  k.pop();
}

export function clock(k: Kit, x: number, y: number, z: number, ry: number) {
  k.push(x, y, z, ry);
  k.add(G.cyl(0.2, 0.2, 0.05, 28), M.black(), 0, 0, 0, { rx: Math.PI / 2 });
  k.add(new PlaneGeometry(0.36, 0.36), clockMaterial(), 0, 0, 0.027, { cast: false });
  k.pop();
}

export function tv(k: Kit, x: number, z: number, ry: number) {
  k.push(x, 0, z, ry);
  k.add(G.rbox(1.6, 0.45, 0.42, 0.02), M.woodDark(), 0, 0.25, 0);
  k.add(G.box(0.7, 0.3, 0.01), M.wood(), -0.38, 0.25, 0.21);
  k.add(G.rbox(1.4, 0.8, 0.05, 0.02), M.black(), 0, 1.0, -0.08);
  k.add(G.box(1.32, 0.72, 0.01), M.screen(), 0, 1.0, -0.05, { cast: false });
  k.add(G.box(0.2, 0.1, 0.12), M.black(), 0.45, 0.52, 0.05);
  plantSmall(k, -0.65, 0.475, 0);
  k.pop();
}

// ---------------------------------------------------------------- kitchen

export function kitchenRun(k: Kit, x: number, z: number, ry: number, w = 4) {
  k.push(x, 0, z, ry);
  // Fridge at the left end
  k.add(G.rbox(0.8, 2.0, 0.7, 0.03), M.fridge(), -w / 2 + 0.4, 1.0, 0);
  k.add(G.box(0.02, 0.5, 0.04), M.steel(), -w / 2 + 0.72, 1.35, 0.36);
  k.add(G.box(0.02, 0.3, 0.04), M.steel(), -w / 2 + 0.72, 0.65, 0.36);
  k.add(G.box(0.78, 0.01, 0.01), M.steel(), -w / 2 + 0.4, 0.95, 0.355);
  const run = w - 0.85;
  const cx = -w / 2 + 0.85 + run / 2;
  // Base cabinets + counter
  k.add(G.box(run, 0.82, 0.6), M.white(), cx, 0.41, 0);
  k.add(G.rbox(run + 0.02, 0.05, 0.64, 0.01), M.charcoal(), cx, 0.845, 0.01);
  for (let i = 0; i < Math.floor(run / 0.6); i++) {
    const dx = -w / 2 + 0.85 + 0.3 + i * 0.6;
    k.add(G.box(0.56, 0.74, 0.01), M.offWhite(), dx, 0.42, 0.305);
    k.add(G.box(0.14, 0.015, 0.02), M.steel(), dx, 0.7, 0.315);
  }
  // Upper cabinets on the wall
  k.add(G.box(run, 0.7, 0.36), M.white(), cx, 1.85, -0.12);
  // Backsplash tiles
  k.add(G.box(run, 0.6, 0.01), clay('#d7e3ea'), cx, 1.17, -0.3, { cast: false });
  // Sink + tap
  const sx = cx + run * 0.15;
  k.add(G.box(0.5, 0.02, 0.38), M.steel(), sx, 0.872, 0.02, { cast: false });
  k.add(G.cyl(0.015, 0.015, 0.3, 8), M.steel(), sx, 1.02, -0.18);
  k.add(G.capsule(0.012, 0.14), M.steel(), sx, 1.16, -0.12, { rx: Math.PI / 2 });
  // Coffee machine, kettle, microwave, fruit
  const ex = cx - run * 0.3;
  k.add(G.rbox(0.32, 0.42, 0.36, 0.03), M.black(), ex, 1.08, -0.05);
  k.add(G.box(0.2, 0.08, 0.02), M.steel(), ex, 1.0, 0.13);
  k.add(G.cyl(0.04, 0.035, 0.09, 12), M.white(), ex, 0.92, 0.1);
  k.add(G.cyl(0.08, 0.1, 0.22, 16), M.steel(), ex + 0.35, 0.98, 0);
  k.add(G.rbox(0.52, 0.3, 0.38, 0.02), M.charcoal(), cx + run * 0.4, 1.02, -0.05);
  k.add(G.box(0.3, 0.2, 0.01), M.screen(), cx + run * 0.4 - 0.05, 1.02, 0.145);
  k.add(G.cyl(0.14, 0.08, 0.08, 18), M.white(), sx - 0.6, 0.91, 0.05);
  for (let i = 0; i < 4; i++) k.add(G.sphere(0.045, 10, 8), clay(['#e05a3a', '#f2c14f', '#7cb342', '#e05a3a'][i]), sx - 0.6 + (i % 2) * 0.06 - 0.03, 0.97 + Math.floor(i / 2) * 0.04, 0.05 + (i > 1 ? 0.03 : -0.02));
  k.pop();
}

export function island(k: Kit, x: number, z: number, ry: number, w = 2.2) {
  k.push(x, 0, z, ry);
  k.add(G.box(w - 0.3, 0.88, 0.7), M.wood(), 0, 0.44, 0);
  k.add(G.rbox(w, 0.05, 1.0, 0.02), M.white(), 0, 0.905, 0.1);
  for (let i = 0; i < 3; i++) stool(k, -w / 2 + 0.4 + i * ((w - 0.8) / 2), 0.85);
  k.add(G.cyl(0.04, 0.035, 0.09, 12), clay('#3d5a80'), 0.3, 0.97, 0.3);
  plantSmall(k, -0.5, 0.93, 0.15);
  k.pop();
}

// ---------------------------------------------------------------- lobby

export function receptionDesk(k: Kit, x: number, z: number, ry: number, w = 2.8) {
  k.push(x, 0, z, ry);
  k.add(G.rbox(w, 1.05, 0.5, 0.04), clay(BRAND.purple), 0, 0.525, 0.3);
  k.add(G.box(w - 0.1, 0.06, 0.02), clay(BRAND.lilac), 0, 0.82, 0.56, { cast: false });
  k.add(G.rbox(w + 0.1, 0.04, 0.62, 0.02), clay(BRAND.amber, { roughness: 0.5 }), 0, 1.07, 0.3);
  k.add(G.rbox(w, 0.75, 0.6, 0.02), clay(BRAND.purple), 0, 0.375, -0.2);
  k.add(G.rbox(0.5, 0.32, 0.03, 0.01), M.black(), -0.4, 1.05, -0.2, { ry: 0.2 });
  k.add(G.box(0.46, 0.27, 0.01), M.screen(), -0.4, 1.05, -0.182, { ry: 0.2, cast: false });
  plantSmall(k, w / 2 - 0.25, 1.09, 0.3);
  chair(k, -0.4, -0.65, Math.PI, '#2d3340');
  k.pop();
}

// ---------------------------------------------------------------- games

export function pingPong(k: Kit, x: number, z: number, ry: number) {
  k.push(x, 0, z, ry);
  k.add(G.box(2.74, 0.04, 1.52), M.tableGreen(), 0, 0.76, 0);
  k.add(G.box(2.74, 0.005, 0.02), M.white(), 0, 0.782, 0, { cast: false });
  k.add(G.box(0.02, 0.005, 1.52), M.white(), 0, 0.782, 0, { cast: false });
  k.add(G.box(0.01, 0.15, 1.6), M.white(), 0, 0.85, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(G.box(0.05, 0.74, 0.05), M.black(), sx * 1.2, 0.37, sz * 0.62);
  k.add(G.cyl(0.08, 0.08, 0.015, 14), clay('#d64545'), -0.8, 0.79, 0.4);
  k.add(G.cyl(0.08, 0.08, 0.015, 14), clay('#3d5a80'), 0.9, 0.79, -0.35);
  k.add(G.sphere(0.02, 8, 6), clay('#ff9b4a'), 0.3, 0.8, 0.2);
  k.pop();
}

// ---------------------------------------------------------------- outdoors

export function tree(k: Kit, x: number, z: number, s = 1) {
  k.add(G.cyl(0.09 * s, 0.13 * s, 1.6 * s, 10), M.woodDark(), x, 0.8 * s, z);
  const tones = [M.leaf(), M.leafDark(), M.leafLight()];
  k.add(G.sphere(0.9 * s, 16, 12), tones[0], x, 2.1 * s, z);
  k.add(G.sphere(0.65 * s, 14, 10), tones[1], x + 0.5 * s, 2.5 * s, z + 0.2 * s);
  k.add(G.sphere(0.6 * s, 14, 10), tones[2], x - 0.4 * s, 2.6 * s, z - 0.2 * s);
}

export function bush(k: Kit, x: number, z: number, s = 1) {
  k.add(G.sphere(0.45 * s, 14, 10), M.leaf(), x, 0.3 * s, z, { sy: 0.75 });
  k.add(G.sphere(0.3 * s, 12, 8), M.leafLight(), x + 0.3 * s, 0.32 * s, z + 0.1 * s, { sy: 0.8 });
}

export function lampPost(k: Kit, x: number, z: number) {
  k.add(G.cyl(0.05, 0.07, 3.2, 10), M.charcoal(), x, 1.6, z);
  k.add(G.cyl(0.18, 0.12, 0.12, 14), M.charcoal(), x, 3.25, z);
  k.add(G.sphere(0.12, 10, 8), bulbMat, x, 3.15, z, { cast: false });
}

export function bench(k: Kit, x: number, z: number, ry: number) {
  k.push(x, 0, z, ry);
  for (let i = 0; i < 4; i++) k.add(G.box(1.6, 0.04, 0.09), M.wood(), 0, 0.45, -0.18 + i * 0.12);
  for (let i = 0; i < 2; i++) k.add(G.box(1.6, 0.09, 0.04), M.wood(), 0, 0.62 + i * 0.13, -0.26, { rx: -0.15 });
  for (const s of [-1, 1]) k.add(G.box(0.06, 0.45, 0.5), M.charcoal(), s * 0.7, 0.22, 0);
  k.pop();
}
