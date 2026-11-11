import { BRAND } from './brand';
import { MeshBasicMaterial } from 'three';
import type { Agent, Status } from '../../shared/protocol';
import { STATUS_COLORS, STATUS_LABEL } from './palette';
import { fit, makeCanvas, MONO_FONT, roundRect, UI_FONT, wrap } from './text';
import { REC } from './quality';

const RES = REC ? 2 : 1;

const W = 512;
const H = 320;

// Syntax-ish colours for the fake code scroll. Muted so the activity text leads.
const CODE = ['#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#7dcfff', '#c0caf5', '#565f89'];

/**
 * The monitor on each desk. Draws the agent's live state into a canvas texture.
 * Only redraws when something visible changes, or on a slow tick while working.
 */
export class Screen {
  readonly texture;
  private ctx;
  private key = '';
  private scroll = 0;
  private seed: number;
  private lastTick = 0;

  constructor(seed: number) {
    const { ctx, texture } = makeCanvas(W * RES, H * RES);
    // Draw in the same 512x320 units at any resolution.
    ctx.scale(RES, RES);
    this.ctx = ctx;
    this.texture = texture;
    this.seed = seed;
  }

  update(agent: Agent, time: number, dark: boolean) {
    const animated = agent.status === 'working' || agent.status === 'thinking';
    const key = `${agent.status}|${agent.tool}|${agent.activity}|${dark}`;
    if (key === this.key && !(animated && time - this.lastTick > 0.14)) return;
    this.key = key;
    this.lastTick = time;
    if (agent.status === 'working') this.scroll += 1;
    this.draw(agent, time);
  }

  private draw(agent: Agent, time: number) {
    const c = this.ctx;
    const status: Status = agent.status;
    const color = STATUS_COLORS[status];

    c.fillStyle = status === 'error' ? '#2a0f12' : status === 'waiting' ? '#2a1f0b' : '#0d1117';
    c.fillRect(0, 0, W, H);

    if (status === 'idle' || status === 'offline' || status === 'done') {
      this.drawRest(status, color, time);
      this.texture.needsUpdate = true;
      return;
    }

    // Title bar: tool + status
    c.fillStyle = '#161b22';
    c.fillRect(0, 0, W, 54);
    c.fillStyle = color;
    roundRect(c, 20, 17, 20, 20, 6);
    c.fill();
    c.font = `600 24px ${UI_FONT}`;
    c.fillStyle = '#e6edf3';
    c.textBaseline = 'middle';
    c.fillText(fit(c, agent.tool || STATUS_LABEL[status], 300), 54, 28);
    c.font = `500 18px ${MONO_FONT}`;
    c.fillStyle = color;
    c.textAlign = 'right';
    c.fillText(STATUS_LABEL[status].toUpperCase(), W - 20, 28);
    c.textAlign = 'left';

    // Activity, large
    c.font = `500 27px ${UI_FONT}`;
    c.fillStyle = '#f0f3f6';
    const lines = wrap(c, agent.activity || '', W - 40, 2);
    lines.forEach((l, i) => c.fillText(l, 20, 90 + i * 34));

    // Body: code scroll while working, pulsing dots while thinking, banner when waiting/error
    const top = 90 + lines.length * 34 + 8;
    if (status === 'working') {
      this.drawCode(top);
    } else if (status === 'thinking') {
      for (let i = 0; i < 3; i++) {
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(time * 4 - i * 0.7));
        c.globalAlpha = a;
        c.fillStyle = color;
        c.beginPath();
        c.arc(W / 2 - 34 + i * 34, top + (H - top) / 2, 10, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    } else {
      c.fillStyle = color;
      c.font = `700 30px ${UI_FONT}`;
      c.textAlign = 'center';
      c.fillText(status === 'waiting' ? 'Waiting for you' : 'Something broke', W / 2, top + (H - top) / 2);
      c.textAlign = 'left';
    }
    this.texture.needsUpdate = true;
  }

  private drawCode(top: number) {
    const c = this.ctx;
    const lineH = 20;
    const rows = Math.floor((H - top - 10) / lineH);
    for (let r = 0; r < rows; r++) {
      const n = r + this.scroll;
      let x = 20 + ((n * 7 + this.seed) % 4) * 18;
      const pieces = 1 + ((n * 13 + this.seed) % 4);
      for (let p = 0; p < pieces; p++) {
        const w = 24 + ((n * 31 + p * 17 + this.seed) % 90);
        if (x + w > W - 20) break;
        c.fillStyle = CODE[(n * 5 + p * 3 + this.seed) % CODE.length];
        c.globalAlpha = 0.85;
        roundRect(c, x, top + r * lineH + 4, w, 10, 4);
        c.fill();
        x += w + 10;
      }
    }
    c.globalAlpha = 1;
    // Caret
    c.fillStyle = '#e6edf3';
    c.fillRect(20, top + rows * lineH - 6, 10, 16);
  }

  private drawRest(status: Status, color: string, time: number) {
    const c = this.ctx;
    // Calm screensaver: a soft glow that drifts slowly.
    const gx = W / 2 + Math.sin(time * 0.3 + this.seed) * 90;
    const g = c.createRadialGradient(gx, H / 2, 10, gx, H / 2, 260);
    g.addColorStop(0, status === 'done' ? 'rgba(34,197,94,0.28)' : 'rgba(120,140,170,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.font = `700 40px ${UI_FONT}`;
    c.fillText(status === 'done' ? 'Done' : status === 'offline' ? 'Signed out' : 'Idle', W / 2, H / 2 - 10);
    c.font = `500 20px ${MONO_FONT}`;
    c.fillStyle = 'rgba(230,237,243,0.55)';
    c.fillText(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), W / 2, H / 2 + 34);
    c.textAlign = 'left';
  }

  dispose() {
    this.texture.dispose();
  }
}

// ---------------------------------------------------------------- side monitors
// Second screens show something static: docs, a terminal, a PR, a chart.
const sideCache: MeshBasicMaterial[] = [];

export function sideScreenMaterial(i: number) {
  const k = i % 4;
  if (sideCache[k]) return sideCache[k];
  const { ctx, texture } = makeCanvas(256, 160);
  if (k === 0) {
    // Docs page
    ctx.fillStyle = '#f6f8fa';
    ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = '#1e2430';
    ctx.fillRect(16, 16, 120, 12);
    ctx.fillStyle = '#c9d1d9';
    for (let y = 40; y < 150; y += 12) ctx.fillRect(16, y, 140 + ((y * 7) % 80), 5);
    ctx.fillStyle = BRAND.purple;
    ctx.fillRect(16, 100, 60, 5);
  } else if (k === 1) {
    // Terminal
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, 256, 160);
    ctx.font = `600 13px ${MONO_FONT}`;
    const lines = ['$ npm test', '  ✓ cart totals', '  ✓ checkout flow', '  ✓ refunds', 'Tests 48 passed', '$ git push', '$ _'];
    lines.forEach((l, i) => {
      ctx.fillStyle = l.startsWith('$') ? '#9ece6a' : l.includes('✓') ? '#7dcfff' : '#c0caf5';
      ctx.fillText(l, 12, 22 + i * 19);
    });
  } else if (k === 2) {
    // Pull request diff
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, 256, 160);
    for (let y = 10; y < 160; y += 11) {
      const add = (y * 13) % 5 === 0;
      const del = (y * 7) % 6 === 0;
      ctx.fillStyle = add ? 'rgba(46,160,67,0.35)' : del ? 'rgba(248,81,73,0.3)' : 'transparent';
      ctx.fillRect(0, y - 2, 256, 10);
      ctx.fillStyle = add ? '#7ee787' : del ? '#ffa198' : '#8b949e';
      ctx.fillRect(14, y, 40 + ((y * 17) % 150), 5);
    }
  } else {
    // A metrics chart
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 160);
    ctx.strokeStyle = '#e5e7eb';
    for (let y = 30; y < 150; y += 30) {
      ctx.beginPath();
      ctx.moveTo(16, y);
      ctx.lineTo(240, y);
      ctx.stroke();
    }
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 16; x <= 240; x += 16) ctx.lineTo(x, 120 - Math.sin(x / 30) * 30 - x / 6);
    ctx.stroke();
  }
  texture.needsUpdate = true;
  sideCache[k] = new MeshBasicMaterial({ map: texture, toneMapped: false });
  return sideCache[k];
}
