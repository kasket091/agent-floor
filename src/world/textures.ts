import { BRAND } from './brand';
import { CanvasTexture, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { REC } from './quality';

// Procedural textures, drawn once and shared. No image files ship with the app.

function canvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = REC ? 16 : 8;
  if (repeat) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const cache = new Map<string, Texture>();
function once(key: string, make: () => Texture) {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make()));
  return t;
}

/** Light oak planks, greyscale-ish so the material colour can warm or darken it. */
export const planks = () =>
  once('planks', () =>
    canvas(512, 512, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 512, 512);
      const rows = 8;
      for (let r = 0; r < rows; r++) {
        let x = -rnd() * 300;
        while (x < 512) {
          const len = 180 + rnd() * 220;
          const v = 225 + Math.floor(rnd() * 30);
          ctx.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
          ctx.fillRect(x, r * 64, len, 64);
          // grain
          ctx.strokeStyle = 'rgba(120,90,60,0.08)';
          for (let g = 0; g < 6; g++) {
            ctx.beginPath();
            const y = r * 64 + 6 + rnd() * 52;
            ctx.moveTo(x, y);
            ctx.bezierCurveTo(x + len * 0.3, y + rnd() * 6 - 3, x + len * 0.6, y + rnd() * 6 - 3, x + len, y);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(80,60,40,0.22)';
          ctx.fillRect(x, r * 64, 2, 64);
          x += len;
        }
        ctx.fillStyle = 'rgba(80,60,40,0.25)';
        ctx.fillRect(0, r * 64, 512, 2);
      }
    }, [1, 1]),
  );

/** Carpet tiles. White base, tinted by the team colour through material.color. */
export const carpetTiles = () =>
  once('carpet', () =>
    canvas(256, 256, (ctx) => {
      for (let ty = 0; ty < 2; ty++)
        for (let tx = 0; tx < 2; tx++) {
          const base = 238 + Math.floor(rnd() * 12);
          ctx.fillStyle = `rgb(${base},${base},${base})`;
          ctx.fillRect(tx * 128, ty * 128, 128, 128);
          // Tiles alternate fibre direction.
          ctx.strokeStyle = 'rgba(0,0,0,0.05)';
          for (let i = 0; i < 128; i += 4) {
            ctx.beginPath();
            if ((tx + ty) % 2) {
              ctx.moveTo(tx * 128 + i, ty * 128);
              ctx.lineTo(tx * 128 + i, ty * 128 + 128);
            } else {
              ctx.moveTo(tx * 128, ty * 128 + i);
              ctx.lineTo(tx * 128 + 128, ty * 128 + i);
            }
            ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(0,0,0,0.08)';
          ctx.strokeRect(tx * 128 + 0.5, ty * 128 + 0.5, 127, 127);
        }
    }, [1, 1]),
  );

/** Polished terrazzo for the lobby and kitchen. */
export const terrazzo = () =>
  once('terrazzo', () =>
    canvas(512, 512, (ctx) => {
      ctx.fillStyle = '#f2f1ee';
      ctx.fillRect(0, 0, 512, 512);
      const chips = ['#c9c4bb', '#a9b4bf', '#e2a58b', '#8c939c', '#d9d2c3', '#b9c6b1'];
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = chips[Math.floor(rnd() * chips.length)];
        ctx.beginPath();
        const r = 1.5 + rnd() * 5;
        ctx.ellipse(rnd() * 512, rnd() * 512, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, 512, 512);
    }, [1, 1]),
  );

export const grass = () =>
  once('grass', () =>
    canvas(256, 256, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) {
        const v = 200 + Math.floor(rnd() * 55);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(rnd() * 256, rnd() * 256, 1.5, 3 + rnd() * 3);
      }
    }, [1, 1]),
  );

export const paving = () =>
  once('paving', () =>
    canvas(256, 256, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 2; x++) {
          const v = 232 + Math.floor(rnd() * 20);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(x * 128 + (y % 2) * 64, y * 64, 126, 62);
          ctx.fillRect(x * 128 + (y % 2) * 64 - 256, y * 64, 126, 62);
        }
    }, [1, 1]),
  );

const POSTER_SETS = [
  ['#ff5f2e', '#1e2430', '#f2cc8f'],
  ['#3d5a80', '#98c1d9', '#e0fbfc'],
  ['#2a9d8f', '#e9c46a', '#264653'],
  ['#e07a5f', '#81b29a', '#f4f1de'],
  ['#6d597a', '#b56576', '#eaac8b'],
  ['#1d3557', '#e63946', '#f1faee'],
];

/** Abstract art prints. Six variants, shared by every wall. */
export function posterMaterial(i: number) {
  const k = i % POSTER_SETS.length;
  return matOnce(`poster${k}`, () => {
    const [a, b, c] = POSTER_SETS[k];
    const t = canvas(192, 256, (ctx) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 192, 256);
      ctx.fillStyle = a;
      if (k % 3 === 0) {
        ctx.beginPath();
        ctx.arc(96, 110, 62, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = b;
        ctx.fillRect(0, 170, 192, 86);
      } else if (k % 3 === 1) {
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = i % 2 ? a : b;
          ctx.fillRect(20 + i * 30, 40 + i * 18, 26, 170 - i * 18);
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(0, 256);
        ctx.lineTo(96, 60);
        ctx.lineTo(192, 256);
        ctx.fill();
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.arc(140, 70, 28, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    return new MeshStandardMaterial({ map: t, roughness: 0.7 });
  });
}

export const clockMaterial = () =>
  matOnce('clock', () => {
    const t = canvas(128, 128, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(64, 64, 62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1e2430';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.fillRect(64 + Math.cos(a) * 50 - 2, 64 + Math.sin(a) * 50 - 2, 4, 4);
      }
      ctx.strokeStyle = '#1e2430';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(64, 64);
      ctx.lineTo(64, 28);
      ctx.moveTo(64, 64);
      ctx.lineTo(90, 72);
      ctx.stroke();
      ctx.strokeStyle = BRAND.purple;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(64, 64);
      ctx.lineTo(40, 98);
      ctx.stroke();
    });
    return new MeshStandardMaterial({ map: t, roughness: 0.4 });
  });

/** The big lobby wall sign. */
/** The Digital Recipe wordmark (white SVG) for the lobby's purple logo wall. */
export const logoMaterial = () =>
  matOnce('logo', () => {
    const t = canvas(1024, 256, (ctx) => ctx.clearRect(0, 0, 1024, 256));
    const img = new Image();
    img.onload = () => {
      const c = t.image as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const w = c.width * 0.84;
      const h = (w * img.naturalHeight) / img.naturalWidth;
      ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
      t.needsUpdate = true; // the canvas was blank until the SVG arrived
    };
    img.src = '/brand/dr-wordmark.svg';
    return new MeshStandardMaterial({ map: t, transparent: true, roughness: 0.5 });
  });

const mats = new Map<string, MeshStandardMaterial>();
function matOnce(key: string, make: () => MeshStandardMaterial) {
  let m = mats.get(key);
  if (!m) mats.set(key, (m = make()));
  return m;
}
