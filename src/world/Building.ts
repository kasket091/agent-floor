import { Group, MeshStandardMaterial, PlaneGeometry, Vector3, type Camera } from 'three';
import { disposeKit, Kit } from './kit';
import { clay, G } from './materials';
import { BRAND } from './brand';
import { damp } from './motion';
import { PALETTES, hash, type ThemeName } from './palette';
import {
  armchair,
  beanbag,
  bench,
  bookshelf,
  boxes,
  bush,
  chair,
  clock,
  coffeeTable,
  FABRICS,
  floorGeo,
  floorLamp,
  glassMat,
  hangingPlant,
  island,
  kanban,
  kitchenRun,
  lampPost,
  M,
  meetingTable,
  pendant,
  pingPong,
  plantSmall,
  plantTall,
  poster,
  rand,
  receptionDesk,
  reseed,
  roundTable,
  sideTable,
  sofa,
  texturedBox,
  tree,
  tv,
  vendingMachine,
  waterCooler,
} from './props';
import { grass, logoMaterial, paving, planks, terrazzo } from './textures';
import { CORRIDOR, LOBBY_WIDTH, OFFICE_D, SEGMENT, WALL_H, type AmenityKind, type BuildingLayout } from './layout';

const T = 0.16; // wall thickness
const LOW = 0.55; // cut-away walls on the camera side
const SILL = 0.85;
const HEAD = 2.45;
const YARD = 22; // lawn beyond the walls
const DEPTH = CORRIDOR + OFFICE_D * 2;
const Z0 = -DEPTH / 2;
const Z1 = DEPTH / 2;

interface Unit {
  id: string;
  kind: 'office' | AmenityKind;
  side: 'north' | 'south';
  x0: number;
  w: number;
  /** Door position measured from the unit's west edge. */
  door?: number;
  open?: boolean;
}

interface Section {
  key: string;
  group: Group;
  /** Tall-wall pieces that fade when the camera is behind them. */
  tall?: Group;
}

/**
 * The building shell and the shared spaces, built as cached sections so a new
 * team never triggers a full rebuild:
 *   - fixed-width segments (walls, windows, corridor, lawn, trees), cached by index
 *   - a cap for the partial last segment and the east end
 *   - one section per office or shared room (partition, corridor glass, furniture),
 *     cached by shape and simply moved when its position changes
 *   - the lobby and the street, built once
 */
export class Building {
  readonly root = new Group();
  private layout: BuildingLayout | null = null;
  private segments = new Map<number, Section>();
  private cap: Section | null = null;
  private units = new Map<string, Section>();
  private lobby: Section | null = null;
  private theme: ThemeName = 'light';

  // Tall exterior walls get their own material instances so they can fade.
  private wallFade = new MeshStandardMaterial({ roughness: 0.9, transparent: true });
  private frameFade = new MeshStandardMaterial({ color: '#2f343c', roughness: 0.5, transparent: true });
  private westFade = new MeshStandardMaterial({ roughness: 0.9, transparent: true });
  private westFrameFade = new MeshStandardMaterial({ color: '#2f343c', roughness: 0.5, transparent: true });
  private floors = {
    planks: new MeshStandardMaterial({ map: planks(), roughness: 0.7 }),
    terrazzo: new MeshStandardMaterial({ map: terrazzo(), roughness: 0.35 }),
    grass: new MeshStandardMaterial({ map: grass(), roughness: 1 }),
    paving: new MeshStandardMaterial({ map: paving(), roughness: 0.95 }),
    slab: new MeshStandardMaterial({ roughness: 0.9 }),
    carpetGrey: new MeshStandardMaterial({ roughness: 1 }),
    rubber: new MeshStandardMaterial({ roughness: 1 }),
  };

  /** Bring the shell in line with the plan. Returns true if anything was built. */
  update(L: BuildingLayout) {
    this.layout = L;
    const t0 = performance.now();
    let built = 0;

    if (!this.lobby) {
      this.lobby = this.buildLobby();
      built++;
    }

    const length = L.x1 - L.x0;
    const full = Math.floor(length / SEGMENT);
    for (let i = 0; i < full; i++) {
      if (!this.segments.has(i)) {
        this.segments.set(i, this.buildStretch(`seg${i}`, L.x0 + i * SEGMENT, L.x0 + (i + 1) * SEGMENT, false));
        built++;
      }
    }
    for (const [i, sec] of this.segments) {
      if (i >= full) {
        this.drop(sec);
        this.segments.delete(i);
      }
    }
    const capKey = `cap|${length.toFixed(2)}`;
    if (this.cap?.key !== capKey) {
      if (this.cap) this.drop(this.cap);
      this.cap = this.buildStretch(capKey, L.x0 + full * SEGMENT, L.x1, true);
      built++;
    }

    const seen = new Set<string>();
    for (const u of this.unitsOf(L)) {
      const key = `${u.kind}|${u.side}|${u.w.toFixed(2)}|${u.door?.toFixed(2) ?? '-'}|${u.id}`;
      seen.add(u.id);
      const existing = this.units.get(u.id);
      if (existing && existing.key === key) {
        existing.group.position.x = u.x0;
        continue;
      }
      if (existing) this.drop(existing);
      const sec = this.buildUnit(u, key);
      sec.group.position.x = u.x0;
      this.units.set(u.id, sec);
      built++;
    }
    for (const [id, sec] of this.units) {
      if (!seen.has(id)) {
        this.drop(sec);
        this.units.delete(id);
      }
    }
    if (built) {
      this.setTheme(this.theme);
      const ms = performance.now() - t0;
      if (ms > 30) console.debug(`[floor] building: ${built} section(s) in ${ms.toFixed(1)} ms`);
    }
    return built > 0;
  }

  setTheme(theme: ThemeName) {
    this.theme = theme;
    const p = PALETTES[theme];
    const night = theme === 'dark';
    for (const m of [this.wallFade, this.westFade]) m.color.set(p.wall);
    this.floors.planks.color.set(night ? '#6e5a48' : '#e2c9a6');
    this.floors.terrazzo.color.set(night ? '#5a5c60' : '#ffffff');
    this.floors.grass.color.set(night ? '#2b3f2c' : '#8fbf7a');
    this.floors.paving.color.set(night ? '#3c4048' : '#d9dce1');
    this.floors.slab.color.set(night ? '#2a2f37' : '#c9ced6');
    this.floors.carpetGrey.color.set(night ? '#2c313a' : '#b9c0ca');
    this.floors.rubber.color.set(night ? '#2b3540' : '#7d9bb5');
  }

  /** Fade the tall exterior walls when the camera swings behind them. */
  tick(dt: number, camera: Camera) {
    if (!this.layout) return;
    const c = camera.position;
    const n = c.z < this.layout.z0 + 2 ? 0.1 : 1;
    const w = c.x < this.layout.x0 + 2 ? 0.1 : 1;
    for (const [m, t] of [[this.wallFade, n], [this.frameFade, n], [this.westFade, w], [this.westFrameFade, w]] as const) {
      m.opacity = damp(m.opacity, t, 8, dt);
      m.depthWrite = m.opacity > 0.95;
    }
  }

  /** Places worth lighting at night: the lobby and the shared rooms. */
  lightSpots(): Vector3[] {
    const L = this.layout;
    if (!L) return [];
    const spots = [new Vector3(L.lobby.x, 2.9, 0)];
    for (const a of L.amenities) if (a.kind !== 'booths') spots.push(new Vector3(a.rect.x, 2.9, a.rect.z));
    return spots;
  }

  private drop(sec: Section) {
    disposeKit(sec.group);
    if (sec.tall) disposeKit(sec.tall);
  }

  private add(sec: Section) {
    this.root.add(sec.group);
    if (sec.tall) this.root.add(sec.tall);
    return sec;
  }

  private unitsOf(L: BuildingLayout): Unit[] {
    const out: Unit[] = [];
    for (const r of L.rooms.values()) {
      const x0 = r.x - r.w / 2;
      const doorWorld = r.x + (r.side === 'north' ? r.doorX : -r.doorX);
      out.push({ id: `office:${r.team.id}`, kind: 'office', side: r.side, x0, w: r.w, door: doorWorld - x0 });
    }
    for (const a of L.amenities) {
      const open = a.kind === 'kitchen' || a.kind === 'lounge' || a.kind === 'games';
      out.push({ id: `amenity:${a.side}:${a.kind}`, kind: a.kind, side: a.side, x0: a.rect.x - a.rect.w / 2, w: a.rect.w, door: open ? undefined : a.rect.w / 2, open });
    }
    return out;
  }

  // ---------------------------------------------------------------- segments

  /** A slice of the building between a and b: slab, floors, walls, windows, garden. */
  private buildStretch(key: string, a: number, b: number, isCap: boolean): Section {
    const L = this.layout!;
    reseed(hash(key) + 7);
    const k = new Kit();
    const tk = new Kit();
    const w = b - a;
    const cx = (a + b) / 2;
    const wingStart = L.x0 + LOBBY_WIDTH;

    if (w > 0.01) {
      k.add(floorGeo(w, YARD, 2.2), this.floors.grass, cx, -0.2, Z0 - 3 - YARD / 2, { cast: false });
      k.add(floorGeo(w, YARD, 2.2), this.floors.grass, cx, -0.2, Z1 + 3 + YARD / 2, { cast: false });
      k.add(floorGeo(w, 3, 1.1), this.floors.paving, cx, -0.17, Z0 - 1.5, { cast: false });
      k.add(floorGeo(w, 3, 1.1), this.floors.paving, cx, -0.17, Z1 + 1.5, { cast: false });
      k.add(texturedBox(w, 0.35, DEPTH + 0.5, 3.3), this.floors.slab, cx, -0.175, 0);

      // Corridor floor and lights (east of the lobby only).
      const ca = Math.max(a, wingStart);
      if (b > ca) {
        k.add(floorGeo(b - ca, CORRIDOR, 2.2), this.floors.planks, (ca + b) / 2, 0.005, 0, { cast: false });
        for (let x = wingStart + 2; x < b; x += 4.4) if (x >= ca) pendant(k, x, 0, 2.5, '#f1e6d3');
      }

      // South cut-away wall with a wooden cap.
      k.add(G.box(w, LOW, T), M.wall(), cx, LOW / 2, Z1 + T / 2);
      k.add(G.box(w, 0.05, T + 0.06), M.woodDark(), cx, LOW + 0.025, Z1 + T / 2, { cast: false });

      // North wall with windows; fades when the camera goes behind it.
      this.windowRun(tk, a, b);

      // Garden on a fixed grid so neighbouring segments line up.
      for (let x = Math.ceil((a - L.x0 - 1.6) / 6.6) * 6.6 + L.x0 + 1.6; x < b; x += 6.6) {
        tree(k, x + (rand() - 0.5), Z0 - 5 - rand(), 0.85 + rand() * 0.5);
        tree(k, x + 2.2 + (rand() - 0.5), Z1 + 6 + rand(), 0.85 + rand() * 0.5);
      }
      for (let x = Math.ceil((a - L.x0 - 1.1) / 2.2) * 2.2 + L.x0 + 1.1; x < b; x += 2.2) {
        bush(k, x, Z0 - 1.4, 0.7 + rand() * 0.4);
        if (rand() > 0.4) bush(k, x + 0.6, Z1 + 1.5, 0.6 + rand() * 0.4);
      }
      if (!isCap) lampPost(k, cx, Z1 + 3);
    }

    if (isCap) {
      // East end: low wall, paving, trees, a bench.
      k.add(G.box(T, LOW, DEPTH + T), M.wall(), b + T / 2, LOW / 2, 0);
      k.add(G.box(T + 0.06, 0.05, DEPTH + T), M.woodDark(), b + T / 2, LOW + 0.025, 0, { cast: false });
      k.add(floorGeo(3, DEPTH + 6, 1.1), this.floors.paving, b + 1.5, -0.17, 0, { cast: false });
      k.add(floorGeo(YARD, DEPTH + 6 + YARD * 2, 2.2), this.floors.grass, b + 3 + YARD / 2, -0.2, 0, { cast: false });
      k.add(texturedBox(0.25, 0.35, DEPTH + 0.5, 3.3), this.floors.slab, b + 0.125, -0.175, 0);
      for (let z = Z0 + 2; z <= Z1 - 2; z += 6) tree(k, b + 5.5 + rand(), z + rand(), 0.9 + rand() * 0.4);
      bench(k, b + 2.6, 0, -Math.PI / 2);
    }

    return this.add({ key, group: k.build(), tall: tk.build() });
  }

  /** North wall between a and b: sill, head, piers and glass, bays of about 2.2 m. */
  private windowRun(k: Kit, a: number, b: number) {
    if (b - a < 0.05) return;
    const z = Z0 - T / 2;
    const bays = Math.max(1, Math.round((b - a) / 2.2));
    const step = (b - a) / bays;
    for (let j = 0; j < bays; j++) {
      const s = a + j * step;
      const mid = s + step / 2;
      const pier = Math.min(0.35, step * 0.3);
      k.add(G.box(step, SILL, T), this.wallFade, mid, SILL / 2, z);
      k.add(G.box(step, WALL_H - HEAD, T), this.wallFade, mid, (HEAD + WALL_H) / 2, z);
      k.add(G.box(pier, HEAD - SILL, T), this.wallFade, s + pier / 2, (SILL + HEAD) / 2, z);
      k.add(G.box(step - pier, HEAD - SILL, 0.04), glassMat, mid + pier / 2, (SILL + HEAD) / 2, z, { cast: false });
      k.add(G.box(0.05, HEAD - SILL, 0.08), this.frameFade, mid + pier / 2, (SILL + HEAD) / 2, z);
      k.add(G.box(step - pier, 0.05, T + 0.06), this.frameFade, mid + pier / 2, SILL + 0.02, z);
    }
  }

  // ---------------------------------------------------------------- lobby & street

  private buildLobby(): Section {
    const L = this.layout!;
    reseed(4242);
    const k = new Kit();
    const wk = new Kit();
    const x0 = L.x0;
    const lx = x0 + LOBBY_WIDTH / 2;

    // Street: lawn and plaza west of the building, a path to the door, steps.
    k.add(floorGeo(YARD + 6, DEPTH + 6 + YARD * 2, 2.2), this.floors.grass, x0 - 3 - YARD / 2, -0.2, 0, { cast: false });
    k.add(floorGeo(3, DEPTH + 6, 1.1), this.floors.paving, x0 - 1.5, -0.17, 0, { cast: false });
    k.add(floorGeo(20, 3.3, 1.1), this.floors.paving, x0 - 13, -0.165, 0, { cast: false });
    for (let i = 0; i < 2; i++) k.add(G.box(1.0, 0.12, 3.0), this.floors.slab, x0 - 0.75 - i * 0.5, -0.06 - i * 0.12, 0);
    k.add(texturedBox(0.25, 0.35, DEPTH + 0.5, 3.3), this.floors.slab, x0 - 0.125, -0.175, 0);
    for (const [x, z] of [[x0 - 6, -6], [x0 - 6, 6], [x0 - 13, -5.5], [x0 - 13, 5.5], [x0 - 4, Z0 - 4], [x0 - 4, Z1 + 4]] as [number, number][])
      tree(k, x + rand() - 0.5, z + rand() - 0.5, 0.9 + rand() * 0.4);
    for (const z of [-2.6, 2.6]) {
      lampPost(k, x0 - 4, z);
      lampPost(k, x0 - 11, z);
    }
    bench(k, x0 - 7.5, -2.6, 0);
    bench(k, x0 - 7.5, 2.6, Math.PI);
    plantTall(k, x0 - 1.1, -2.2, 1);
    plantTall(k, x0 - 1.1, 2.2, 1);

    k.add(floorGeo(LOBBY_WIDTH, DEPTH, 2.4), this.floors.terrazzo, lx, 0.006, 0, { cast: false });

    // West wall: window bays either side of the entrance.
    const wx = x0 - T / 2;
    const bay = (s: number, e: number) => {
      const bays = Math.max(1, Math.round((e - s) / 2.2));
      const step = (e - s) / bays;
      for (let j = 0; j < bays; j++) {
        const zs = s + j * step;
        const mid = zs + step / 2;
        wk.add(G.box(T, SILL, step), this.westFade, wx, SILL / 2, mid);
        wk.add(G.box(T, WALL_H - HEAD, step), this.westFade, wx, (HEAD + WALL_H) / 2, mid);
        wk.add(G.box(T, HEAD - SILL, 0.3), this.westFade, wx, (SILL + HEAD) / 2, zs + 0.15);
        wk.add(G.box(0.04, HEAD - SILL, step - 0.3), glassMat, wx, (SILL + HEAD) / 2, mid + 0.15, { cast: false });
        wk.add(G.box(0.08, HEAD - SILL, 0.05), this.westFrameFade, wx, (SILL + HEAD) / 2, mid + 0.15);
        wk.add(G.box(T + 0.06, 0.05, step - 0.3), this.westFrameFade, wx, SILL + 0.02, mid + 0.15);
      }
    };
    bay(Z0, -1.6);
    bay(1.6, Z1);
    wk.add(G.box(T, WALL_H - 2.6, 3.2), this.westFade, wx, (2.6 + WALL_H) / 2, 0);
    wk.add(G.box(0.06, 2.5, 1.5), glassMat, wx, 1.25, -0.8, { cast: false });
    wk.add(G.box(0.06, 2.5, 1.5), glassMat, wx - 0.4, 1.25, 1.1, { ry: 0.6, cast: false });
    wk.add(G.rbox(2.2, 0.12, 4.2, 0.03), this.westFrameFade, x0 - 1.1, 2.95, 0);

    // Logo wall, reception, waiting area.
    wk.add(G.box(7.0, 2.6, 0.04), clay(BRAND.paleLilac, { roughness: 0.9 }), lx + 0.6, 1.6, Z0 + 0.02);
    wk.add(G.box(6.4, 2.2, 0.06), clay(BRAND.purple, { roughness: 0.8 }), lx + 0.6, 1.65, Z0 + 0.04);
    wk.add(new PlaneGeometry(5.6, 1.4), logoMaterial(), lx + 0.6, 1.75, Z0 + 0.075, { cast: false });
    clock(wk, lx - 3.6, 2.5, Z0 + 0.06, 0);
    k.add(G.rbox(5.2, 0.02, 3.0, 0.02), clay(BRAND.paleLilac, { roughness: 1 }), lx + 0.6, 0.012, Z0 + 3.4, { cast: false });
    receptionDesk(k, lx + 0.6, Z0 + 3.6, 0, 3.2);
    plantTall(k, lx - 3.4, Z0 + 0.8, 3);
    plantTall(k, lx + 4.3, Z0 + 0.8, 0);
    k.add(G.rbox(4.6, 0.02, 3.2, 0.02), clay(BRAND.lilac, { roughness: 1 }), lx + 0.4, 0.012, Z1 - 3.6, { cast: false });
    sofa(k, lx + 0.4, Z1 - 2.3, Math.PI, 2.6, BRAND.purple);
    armchair(k, lx - 2.0, Z1 - 3.8, Math.PI / 2, '#9D6BD8');
    armchair(k, lx + 2.8, Z1 - 3.8, -Math.PI / 2, '#9D6BD8');
    coffeeTable(k, lx + 0.4, Z1 - 3.8, 0, 1.4, 0.7);
    plantTall(k, x0 + 0.9, Z1 - 0.9, 3);
    plantTall(k, lx + 4.4, Z1 - 0.9, 2);
    floorLamp(k, lx - 2.1, Z1 - 2.2);
    bookshelf(k, lx + 4.6, Z1 - 4.2, -Math.PI / 2, 1.6, 1.4);
    k.add(G.rbox(1.4, 0.02, 2.4, 0.02), M.charcoal(), x0 + 0.9, 0.012, 0, { cast: false });
    waterCooler(k, x0 + 0.5, -2.6, Math.PI / 2);
    kanban(k, x0 + 0.04, 1.6, 3.2, Math.PI / 2, 1.6);
    for (const x of [lx - 2.5, lx + 0.6, lx + 3.4]) pendant(k, x, Z0 + 3.6, 2.4, BRAND.purple);
    hangingPlant(k, lx - 3.4, Z1 - 2.4, 2.0);
    hangingPlant(k, lx + 4.3, -4.2, 2.1);
    for (const z of [-CORRIDOR / 2, CORRIDOR / 2]) k.add(G.rbox(0.4, WALL_H, 0.4, 0.04), M.offWhite(), x0 + LOBBY_WIDTH, WALL_H / 2, z);

    return this.add({ key: 'lobby', group: k.build(), tall: wk.build() });
  }

  // ---------------------------------------------------------------- units

  /** One office or shared room in its own frame (x from 0 to w): partition, corridor glass, door, furniture. */
  private buildUnit(u: Unit, key: string): Section {
    reseed(hash(key));
    const k = new Kit();
    const zWall = u.side === 'north' ? -CORRIDOR / 2 : CORRIDOR / 2;
    const zFar = u.side === 'north' ? Z0 : Z1;
    const zMid = (zWall + zFar) / 2;
    this.partition(k, 0, zWall, zFar);
    if (u.open) {
      this.glassRun(k, 0, 0.9, zWall);
      this.glassRun(k, u.w - 0.9, u.w, zWall);
    } else if (u.door !== undefined) {
      this.glassRun(k, 0, u.door - 0.6, zWall);
      this.glassRun(k, u.door + 0.6, u.w, zWall);
      k.add(G.box(0.06, 2.3, T + 0.04), M.charcoal(), u.door - 0.6, 1.15, zWall);
      k.add(G.box(0.06, 2.3, T + 0.04), M.charcoal(), u.door + 0.6, 1.15, zWall);
      k.add(G.box(1.26, 0.08, T + 0.04), M.charcoal(), u.door, 2.3, zWall);
      k.add(G.box(1.26, 0.64, T - 0.01), M.offWhite(), u.door, 2.68, zWall);
      const sgn = u.side === 'north' ? -1 : 1;
      k.add(G.box(1.1, 2.2, 0.04), glassMat, u.door - 0.15, 1.1, zWall + sgn * 0.45, { ry: sgn * 1.2, cast: false });
    }
    // A plant in the corridor at most partitions.
    if (rand() > 0.4) plantTall(k, 0, zWall + (u.side === 'north' ? 0.45 : -0.45));

    if (u.kind !== 'office') {
      const floorMat =
        u.kind === 'kitchen' ? this.floors.terrazzo : u.kind === 'meeting' ? this.floors.carpetGrey : u.kind === 'games' ? this.floors.rubber : this.floors.planks;
      k.add(floorGeo(u.w, OFFICE_D, u.kind === 'kitchen' ? 2.4 : 2.2), floorMat, u.w / 2, 0.005, zMid, { cast: false });
      this.furnishAmenity(k, u.kind, u.side, u.w, zMid);
    }
    return this.add({ key, group: k.build() });
  }

  private glassRun(k: Kit, x0: number, x1: number, z: number) {
    const w = x1 - x0;
    if (w < 0.05) return;
    const mid = (x0 + x1) / 2;
    k.add(G.box(w, 0.25, T), M.offWhite(), mid, 0.125, z);
    k.add(G.box(w, 2.35, 0.04), glassMat, mid, 1.42, z, { cast: false });
    // The rail is a touch deeper than the header so their faces never z-fight.
    k.add(G.box(w, 0.06, T + 0.02), M.charcoal(), mid, 2.6, z);
    k.add(G.box(w, 0.37, T), M.offWhite(), mid, 2.815, z);
    const posts = Math.max(1, Math.round(w / 1.3));
    for (let i = 0; i <= posts; i++) k.add(G.box(0.05, 2.35, 0.08), M.charcoal(), x0 + (w * i) / posts, 1.42, z);
  }

  private partition(k: Kit, x: number, zFrom: number, zTo: number) {
    const len = Math.abs(zTo - zFrom);
    const mid = (zFrom + zTo) / 2;
    k.add(G.box(T, 1.05, len), M.wall(), x, 0.525, mid);
    k.add(G.box(T + 0.03, 0.04, len + 0.01), M.woodDark(), x, 1.072, mid, { cast: false });
    k.add(G.box(0.04, 1.6, len), glassMat, x, 1.9, mid, { cast: false });
    k.add(G.box(0.08, 0.05, len), M.charcoal(), x, 2.7, mid);
    const posts = Math.max(1, Math.round(len / 1.6));
    for (let i = 0; i <= posts; i++) k.add(G.box(0.08, 1.6, 0.05), M.charcoal(), x, 1.9, zFrom + ((zTo - zFrom) * i) / posts);
  }

  private furnishAmenity(k: Kit, kind: AmenityKind, side: 'north' | 'south', w: number, zMid: number) {
    const yaw = side === 'north' ? 0 : Math.PI;
    const d = OFFICE_D;
    const back = -d / 2;
    const tall = side === 'north';
    k.push(w / 2, 0, zMid, yaw);
    switch (kind) {
      case 'kitchen': {
        kitchenRun(k, 0, back + 0.35, 0, Math.min(w - 1.2, 5.6));
        island(k, -0.3, -0.6, 0, 2.4);
        roundTable(k, -w / 2 + 1.5, 2.2, 3);
        roundTable(k, w / 2 - 1.5, 2.0, 3);
        vendingMachine(k, w / 2 - 0.55, back + 0.6, 0);
        waterCooler(k, -w / 2 + 0.4, back + 0.4, 0);
        plantTall(k, -w / 2 + 0.5, d / 2 - 0.6);
        for (const x of [-1.1, 0.5]) pendant(k, x, -0.5, 2.2, '#f2cc8f');
        pendant(k, -w / 2 + 1.5, 2.2, 2.2, '#22252b');
        pendant(k, w / 2 - 1.5, 2.0, 2.2, '#22252b');
        if (tall) clock(k, w / 2 - 1.6, 2.4, back + 0.05, 0);
        poster(k, -w / 2 + 0.08, 1.7, 0, Math.PI / 2, 4, 0.8, 1.0);
        break;
      }
      case 'meeting': {
        meetingTable(k, 0, -0.3, 0, Math.min(w - 2.2, 3.4));
        k.add(G.rbox(2.0, 1.15, 0.06, 0.02), M.black(), 0, 1.65, back + 0.08);
        k.add(G.box(1.9, 1.05, 0.01), M.screen(), 0, 1.65, back + 0.115, { cast: false });
        kanban(k, -w / 2 + 0.06, 1.55, -0.6, Math.PI / 2, 2.2);
        plantTall(k, w / 2 - 0.55, back + 0.55);
        plantTall(k, -w / 2 + 0.55, d / 2 - 0.6);
        for (const x of [-0.8, 0.8]) pendant(k, x, -0.3, 2.25, '#22252b');
        break;
      }
      case 'lounge': {
        const rx = 0.2;
        k.add(G.rbox(4.8, 0.02, 3.6, 0.03), M.charcoal(), rx, 0.012, -0.4, { cast: false });
        sofa(k, rx, -2.1, 0, 2.8, '#3f7f7a');
        armchair(k, rx - 2.3, -0.2, Math.PI / 2, '#d6a84f');
        armchair(k, rx + 2.6, -0.2, -Math.PI / 2, '#b55a4c');
        coffeeTable(k, rx, -0.4, 0, 1.4, 0.7);
        tv(k, rx, 1.6, Math.PI);
        beanbag(k, w / 2 - 1.0, 2.2);
        beanbag(k, w / 2 - 2.0, 2.6);
        bookshelf(k, -w / 2 + 0.3, -1.0, Math.PI / 2, 1.8, 1.9);
        floorLamp(k, rx - 2.3, -1.9);
        sideTable(k, rx + 2.6, -1.4);
        plantTall(k, w / 2 - 0.5, back + 0.5);
        plantTall(k, -w / 2 + 0.5, back + 0.5);
        hangingPlant(k, rx + 1.4, -2.6, 2.0);
        if (tall) for (let i = 0; i < 3; i++) poster(k, rx - 1.4 + i * 1.4, 1.9, back + 0.05, 0, i + 1, 0.7, 0.9);
        break;
      }
      case 'games': {
        if (w > 5.2) pingPong(k, 0, -0.4, 0);
        beanbag(k, -w / 2 + 1.0, d / 2 - 1.4, FABRICS[2]);
        beanbag(k, -w / 2 + 2.0, d / 2 - 1.1, FABRICS[3]);
        vendingMachine(k, w / 2 - 0.6, back + 0.6, 0);
        plantTall(k, -w / 2 + 0.5, back + 0.5);
        boxes(k, w / 2 - 0.6, d / 2 - 0.8, 0.3);
        for (const x of [-0.8, 0.8]) pendant(k, x, -0.4, 2.3, BRAND.lilac);
        break;
      }
      case 'booths': {
        const n = Math.max(1, Math.floor((w - 0.4) / 1.6));
        for (let i = 0; i < n; i++) {
          const bx = -w / 2 + 1.0 + i * 1.6;
          if (bx > w / 2 - 0.6) break;
          k.add(G.rbox(1.3, 2.3, 1.3, 0.04), glassMat, bx, 1.15, back + 1.0, { cast: false });
          k.add(G.rbox(1.34, 0.1, 1.34, 0.04), M.charcoal(), bx, 2.33, back + 1.0);
          k.add(G.box(1.2, 0.04, 0.35), M.wood(), bx, 1.0, back + 0.55);
          chair(k, bx, back + 1.2, Math.PI, FABRICS[i % FABRICS.length]);
        }
        if (w > 2.5) plantTall(k, w / 2 - 0.5, d / 2 - 0.7);
        break;
      }
    }
    if (kind !== 'booths') plantSmall(k, w / 2 - 0.4, 0, d / 2 - 0.4);
    k.pop();
  }

  dispose() {
    for (const s of [...this.segments.values(), ...this.units.values()]) this.drop(s);
    if (this.cap) this.drop(this.cap);
    if (this.lobby) this.drop(this.lobby);
  }
}
