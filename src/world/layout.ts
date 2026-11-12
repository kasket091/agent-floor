import type { Agent, Team, WorldState } from '../../shared/protocol';

// One building. Units are roughly metres.
//
//   z-   ┌───────┬────────┬────────┬─────────┬─────────┐  north wing (tall windows)
//        │       │ office │ office │ meeting │ kitchen │
//        │ lobby ├────────┴────────┴─────────┴─────────┤
//   door ▸       │              corridor               │
//        │       ├────────┬────────┬───────────────────┤
//        │       │ office │ office │      lounge       │  south wing (cut-away wall)
//   z+   └───────┴────────┴────────┴───────────────────┘
//        x-                                          x+
//
// Offices are laid out in their own frame: the door side (+Z) faces the corridor.
// North offices have yaw 0, south offices are turned around (yaw PI).

export const DESK_PITCH = 1.95;
export const SEAT_Z = 1.22;
export const OFFICE_D = 8.2;
export const CORRIDOR = 3.4;
export const WALL_H = 3.0;
const LEAD_SPACE = 2.7;
const LEFT_ROOM = 2.2; // bookshelf, reading nook, coat rack
const RIGHT_ROOM = 3.0; // walking lane, water cooler, plants
const LOBBY_W = 10;
const KITCHEN_W = 7.5;
const MEETING_W = 6.5;
const LOUNGE_W = 9;
export const LOBBY_WIDTH = LOBBY_W;
export const BUILDING_X0 = -24;
/** Static sections of the shell are built in fixed-width segments and cached. */
export const SEGMENT = 13.2;

export interface Seat {
  /** Room-local seat position (where the chair is). */
  x: number;
  z: number;
  /** Direction the seated agent faces, radians around Y. 0 = facing -Z. */
  yaw: number;
  /** Room-local path from the office door to the seat. Last point is the seat. */
  path: [number, number][];
  isLead: boolean;
  /** Stand here instead of sitting (idle spots by a counter). */
  stand?: boolean;
}

export interface RoomLayout {
  team: Team;
  /** World-space centre and rotation of the office. */
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
  side: 'north' | 'south';
  /** Local x of the door in the corridor wall. */
  doorX: number;
  podLeft: number;
  podRight: number;
  hasLead: boolean;
  seats: Map<string, Seat>;
  /** Local path from the building entrance to just inside this office's door. */
  entry: [number, number][];
}

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export type AmenityKind = 'kitchen' | 'meeting' | 'lounge' | 'games' | 'booths';

export interface Amenity {
  kind: AmenityKind;
  rect: Rect;
  side: 'north' | 'south';
}

export interface BuildingLayout {
  /** Outer footprint, world space, centred on the origin. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  lobby: Rect;
  corridor: Rect;
  amenities: Amenity[];
  rooms: Map<string, RoomLayout>;
  /** Where people come in (world space, just outside the door). */
  entrance: [number, number];
  /** Changes whenever the building shell has to be rebuilt. */
  key: string;
}

/** Remembers seats, leads and which wing each team sits in, so nothing jumps around. */
export class SeatBook {
  private slots = new Map<string, Map<string, number>>();
  private leads = new Map<string, string>();
  readonly wings = new Map<string, 'north' | 'south'>();

  assign(state: WorldState) {
    const byTeam = new Map<string, Agent[]>();
    for (const a of Object.values(state.agents)) {
      if (!byTeam.has(a.team)) byTeam.set(a.team, []);
      byTeam.get(a.team)!.push(a);
    }
    for (const [teamId, map] of this.slots) {
      const present = new Set((byTeam.get(teamId) || []).map((a) => a.id));
      for (const id of map.keys()) if (!present.has(id)) map.delete(id);
      if (!byTeam.has(teamId)) this.slots.delete(teamId);
      const lead = this.leads.get(teamId);
      if (lead && !present.has(lead)) this.leads.delete(teamId);
    }
    // Pinned rooms keep their wing while empty, so they never jump sides.
    for (const teamId of this.wings.keys()) {
      if (!byTeam.has(teamId) && !state.teams[teamId]?.pinned) this.wings.delete(teamId);
    }
    for (const [teamId, agents] of byTeam) {
      agents.sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
      if (!this.leads.has(teamId)) {
        const lead =
          agents.find((a) => a.role.toLowerCase() === 'lead') ||
          agents.find((a) => !a.parent && agents.some((b) => b.parent === a.id));
        if (lead) this.leads.set(teamId, lead.id);
      }
      let map = this.slots.get(teamId);
      if (!map) this.slots.set(teamId, (map = new Map()));
      const leadId = this.leads.get(teamId);
      for (const a of agents) {
        if (a.id === leadId || map.has(a.id)) continue;
        const used = new Set(map.values());
        let slot = 0;
        while (used.has(slot)) slot++;
        map.set(a.id, slot);
      }
    }
  }

  lead(teamId: string) {
    return this.leads.get(teamId);
  }

  slotsFor(teamId: string) {
    return this.slots.get(teamId) || new Map<string, number>();
  }
}

function officeWidth(podSlots: number, hasLead: boolean, reserveLead = hasLead) {
  const cols = Math.max(1, Math.ceil(podSlots / 2));
  const need = LEFT_ROOM + (hasLead ? LEAD_SPACE : 0) + cols * DESK_PITCH + RIGHT_ROOM;
  const w = Math.max(9, need + (reserveLead && !hasLead ? LEAD_SPACE : 0));
  return { w, cols, extra: w - need };
}

/** Rotate a world-space point into an office's local frame. */
export function toLocal(room: { x: number; z: number; yaw: number }, p: [number, number]): [number, number] {
  const dx = p[0] - room.x;
  const dz = p[1] - room.z;
  const c = Math.cos(room.yaw);
  const s = Math.sin(room.yaw);
  // Inverse of three.js's rotation around Y by yaw.
  return [dx * c - dz * s, dx * s + dz * c];
}

type Draft = Omit<RoomLayout, 'x' | 'z' | 'yaw' | 'entry'>;

export function computeLayout(state: WorldState, book: SeatBook): BuildingLayout {
  book.assign(state);
  // Lobby first, then rooms A-Z by name, so site rooms read like a directory.
  const rank = (t: Team) => (t.id === 'lobby' ? 0 : 1);
  const teams = Object.values(state.teams).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  // --- size every office and place it in a wing
  const wing: Record<'north' | 'south', Draft[]> = { north: [], south: [] };
  const wingLen = { north: 0, south: 0 };
  for (const team of teams) {
    const slots = book.slotsFor(team.id);
    const leadId = book.lead(team.id);
    const maxSlot = slots.size ? Math.max(...slots.values()) + 1 : 0;
    // Offices grow four seats at a time, so the building is reshaped rarely.
    const podSlots = Math.max(4, Math.ceil(maxSlot / 4) * 4);
    // Pinned rooms always leave space for a lead desk, so a lead arriving doesn't move the rooms next door.
    const { w, cols, extra } = officeWidth(podSlots, Boolean(leadId), Boolean(leadId || team.pinned));
    const d = OFFICE_D;
    let side = book.wings.get(team.id);
    if (!side) {
      side = wingLen.north <= wingLen.south ? 'north' : 'south';
      book.wings.set(team.id, side);
    }
    wingLen[side] += w;

    const podWidth = cols * DESK_PITCH;
    const podLeft = -w / 2 + LEFT_ROOM + extra / 2 + (leadId ? LEAD_SPACE : 0);
    const podRight = podLeft + podWidth;
    const front = d / 2 - 0.9;
    const lane = podRight + 0.85;
    const doorX = Math.min(w / 2 - 0.9, lane);
    const seats = new Map<string, Seat>();

    if (leadId) {
      const lx = podLeft - 1.25;
      seats.set(leadId, {
        x: lx,
        z: 0,
        yaw: -Math.PI / 2,
        isLead: true,
        path: [
          [doorX, front],
          [lx - 0.8, front],
          [lx - 0.8, 0],
          [lx, 0],
        ],
      });
    }
    for (const [agentId, slot] of slots) {
      const col = Math.floor(slot / 2);
      const back = slot % 2 === 0;
      const x = podLeft + DESK_PITCH * (col + 0.5);
      if (back) {
        // Back row faces the corridor; reach it round the end of the pod.
        const behind = -SEAT_Z - 0.75;
        seats.set(agentId, {
          x,
          z: -SEAT_Z,
          yaw: Math.PI,
          isLead: false,
          path: [
            [lane, front],
            [lane, behind],
            [x, behind],
            [x, -SEAT_Z],
          ],
        });
      } else {
        seats.set(agentId, {
          x,
          z: SEAT_Z,
          yaw: 0,
          isLead: false,
          path: [
            [doorX, front],
            [x, front],
            [x, SEAT_Z],
          ],
        });
      }
    }
    wing[side].push({ team, w, d, side, doorX, podLeft, podRight, hasLead: Boolean(leadId), seats });
  }

  // --- amenities close each wing, then pad the shorter wing so the building is a box
  const amenities: { kind: AmenityKind; w: number; side: 'north' | 'south' }[] = [
    { kind: 'meeting', w: MEETING_W, side: 'north' },
    { kind: 'kitchen', w: KITCHEN_W, side: 'north' },
    { kind: 'lounge', w: LOUNGE_W, side: 'south' },
  ];
  const lenN = wingLen.north + MEETING_W + KITCHEN_W;
  const lenS = wingLen.south + LOUNGE_W;
  const wingLength = Math.max(lenN, lenS);
  const pad = (gap: number): AmenityKind => (gap > 5.5 ? 'games' : 'booths');
  if (lenS < lenN - 0.01) amenities.splice(2, 0, { kind: pad(lenN - lenS), w: lenN - lenS, side: 'south' });
  if (lenN < lenS - 0.01) amenities.splice(0, 0, { kind: pad(lenS - lenN), w: lenS - lenN, side: 'north' });

  const length = LOBBY_W + wingLength;
  const depth = CORRIDOR + OFFICE_D * 2;
  // The west end is fixed so the building grows east without moving what exists.
  const x0 = BUILDING_X0;
  const z0 = -depth / 2;
  const wingZ = { north: -(CORRIDOR / 2 + OFFICE_D / 2), south: CORRIDOR / 2 + OFFICE_D / 2 };
  const entrance: [number, number] = [x0 - 2.2, 0];
  const corridorStart: [number, number] = [x0 + LOBBY_W - 0.5, 0];

  const rooms = new Map<string, RoomLayout>();
  const placedAmenities: Amenity[] = [];
  for (const side of ['north', 'south'] as const) {
    let x = x0 + LOBBY_W;
    for (const dft of wing[side]) {
      const cx = x + dft.w / 2;
      const yaw = side === 'north' ? 0 : Math.PI;
      const pos = { x: cx, z: wingZ[side], yaw };
      // From the street, through the lobby, down the corridor to this door.
      const doorWorldX = cx + (side === 'north' ? dft.doorX : -dft.doorX);
      const entryWorld: [number, number][] = [entrance, [x0 + 1.5, 0], corridorStart, [doorWorldX, 0]];
      const entry = entryWorld.map((p) => toLocal(pos, p));
      entry.push([dft.doorX, dft.d / 2 + 0.3]);
      rooms.set(dft.team.id, { ...dft, x: cx, z: wingZ[side], yaw, entry });
      x += dft.w;
    }
    for (const a of amenities.filter((a) => a.side === side)) {
      placedAmenities.push({ kind: a.kind, side, rect: { x: x + a.w / 2, z: wingZ[side], w: a.w, d: OFFICE_D } });
      x += a.w;
    }
  }

  const key = [
    length.toFixed(2),
    ...[...rooms.values()].map((r) => `${r.team.id}:${r.side}:${r.x.toFixed(2)}:${r.w.toFixed(2)}:${r.doorX.toFixed(2)}`),
  ].join('|');

  return {
    x0,
    x1: x0 + length,
    z0,
    z1: z0 + depth,
    lobby: { x: x0 + LOBBY_W / 2, z: 0, w: LOBBY_W, d: depth },
    corridor: { x: x0 + LOBBY_W + wingLength / 2, z: 0, w: wingLength, d: CORRIDOR },
    amenities: placedAmenities,
    rooms,
    entrance,
    key,
  };
}

// ---------------------------------------------------------------- idle outings

/** A place an idle lead can wander to. World space; `route` runs from the corridor to the spot. */
export interface IdleSpot {
  key: string;
  kind: AmenityKind | 'lobby';
  x: number;
  z: number;
  /** Facing, world space (0 = facing -Z). */
  yaw: number;
  stand: boolean;
  route: [number, number][];
}

// Amenity-local spots matching the furniture in Building.furnishAmenity: [x, z, yaw, stand, via...].
// Local +Z faces the corridor. `via` keeps walkers clear of tables and the TV.
type LocalSpot = [number, number, number, boolean, [number, number][]];
const LOUNGE_RX = 0.2; // the lounge set's x offset in Building
const SOFA_Z = -2.0;
const LOCAL_SPOTS: Partial<Record<AmenityKind, LocalSpot[]>> = {
  kitchen: [
    [-0.9, 0.25, 0, true, [[0, 1.0]]],
    [0.3, 0.25, 0, true, [[0, 1.0]]],
    [-2.2, -3.0, 0, true, [[1.6, 0.6], [1.6, -3.0]]],
    [-0.9, -3.0, 0, true, [[1.6, 0.6], [1.6, -3.0]]],
    [0.4, -3.0, 0, true, [[1.6, 0.6], [1.6, -3.0]]],
  ],
  lounge: [
    ...[-0.94, -0.31, 0.31, 0.94].map((dx): LocalSpot => {
      const lane = LOUNGE_RX + (dx < 0 ? -1.5 : 1.5);
      return [LOUNGE_RX + dx, SOFA_Z, Math.PI, false, [[lane, 1.0], [lane, -1.45]]];
    }),
    // Armchairs either side of the coffee table: the left one faces +X, the right one -X.
    [LOUNGE_RX - 2.24, -0.2, -Math.PI / 2, false, [[LOUNGE_RX - 1.5, 1.0], [LOUNGE_RX - 1.5, -0.2]]],
    [LOUNGE_RX + 2.54, -0.2, Math.PI / 2, false, [[LOUNGE_RX + 1.9, 1.0], [LOUNGE_RX + 1.9, -0.2]]],
  ],
  // Ping-pong (Building: pingPong at z -0.4, 2.74 long along X): one player at each end, facing the net.
  games: [
    [-1.75, -0.4, -Math.PI / 2, true, [[0, 1.5], [-1.75, 1.5]]],
    [1.75, -0.4, Math.PI / 2, true, [[0, 1.5], [1.75, 1.5]]],
  ],
};

// Kitchen round tables (Building: roundTable at (-w/2+1.5, 2.2) and (w/2-1.5, 2.0), 3 chairs each at
// angle i*2π/3 + 0.4, radius 0.72). Sit facing the table; walk in from just outside the chair.
for (const [tx, tz] of [[-KITCHEN_W / 2 + 1.5, 2.2], [KITCHEN_W / 2 - 1.5, 2.0]]) {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const out: [number, number] = [tx + Math.cos(a) * 1.3, tz + Math.sin(a) * 1.3];
    LOCAL_SPOTS.kitchen!.push([tx + Math.cos(a) * 0.68, tz + Math.sin(a) * 0.68, Math.atan2(Math.cos(a), Math.sin(a)), false, [out]]);
  }
}

function toWorld(frame: { x: number; z: number; yaw: number }, p: [number, number]): [number, number] {
  const c = Math.cos(frame.yaw);
  const s = Math.sin(frame.yaw);
  return [frame.x + p[0] * c + p[1] * s, frame.z - p[0] * s + p[1] * c];
}

// Meeting room chairs (Building: meetingTable at z -0.3, 3.4 long, chairs at x ±0.433/±1.3, z -1.08 and 0.48).
// Far side first (sitters face the corridor glass), centre chairs before ends. Walk in through the door at x 0,
// round the table end for the far side.
const DOOR_IN: [number, number] = [0, 3.6];
const MEETING_SPOTS: LocalSpot[] = [
  ...[-0.433, 0.433, -1.3, 1.3].map((x): LocalSpot => {
    const lane = x < 0 ? -2.3 : 2.3;
    return [x, -1.08, Math.PI, false, [DOOR_IN, [lane, 1.2], [lane, -1.6], [x, -1.6]]];
  }),
  ...[-0.433, 0.433, -1.3, 1.3].map((x): LocalSpot => [x, 0.48, 0, false, [DOOR_IN, [x, 1.2]]]),
];

function spotsIn(L: BuildingLayout, table: Partial<Record<AmenityKind, LocalSpot[]>>): IdleSpot[] {
  const out: IdleSpot[] = [];
  for (const a of L.amenities) {
    if (a.kind === 'games' && a.rect.w <= 5.2) continue; // narrow games rooms have no ping-pong table
    const frame = { x: a.rect.x, z: a.rect.z, yaw: a.side === 'north' ? 0 : Math.PI };
    (table[a.kind] ?? []).forEach(([x, z, yaw, stand, via], i) => {
      const corridor: [number, number] = [via[0][0], a.rect.d / 2 + CORRIDOR / 2];
      const [wx, wz] = toWorld(frame, [x, z]);
      out.push({
        key: `${a.side}:${a.kind}:${i}`,
        kind: a.kind,
        x: wx,
        z: wz,
        yaw: yaw + frame.yaw,
        stand,
        route: [corridor, ...via, [x, z] as [number, number]].map((p) => toWorld(frame, p)),
      });
    });
  }
  return out;
}

/** The front desk waiting area (Building: lobby sofa at (lx+0.4, z1-2.3) facing the coffee table, armchairs at x lx-2.0 / lx+2.8). */
function lobbySpots(L: BuildingLayout): IdleSpot[] {
  const lx = L.lobby.x;
  const zt = L.z1 - 3.8; // coffee table row
  const start: [number, number] = [L.x0 + LOBBY_W - 0.5, 0];
  const seat = (i: number, x: number, z: number, yaw: number, via: [number, number][]): IdleSpot => ({
    key: `lobby:${i}`,
    kind: 'lobby',
    x,
    z,
    yaw,
    stand: false,
    route: [start, ...via, [x, z]],
  });
  const sofaZ = L.z1 - 2.38;
  return [
    ...[-0.767, 0, 0.767].map((dx, i) => seat(i, lx + 0.4 + dx, sofaZ, 0, [[lx + 1.8, L.z1 - 3.05], [lx + 0.4 + dx, L.z1 - 3.05]])),
    seat(3, lx - 1.94, zt, -Math.PI / 2, [[lx - 1.2, L.z1 - 5.0], [lx - 1.2, zt]]),
    seat(4, lx + 2.74, zt, Math.PI / 2, [[lx + 2.0, L.z1 - 5.0], [lx + 2.0, zt]]),
  ];
}

export const idleSpots = (L: BuildingLayout) => [...spotsIn(L, LOCAL_SPOTS), ...lobbySpots(L)];
/** Chairs round the meeting table, for a lead briefing new helpers. */
export const meetingSpots = (L: BuildingLayout) => spotsIn(L, { meeting: MEETING_SPOTS });

/** The trip from a desk to an idle spot, as a room-local Seat whose path starts beside the desk. */
export function outing(room: RoomLayout, home: Seat, spot: IdleSpot): Seat {
  const path: [number, number][] = [
    ...[...home.path].reverse().slice(1),
    room.entry[room.entry.length - 2],
    ...spot.route.map((p) => toLocal(room, p)),
  ];
  const [x, z] = path[path.length - 1];
  return { x, z, yaw: spot.yaw - room.yaw, path, isLead: false, stand: spot.stand };
}

/** Desk to desk between two offices: out of the old door, along the corridor, in at the new door. Destination-local. */
export function transferPath(from: RoomLayout, fromSeat: Seat, to: RoomLayout, toSeat: Seat): [number, number][] {
  const out = [...[...fromSeat.path].reverse().slice(1), from.entry[from.entry.length - 2]];
  return [...out.map((p) => toLocal(to, toWorld(from, p))), to.entry[to.entry.length - 2], ...toSeat.path];
}
