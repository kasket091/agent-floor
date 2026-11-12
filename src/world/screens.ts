import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { BRAND } from './brand.ts';
import type { BuildingLayout } from './layout.ts';

interface Person {
  spot?: string;
  meeting?: boolean;
  atSpot: boolean;
}

/** Which shared screens are on: the lounge TV while someone sits in the lounge, the meeting screen during a briefing. */
export function screensOn(people: Person[]) {
  return {
    lounge: people.some((p) => p.atSpot && !!p.spot && p.spot.includes(':lounge:')),
    meeting: people.some((p) => p.atSpot && p.meeting === true),
  };
}

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

/** A lit panel laid over a dark prop screen; redrawn a few times a second only while on. */
class Face {
  readonly mesh: Mesh;
  private ctx: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private last = -1;
  private draw: Draw;

  constructor(w: number, h: number, draw: Draw) {
    this.draw = draw;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = Math.round((512 * h) / w);
    this.ctx = c.getContext('2d')!;
    this.tex = new CanvasTexture(c);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.mesh.visible = false;
  }

  update(on: boolean, t: number) {
    this.mesh.visible = on;
    if (!on || t - this.last < 0.2) return;
    this.last = t;
    const c = this.ctx.canvas;
    this.draw(this.ctx, c.width, c.height, t);
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.tex.dispose();
  }
}

const HEAD = '"Montserrat Variable", "Inter Variable", system-ui, sans-serif';
const logo = typeof Image === 'undefined' ? null : Object.assign(new Image(), { src: '/brand/dr-wordmark.svg' });

/** Lounge TV: a Digital Recipe brand loop. */
const drawTv: Draw = (ctx, w, h, t) => {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, BRAND.ink);
  g.addColorStop(1, BRAND.purple);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // A soft light sweeping across.
  const x = ((t * 80) % (w + 200)) - 100;
  const s = ctx.createRadialGradient(x, h * 0.4, 0, x, h * 0.4, 160);
  s.addColorStop(0, 'rgba(197,168,227,0.35)');
  s.addColorStop(1, 'rgba(197,168,227,0)');
  ctx.fillStyle = s;
  ctx.fillRect(0, 0, w, h);
  if (logo?.complete && logo.naturalWidth) {
    const lw = w * 0.6;
    ctx.drawImage(logo, (w - lw) / 2, h * 0.3, lw, (lw * logo.naturalHeight) / logo.naturalWidth);
  }
  ctx.fillStyle = BRAND.paleLilac;
  ctx.font = `600 22px ${HEAD}`;
  ctx.textAlign = 'center';
  ctx.fillText('Hungry for growth?', w / 2, h * 0.78);
};

/** Meeting room screen: a strategy slide with charts that drift a little. */
const drawCharts: Draw = (ctx, w, h, t) => {
  ctx.fillStyle = BRAND.ink;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'left';
  ctx.fillStyle = BRAND.white;
  ctx.font = `700 24px ${HEAD}`;
  ctx.fillText('Q4 Growth Strategy', 24, 40);
  ctx.fillStyle = BRAND.lilac;
  ctx.font = `500 13px ${HEAD}`;
  ctx.fillText('Leads · Traffic · Conversions', 24, 62);
  // Bars: leads per month.
  const base = h - 30;
  const months = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  months.forEach((m, i) => {
    const v = 0.35 + i * 0.1 + Math.sin(t * 0.8 + i) * 0.04;
    const bh = v * (h - 110);
    const x = 30 + i * 42;
    ctx.fillStyle = i === months.length - 1 ? BRAND.amber : BRAND.purple;
    ctx.fillRect(x, base - bh, 28, bh);
    ctx.fillStyle = BRAND.paleLilac;
    ctx.font = `500 11px ${HEAD}`;
    ctx.fillText(m, x + 2, base + 16);
  });
  // Line: conversion rate trending up.
  ctx.strokeStyle = BRAND.lilac;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const x = 300 + i * 19;
    const y = base - 20 - i * 12 - Math.sin(t * 1.2 + i * 0.7) * 6;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = BRAND.amber;
  ctx.font = `700 20px ${HEAD}`;
  ctx.fillText('+38%', 420, 100);
};

/** The two shared screens, placed over the lounge TV and the meeting room's wall screen. */
export class Screens {
  readonly root = new Group();
  private lounge: Face | null = null;
  private meeting: Face | null = null;

  layout(L: BuildingLayout) {
    this.clear();
    for (const a of L.amenities) {
      if (a.kind !== 'lounge' && a.kind !== 'meeting') continue;
      const frame = new Group();
      frame.position.set(a.rect.x, 0, a.rect.z);
      frame.rotation.y = a.side === 'north' ? 0 : Math.PI;
      let face: Face;
      if (a.kind === 'lounge') {
        // Building: tv(k, 0.2, 1.6, PI); screen 1.32 x 0.72 at height 1.0, just in front of the panel.
        face = this.lounge = new Face(1.32, 0.72, drawTv);
        const tv = new Group();
        tv.position.set(0.2, 0, 1.6);
        tv.rotation.y = Math.PI;
        face.mesh.position.set(0, 1.0, -0.04);
        tv.add(face.mesh);
        frame.add(tv);
      } else {
        // Building: wall screen 1.9 x 1.05 at height 1.65 on the back wall (z = -d/2 + 0.115).
        face = this.meeting = new Face(1.9, 1.05, drawCharts);
        face.mesh.position.set(0, 1.65, -a.rect.d / 2 + 0.125);
        frame.add(face.mesh);
      }
      this.root.add(frame);
    }
  }

  update(on: { lounge: boolean; meeting: boolean }, t: number) {
    this.lounge?.update(on.lounge, t);
    this.meeting?.update(on.meeting, t);
  }

  private clear() {
    this.lounge?.dispose();
    this.meeting?.dispose();
    this.lounge = this.meeting = null;
    this.root.clear();
  }
}
