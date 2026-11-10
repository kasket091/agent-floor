import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from 'three';
import { PICK_LAYER } from './Character';
import type { Agent, Team } from '../../shared/protocol';
import { disposeKit, Kit } from './kit';
import { G } from './materials';
import { hash, STATUS_COLORS, teamAccent, teamColor, type ThemeName } from './palette';
import { CORRIDOR, OFFICE_D, type RoomLayout } from './layout';
import {
  armchair,
  bulbMat,
  beanbag,
  bookshelf,
  boxes,
  clock,
  coatRack,
  credenza,
  fileCabinet,
  floorGeo,
  floorLamp,
  hangingPlant,
  M,
  pendant,
  plantSmall,
  plantTall,
  poster,
  rand,
  reseed,
  serverRack,
  sideTable,
  trashBin,
  waterCooler,
} from './props';
import { carpetTiles } from './textures';
import { fit, makeCanvas, MONO_FONT, UI_FONT, wrap } from './text';

const boardGeo = new PlaneGeometry(1.5, 0.95);
const hitMat = new MeshBasicMaterial({ visible: false });
/** Bulbs of an empty room: switched off. */
const offBulbMat = new MeshBasicMaterial({ color: '#4a463f' });

/**
 * One team's office inside the building. Owns the carpet, furniture, the
 * rolling whiteboard with the team's task, and door signs. Walls belong to
 * the Building. Desks and characters are added to `floor` by the World.
 */
export class TeamRoom {
  readonly root = new Group();
  readonly id: string;
  /** Room-local container for desks and characters. */
  readonly floor = new Group();
  /** No agents inside: lights off (also skipped by the night lights). */
  empty = false;
  private decor: Group | null = null;
  private carpetMat: MeshStandardMaterial;
  private rugMat: MeshStandardMaterial;
  private signTex = makeCanvas(1024, 192);
  private decalTex = makeCanvas(1024, 256);
  private boardTex = makeCanvas(768, 480);
  private signMat: MeshBasicMaterial;
  private decalMat: MeshBasicMaterial;
  private boardMat: MeshStandardMaterial;
  private dynamic = new Group();
  private hue: number;
  private shapeKey = '';
  private boardKey = '';
  private signKey = '';
  private w = 0;
  private d = OFFICE_D;

  constructor(team: Team, theme: ThemeName) {
    this.id = team.id;
    this.hue = team.hue;
    this.carpetMat = new MeshStandardMaterial({ map: carpetTiles(), roughness: 1 });
    this.rugMat = new MeshStandardMaterial({ roughness: 1 });
    this.signMat = new MeshBasicMaterial({ map: this.signTex.texture, transparent: true });
    this.decalMat = new MeshBasicMaterial({ map: this.decalTex.texture, transparent: true, depthWrite: false, opacity: 0.9 });
    this.boardMat = new MeshStandardMaterial({ map: this.boardTex.texture, roughness: 0.5 });
    this.root.add(this.dynamic, this.floor);
    this.root.userData.teamId = team.id;
    this.setTheme(theme);
  }

  layout(room: RoomLayout) {
    this.root.position.set(room.x, 0, room.z);
    this.root.rotation.y = room.yaw;
    const shape = `${room.w.toFixed(2)}|${room.podLeft.toFixed(2)}|${room.podRight.toFixed(2)}|${room.hasLead}|${room.side}|${room.doorX.toFixed(2)}`;
    if (shape === this.shapeKey) return;
    this.shapeKey = shape;
    this.w = room.w;
    this.d = room.d;
    this.furnish(room);
  }

  /** Lay out furniture around the desk pod. Deterministic per team, so it never reshuffles. */
  private furnish(r: RoomLayout) {
    if (this.decor) disposeKit(this.decor);
    for (const c of this.dynamic.children) if (c instanceof Mesh && c.geometry !== boardGeo) c.geometry.dispose();
    this.dynamic.clear();
    reseed(hash(this.id));
    const k = new Kit();
    const { w, d } = r;
    const back = -d / 2;
    const front = d / 2;
    const podW = r.podRight - r.podLeft;
    const podC = (r.podLeft + r.podRight) / 2;
    const leadLane = r.hasLead ? r.podLeft - 2.05 : r.podLeft - 0.6;
    const lane = r.podRight + 0.85;

    // Floor: carpet tiles in the team colour, a rug under the pod.
    k.add(floorGeo(w, d, 1.0), this.carpetMat, 0, 0.008, 0, { cast: false });
    const rugW = podW + (r.hasLead ? 3.2 : 1.4);
    const rugX = r.hasLead ? podC - 1.0 : podC;
    k.add(G.rbox(rugW, 0.012, 4.6, 0.04), this.rugMat, rugX, 0.014, -0.1, { cast: false });

    // Back wall: credenza with printer, art leaning on it, a clock above (tall wall only).
    const credW = Math.min(2.4, Math.max(1.4, podW - 0.4));
    credenza(k, podC, back + 0.32, 0, credW);
    poster(k, podC + credW / 2 - 0.35, 1.07, back + 0.18, 0, Math.floor(rand() * 6), 0.42, 0.56);
    if (r.side === 'north') clock(k, podC - 0.6, 2.72, back + 0.03, 0);

    // Back-left: the rolling whiteboard, angled so the camera can read it.
    const bx = -w / 2 + 1.25;
    const bz = back + 1.25;
    const boardYaw = 0.55 - r.yaw;
    k.push(bx, 0, bz, boardYaw);
    k.add(G.rbox(1.6, 1.05, 0.05, 0.02), M.steel(), 0, 1.35, 0);
    for (const s of [-1, 1]) {
      k.add(G.cyl(0.02, 0.02, 1.4, 8), M.steel(), s * 0.78, 0.7, 0);
      k.add(G.box(0.05, 0.03, 0.5), M.steel(), s * 0.78, 0.05, 0);
    }
    k.add(G.box(1.3, 0.03, 0.08), M.steel(), 0, 0.8, 0.05);
    k.add(G.box(0.12, 0.02, 0.02), M.charcoal(), -0.3, 0.83, 0.05, { cast: false });
    k.pop();
    const board = new Mesh(boardGeo, this.boardMat);
    board.position.set(bx, 1.35, bz);
    board.rotation.y = boardYaw;
    board.translateZ(0.028);
    this.dynamic.add(board);

    // Left side: bookshelf against the partition, file cabinet, reading nook.
    const leftEdge = -w / 2;
    const leftRoom = leadLane - leftEdge;
    if (leftRoom > 1.2) {
      bookshelf(k, leftEdge + 0.22, -0.9, Math.PI / 2, 1.5, 1.9);
      fileCabinet(k, leftEdge + 0.32, 0.45, Math.PI / 2);
      if (leftRoom > 2.0) {
        armchair(k, leftEdge + 1.0, front - 1.7, Math.PI * 0.75);
        sideTable(k, leftEdge + 0.45, front - 1.05);
        floorLamp(k, leftEdge + 0.4, front - 2.45);
      } else {
        plantTall(k, leftEdge + 0.45, front - 1.0);
      }
    }
    coatRack(k, leftEdge + 0.45, front - 0.45);

    // Right side: past the walking lane.
    const rightEdge = w / 2;
    const rightRoom = rightEdge - lane;
    if (rightRoom > 0.9) {
      const rx = rightEdge - 0.45;
      if (rand() > 0.55) serverRack(k, rightEdge - 0.4, back + 0.55, -Math.PI / 2);
      else plantTall(k, rx, back + 0.5);
      waterCooler(k, rightEdge - 0.3, -0.6, -Math.PI / 2);
      if (rightRoom > 1.6) {
        beanbag(k, rightEdge - 0.9, front - 1.6);
        boxes(k, rightEdge - 0.45, 0.9, 0.2);
      }
      plantTall(k, rx, front - 0.5);
    } else {
      plantTall(k, w / 2 - 0.4, back + 0.45);
    }

    // Lights over the pod and the lead desk.
    const cols = Math.max(1, Math.round(podW / 1.95));
    const accentLamp = teamAccent(this.hue).getStyle();
    for (let i = 0; i < cols; i++) pendant(k, r.podLeft + 1.95 * (i + 0.5), 0, 2.35, i % 2 ? '#22252b' : accentLamp);
    if (r.hasLead) pendant(k, r.podLeft - 0.6, 0, 2.35, accentLamp);
    hangingPlant(k, podC + podW / 2 + 0.3, back + 1.0, 2.0);

    // Bins at the ends of the pod, a few small plants.
    trashBin(k, r.podRight + 0.3, 1.9);
    trashBin(k, r.podLeft - 0.3, -1.9);
    plantSmall(k, leftEdge + 0.3, 1.07, -0.3);

    // Door signs: above the door on both faces of the corridor wall.
    const signGeo = new PlaneGeometry(1.7, 0.32);
    const outer = new Mesh(signGeo, this.signMat);
    outer.position.set(r.doorX, 2.8, front + 0.1);
    const inner = new Mesh(signGeo, this.signMat);
    inner.position.set(r.doorX, 2.8, front - 0.1);
    inner.rotation.y = Math.PI;
    // The team name painted on the corridor floor, readable from the default camera.
    // Picking: one invisible slab for the whole office.
    const hit = new Mesh(new BoxGeometry(w, 0.1, d), hitMat);
    hit.position.y = 0.05;
    hit.layers.set(PICK_LAYER);
    this.dynamic.add(hit);

    const decal = new Mesh(new PlaneGeometry(3.2, 0.8), this.decalMat);
    decal.rotation.order = 'YXZ';
    decal.rotation.set(-Math.PI / 2, -r.yaw, 0);
    decal.position.set(r.doorX - 1.9 > -w / 2 ? r.doorX - 1.9 : 0, 0.02, front + CORRIDOR * 0.28);
    decal.renderOrder = 1;
    this.dynamic.add(outer, inner, decal);

    this.decor = k.build();
    this.root.add(this.decor);
    this.root.traverse((o) => {
      if (o !== this.floor && !isUnder(o, this.floor)) o.userData.teamId = this.id;
    });
    this.signKey = '';
    this.boardKey = '';
  }

  setTheme(theme: ThemeName) {
    const night = theme === 'dark';
    this.carpetMat.color.copy(teamColor(this.hue, theme));
    this.rugMat.color.copy(teamAccent(this.hue)).multiplyScalar(night ? 0.35 : 0.75);
    this.signKey = '';
    this.boardKey = '';
  }

  /** Redraw signs and the whiteboard when their content changes. */
  refresh(team: Team, agents: Agent[], dark: boolean) {
    const signKey = `${team.name}|${agents.length}|${dark}`;
    if (signKey !== this.signKey) {
      this.signKey = signKey;
      this.empty = agents.length === 0;
      this.decor?.traverse((o) => {
        if (o instanceof Mesh && (o.material === bulbMat || o.material === offBulbMat)) o.material = this.empty ? offBulbMat : bulbMat;
      });
      const accent = teamAccent(team.hue).getStyle();
      // Door sign: dark plate, light text.
      {
        const { ctx, canvas, texture } = this.signTex;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#1e2430';
        ctx.beginPath();
        ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 28);
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.roundRect(36, 56, 80, 80, 18);
        ctx.fill();
        ctx.fillStyle = '#f4f6f8';
        ctx.font = `700 86px ${UI_FONT}`;
        ctx.textBaseline = 'middle';
        ctx.fillText(fit(ctx, team.name, canvas.width - 190), 150, 100);
        texture.needsUpdate = true;
      }
      // Floor decal: big letters, no plate.
      {
        const { ctx, canvas, texture } = this.decalTex;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.roundRect(12, 74, 22, 116, 11);
        ctx.fill();
        ctx.fillStyle = dark ? 'rgba(232,236,242,0.78)' : 'rgba(30,36,48,0.72)';
        ctx.font = `800 104px ${UI_FONT}`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(fit(ctx, team.name.toUpperCase(), 960), 60, 160);
        ctx.font = `600 38px ${MONO_FONT}`;
        ctx.fillText(`${agents.length} ${agents.length === 1 ? 'AGENT' : 'AGENTS'}`, 64, 222);
        ctx.globalAlpha = 1;
        texture.needsUpdate = true;
      }
    }

    const statuses = agents.map((a) => a.status).join(',');
    const boardKey = `${team.task}|${statuses}`;
    if (boardKey !== this.boardKey) {
      this.boardKey = boardKey;
      const { ctx, canvas, texture } = this.boardTex;
      ctx.fillStyle = '#fbfcfd';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#8a94a6';
      ctx.font = `600 34px ${UI_FONT}`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('Working on', 36, 66);
      ctx.fillStyle = '#1e2430';
      ctx.font = `700 54px ${UI_FONT}`;
      const lines = wrap(ctx, team.task || 'No task posted yet', canvas.width - 72, 3);
      lines.forEach((l, i) => ctx.fillText(l, 36, 136 + i * 62));
      // Marker doodle: a hand-drawn underline.
      ctx.strokeStyle = teamAccent(team.hue).getStyle();
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(36, 136 + lines.length * 62 - 30);
      ctx.quadraticCurveTo(200, 136 + lines.length * 62 - 22, 360, 136 + lines.length * 62 - 32);
      ctx.stroke();
      // One magnet per agent, coloured by status.
      agents.forEach((a, i) => {
        const x = 56 + i * 54;
        if (x > canvas.width - 30) return;
        ctx.fillStyle = STATUS_COLORS[a.status];
        ctx.beginPath();
        ctx.arc(x, 420, 19, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(x - 6, 414, 6, 0, Math.PI * 2);
        ctx.fill();
      });
      texture.needsUpdate = true;
    }
  }

  get center() {
    return this.root.position;
  }

  get size() {
    return { w: this.w, d: this.d };
  }

  dispose() {
    if (this.decor) disposeKit(this.decor);
    this.root.removeFromParent();
    for (const m of [this.carpetMat, this.rugMat, this.signMat, this.decalMat, this.boardMat]) m.dispose();
    for (const t of [this.signTex, this.decalTex, this.boardTex]) t.texture.dispose();
  }
}

function isUnder(o: { parent: unknown }, ancestor: object) {
  let p = o.parent as { parent: unknown } | null;
  while (p) {
    if (p === ancestor) return true;
    p = p.parent as { parent: unknown } | null;
  }
  return false;
}
