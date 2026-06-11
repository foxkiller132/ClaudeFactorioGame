// Canvas renderer. Terrain is rasterised once per chunk into an offscreen
// canvas cache and redrawn only when the chunk changes (mined-out tiles), so
// per-frame terrain cost is a handful of drawImage calls regardless of base
// size. Entities are culled to the viewport. draw(t) takes wall-clock seconds
// to drive animations; all animation is render-side and never touches sim state.

import {
  CHUNK, TILE_PX, T_GRASS, T_ROCK, T_ABYSS, T_CRYSTAL, T_STONE, T_LEYWELL,
  LINK_RANGE,
} from './config.js';
import { ITEMS } from './defs.js';
import { h2 } from './world.js';

const TERRAIN_COLORS = {
  [T_GRASS]: ['#232e1e', '#283424', '#1f2a1c'],
  [T_ROCK]: ['#45454c', '#3c3c44', '#50505a'],
  [T_ABYSS]: ['#07070f', '#0b0a16', '#090812'],
  [T_CRYSTAL]: ['#1c5a6c', '#247288', '#1a4f60'],
  [T_STONE]: ['#5c5c50', '#52524a', '#646456'],
  [T_LEYWELL]: ['#552a85', '#6a37a5', '#4b2478'],
};

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.cam = { x: 0, y: 0, zoom: 24 }; // zoom = screen px per tile
    this.chunkCache = new Map();          // key -> canvas
    this.hover = null;                    // {x, y} tile under cursor
    this.hoverF = null;                   // precise world coords under cursor
    this.placing = null;                  // building type being placed (ghost)
    this.pLastX = game.player.x;          // wizard walk-cycle bookkeeping
    this.pLastY = game.player.y;
    this.pFace = 1;
    this.pPhase = 0;
  }

  worldToScreen(wx, wy) {
    return [
      (wx - this.cam.x) * this.cam.zoom + this.canvas.width / 2,
      (wy - this.cam.y) * this.cam.zoom + this.canvas.height / 2,
    ];
  }

  screenToWorld(sx, sy) {
    return [
      (sx - this.canvas.width / 2) / this.cam.zoom + this.cam.x,
      (sy - this.canvas.height / 2) / this.cam.zoom + this.cam.y,
    ];
  }

  chunkCanvas(cx, cy) {
    const key = cx + ',' + cy;
    const world = this.game.world;
    if (world.dirty.has(key)) {
      this.chunkCache.delete(key);
      world.dirty.delete(key);
    }
    let cv = this.chunkCache.get(key);
    if (!cv) {
      const chunk = world.chunkAt(cx, cy);
      cv = document.createElement('canvas');
      cv.width = cv.height = CHUNK * TILE_PX;
      const c = cv.getContext('2d');
      for (let ly = 0; ly < CHUNK; ly++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          const t = chunk.tiles[ly * CHUNK + lx];
          const wx = cx * CHUNK + lx, wy = cy * CHUNK + ly;
          const shades = TERRAIN_COLORS[t];
          c.fillStyle = shades[(h2(wx, wy, 99) * shades.length) | 0];
          c.fillRect(lx * TILE_PX, ly * TILE_PX, TILE_PX, TILE_PX);
          if (t === T_GRASS && h2(wx, wy, 101) < 0.12) {
            c.fillStyle = '#31402a'; // tufts of arcane moss
            c.fillRect(lx * TILE_PX + 2, ly * TILE_PX + 3, 2, 1);
            c.fillRect(lx * TILE_PX + 5, ly * TILE_PX + 5, 1, 2);
          }
          if (t === T_CRYSTAL) {
            c.fillStyle = '#7fe8f8';
            c.fillRect(lx * TILE_PX + 2, ly * TILE_PX + 3, 2, 2);
            c.fillStyle = '#bff4ff';
            c.fillRect(lx * TILE_PX + 5, ly * TILE_PX + 5, 1, 1);
          }
          if (t === T_STONE) {
            c.fillStyle = '#787868';
            c.fillRect(lx * TILE_PX + 2, ly * TILE_PX + 4, 3, 2);
          }
          if (t === T_ABYSS && h2(wx, wy, 103) < 0.06) {
            c.fillStyle = '#3a3a6a'; // faint void-stars
            c.fillRect(lx * TILE_PX + (h2(wx, wy, 104) * 6 | 0), ly * TILE_PX + (h2(wx, wy, 105) * 6 | 0), 1, 1);
          }
        }
      }
      this.chunkCache.set(key, cv);
      if (this.chunkCache.size > 256) {
        for (const k of this.chunkCache.keys()) {
          if (this.chunkCache.size <= 192) break;
          this.chunkCache.delete(k);
        }
      }
    }
    return cv;
  }

  draw(t = 0) {
    const { ctx, canvas, cam, game } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const [wx0, wy0] = this.screenToWorld(0, 0);
    const [wx1, wy1] = this.screenToWorld(canvas.width, canvas.height);
    const c0x = Math.floor(wx0 / CHUNK), c0y = Math.floor(wy0 / CHUNK);
    const c1x = Math.floor(wx1 / CHUNK), c1y = Math.floor(wy1 / CHUNK);
    const z = cam.zoom;

    // terrain + corruption haze
    const scale = z / TILE_PX;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const cv = this.chunkCanvas(cx, cy);
        const [sx, sy] = this.worldToScreen(cx * CHUNK, cy * CHUNK);
        ctx.drawImage(cv, sx, sy, cv.width * scale, cv.height * scale);
        const cor = game.corruption.get(cx + ',' + cy) || 0;
        if (cor > 0.5) {
          const breathe = 1 + 0.15 * Math.sin(t * 1.3 + cx * 2.1 + cy * 3.7);
          ctx.fillStyle = `rgba(160, 40, 120, ${Math.min(0.35, cor / 120) * breathe})`;
          ctx.fillRect(sx, sy, CHUNK * z, CHUNK * z);
        }
      }
    }

    // animated shimmer on crystal and ley-well tiles (skipped when zoomed far out)
    if (z >= 10) this.drawTileShimmer(t, wx0, wy0, wx1, wy1);

    const inView = (x, y, m = 2) => x > wx0 - m && x < wx1 + m && y > wy0 - m && y < wy1 + m;

    // dark shrines
    for (const n of game.nests) {
      if (!inView(n.x, n.y)) continue;
      const [sx, sy] = this.worldToScreen(n.x + 0.5, n.y + 0.5);
      const pulse = 1 + 0.12 * Math.sin(t * 2 + n.x);
      const aura = ctx.createRadialGradient(sx, sy, 0, sx, sy, z * 1.6 * pulse);
      aura.addColorStop(0, 'rgba(120, 20, 90, 0.45)');
      aura.addColorStop(1, 'rgba(120, 20, 90, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath(); ctx.arc(sx, sy, z * 1.6 * pulse, 0, 7); ctx.fill();
      ctx.fillStyle = '#2a0c24';
      ctx.beginPath(); ctx.arc(sx, sy, z * 0.55, 0, 7); ctx.fill();
      ctx.fillStyle = '#d050b0';
      this.glyph(ctx, '☠', sx, sy, z * 0.7 * pulse);
    }

    // buildings
    for (const b of game.buildings.values()) {
      if (!inView(b.x, b.y)) continue;
      const [sx, sy] = this.worldToScreen(b.x, b.y);
      const cxm = sx + z / 2, cym = sy + z / 2;
      const working = b.wants && b.ratio > 0;

      // working glow
      if (working && z >= 8) {
        const a = 0.18 + 0.1 * Math.sin(t * 4 + b.id);
        const glow = ctx.createRadialGradient(cxm, cym, 0, cxm, cym, z * 0.9);
        glow.addColorStop(0, this.rgba(b.def.color, a));
        glow.addColorStop(1, this.rgba(b.def.color, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(sx - z / 2, sy - z / 2, z * 2, z * 2);
      }

      ctx.fillStyle = '#14141e';
      ctx.fillRect(sx + 1, sy + 1, z - 2, z - 2);
      const powered = b.network >= 0 || b.def.coverage;
      ctx.strokeStyle = powered ? b.def.color : '#803030';
      ctx.lineWidth = Math.max(1, z / 16);
      ctx.strokeRect(sx + 1, sy + 1, z - 2, z - 2);

      // glyph, gently pulsing while working
      ctx.fillStyle = b.def.color;
      const gs = z * 0.6 * (working ? 1 + 0.06 * Math.sin(t * 5 + b.id) : 1);
      this.glyph(ctx, b.def.glyph, cxm, cym, gs);

      // progress arc
      if (b.progress > 0 && z >= 12) {
        ctx.strokeStyle = '#f0d060';
        ctx.lineWidth = Math.max(1.5, z / 14);
        ctx.beginPath();
        ctx.arc(cxm, cym, z * 0.42, -Math.PI / 2, -Math.PI / 2 + Math.min(1, b.progress) * Math.PI * 2);
        ctx.stroke();
      }
      // damage bar
      if (b.hp < b.def.hp) {
        ctx.fillStyle = '#301018';
        ctx.fillRect(sx + 1, sy - 3, z - 2, 3);
        ctx.fillStyle = '#f04040';
        ctx.fillRect(sx + 1, sy - 3, (z - 2) * (b.hp / b.def.hp), 3);
      }
      // unpowered consumers flash a warning
      if (!powered && b.def.manaUse && Math.sin(t * 3) > 0 && z >= 10) {
        ctx.fillStyle = '#f0c040';
        this.glyph(ctx, '⚡', sx + z - z * 0.22, sy + z * 0.22, z * 0.4);
      }
    }

    // portal links: drifting motes along the connection
    for (const b of game.buildings.values()) {
      if (b.type === 'portal' && b.linkId > b.id) {
        const tw = game.buildings.get(b.linkId);
        if (!tw) continue;
        const [ax, ay] = this.worldToScreen(b.x + 0.5, b.y + 0.5);
        const [bx, by] = this.worldToScreen(tw.x + 0.5, tw.y + 0.5);
        ctx.strokeStyle = 'rgba(96, 224, 192, 0.18)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.fillStyle = 'rgba(140, 240, 210, 0.8)';
        for (let i = 0; i < 3; i++) {
          const f = ((t * 0.25 + i / 3) % 1);
          ctx.beginPath();
          ctx.arc(ax + (bx - ax) * f, ay + (by - ay) * f, 2.5, 0, 7);
          ctx.fill();
        }
      }
    }

    this.drawWizard(t);

    // golems: bobbing couriers
    for (const g of game.golems) {
      if (!inView(g.x, g.y)) continue;
      const [sx, syRaw] = this.worldToScreen(g.x, g.y);
      const busy = g.state !== 'idle';
      const sy = syRaw + Math.sin(t * (busy ? 9 : 4) + g.x * 3) * z * 0.06;
      const r = Math.max(2.5, z * 0.18);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(sx, syRaw + r * 1.3, r * 0.8, r * 0.3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#c08850';
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
      ctx.fillStyle = '#7adcff'; // rune-spark core
      ctx.beginPath(); ctx.arc(sx, sy - r * 0.15, r * 0.3, 0, 7); ctx.fill();
      if (g.carry && z >= 12) {
        ctx.fillStyle = (ITEMS[g.carry.item] || {}).color || '#fff';
        ctx.fillRect(sx - r * 0.45, sy - r * 1.6, r * 0.9, r * 0.9);
      }
    }

    // wraiths: flickering, trailing ghosts
    for (const w of game.wraiths) {
      if (!inView(w.x, w.y)) continue;
      const [sx, syRaw] = this.worldToScreen(w.x, w.y);
      const sy = syRaw + Math.sin(t * 3 + w.x * 5) * z * 0.1;
      const r = Math.max(3, z * 0.28);
      const flicker = 0.55 + 0.2 * Math.sin(t * 7 + w.y * 4);
      for (let i = 3; i >= 1; i--) { // fading tail
        ctx.fillStyle = `rgba(140, 230, 200, ${flicker * 0.12 * (4 - i)})`;
        ctx.beginPath();
        ctx.arc(sx, sy + i * r * 0.45, r * (1 - i * 0.18), 0, 7);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(150, 235, 205, ${flicker})`;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
      ctx.fillStyle = '#0a2a20';
      const ew = Math.max(1.5, r * 0.22);
      ctx.fillRect(sx - r * 0.45, sy - r * 0.15, ew, ew);
      ctx.fillRect(sx + r * 0.2, sy - r * 0.15, ew, ew);
      if (w.hp < w.maxHp) {
        ctx.fillStyle = '#f04040';
        ctx.fillRect(sx - r, sy - r * 1.6, r * 2 * (w.hp / w.maxHp), 2);
      }
    }

    this.drawEffects(t);

    // placement ghost + coverage preview
    if (this.placing && this.hover) {
      const { x, y } = this.hover;
      const [sx, sy] = this.worldToScreen(x, y);
      ctx.globalAlpha = 0.4 + 0.15 * Math.sin(t * 5);
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx, sy, z, z);
      ctx.globalAlpha = 1;
      const def = this.placingDef;
      if (def && def.coverage) {
        const [gx, gy] = this.worldToScreen(x + 0.5, y + 0.5);
        ctx.strokeStyle = 'rgba(160, 120, 255, 0.6)';
        ctx.beginPath(); ctx.arc(gx, gy, def.coverage * z, 0, 7); ctx.stroke();
        ctx.strokeStyle = 'rgba(160, 120, 255, 0.2)';
        ctx.beginPath(); ctx.arc(gx, gy, LINK_RANGE * z, 0, 7); ctx.stroke();
      }
    }

    // soft vignette
    const vg = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.45,
      canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,10,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawTileShimmer(t, wx0, wy0, wx1, wy1) {
    const { ctx, game } = this;
    const z = this.cam.zoom;
    const x0 = Math.floor(wx0), x1 = Math.ceil(wx1);
    const y0 = Math.floor(wy0), y1 = Math.ceil(wy1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tt = game.world.getTile(x, y);
        if (tt === T_CRYSTAL) {
          const tw = Math.sin(t * 2.5 + h2(x, y, 7) * 6.28);
          if (tw > 0.6) {
            const [sx, sy] = this.worldToScreen(x + 0.3 + h2(x, y, 8) * 0.4, y + 0.3 + h2(x, y, 9) * 0.4);
            ctx.fillStyle = `rgba(220, 250, 255, ${(tw - 0.6) * 2})`;
            ctx.beginPath();
            ctx.moveTo(sx, sy - z * 0.12); ctx.lineTo(sx + z * 0.08, sy);
            ctx.lineTo(sx, sy + z * 0.12); ctx.lineTo(sx - z * 0.08, sy);
            ctx.fill();
          }
        } else if (tt === T_LEYWELL) {
          const [sx, sy] = this.worldToScreen(x + 0.5, y + 0.5);
          const p = 0.5 + 0.5 * Math.sin(t * 1.8 + x + y);
          const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, z * (0.8 + p * 0.4));
          glow.addColorStop(0, `rgba(190, 130, 255, ${0.12 + p * 0.12})`);
          glow.addColorStop(1, 'rgba(190, 130, 255, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(sx, sy, z * 1.3, 0, 7); ctx.fill();
        }
      }
    }
  }

  drawWizard(t) {
    const { ctx, game } = this;
    const z = this.cam.zoom;
    const p = game.player;
    const moved = Math.hypot(p.x - this.pLastX, p.y - this.pLastY);
    if (p.x !== this.pLastX) this.pFace = p.x > this.pLastX ? 1 : -1;
    this.pPhase = moved > 0.001 ? this.pPhase + moved * 6 : 0;
    this.pLastX = p.x; this.pLastY = p.y;

    const [sx, syRaw] = this.worldToScreen(p.x, p.y);
    const r = Math.max(4, z * 0.32);
    const bob = Math.abs(Math.sin(this.pPhase)) * r * 0.18;
    const sy = syRaw - bob;
    const f = this.pFace;

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(sx, syRaw + r * 0.8, r * 0.9, r * 0.35, 0, 0, 7); ctx.fill();

    // staff with breathing glow
    const stx = sx + f * r * 1.1, sty = sy - r * 1.2;
    ctx.strokeStyle = '#6a4a28';
    ctx.lineWidth = Math.max(1.5, r * 0.16);
    ctx.beginPath(); ctx.moveTo(sx + f * r * 0.7, sy + r * 0.7); ctx.lineTo(stx, sty); ctx.stroke();
    const op = 0.6 + 0.4 * Math.sin(t * 3);
    const orb = ctx.createRadialGradient(stx, sty, 0, stx, sty, r * 0.8);
    orb.addColorStop(0, `rgba(140, 220, 255, ${op})`);
    orb.addColorStop(1, 'rgba(140, 220, 255, 0)');
    ctx.fillStyle = orb;
    ctx.beginPath(); ctx.arc(stx, sty, r * 0.8, 0, 7); ctx.fill();
    ctx.fillStyle = '#cdeaff';
    ctx.beginPath(); ctx.arc(stx, sty, r * 0.18, 0, 7); ctx.fill();

    // robe, face, hat
    ctx.fillStyle = '#4868d0';
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#3a54b0';
    ctx.beginPath(); ctx.arc(sx, sy + r * 0.4, r * 0.85, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#e8d8b0';
    ctx.beginPath(); ctx.arc(sx + f * r * 0.1, sy - r * 0.35, r * 0.45, 0, 7); ctx.fill();
    ctx.fillStyle = '#283a90';
    ctx.beginPath();
    ctx.moveTo(sx - r * 0.8, sy - r * 0.55);
    ctx.lineTo(sx + r * 0.8, sy - r * 0.55);
    ctx.lineTo(sx + f * r * 0.25, sy - r * 1.9);
    ctx.closePath(); ctx.fill();
  }

  drawEffects(t) {
    const { ctx, game } = this;
    const z = this.cam.zoom;
    for (const e of game.effects) {
      const [sx, sy] = this.worldToScreen(e.x, e.y);
      if (e.type === 'beam') {
        const [tx, ty] = this.worldToScreen(e.x2, e.y2);
        const a = e.ttl / 0.15;
        ctx.strokeStyle = `rgba(240, 248, 255, ${a})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.strokeStyle = `rgba(120, 200, 255, ${a * 0.6})`;
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.fillStyle = `rgba(220, 245, 255, ${a})`; // impact spark
        ctx.beginPath(); ctx.arc(tx, ty, 3 + (1 - a) * 5, 0, 7); ctx.fill();
      } else if (e.type === 'toast') {
        const life = 1 - e.ttl / 1.4;
        ctx.font = `bold 14px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const ty = sy - 10 - life * 26;
        ctx.fillStyle = `rgba(10, 8, 20, ${0.75 * (1 - life)})`;
        const w = ctx.measureText(e.text).width;
        ctx.fillRect(sx - w / 2 - 6, ty - 17, w + 12, 21);
        ctx.fillStyle = `rgba(255, 210, 130, ${1 - life})`;
        ctx.fillText(e.text, sx, ty);
      } else if (e.type === 'pop' || e.type === 'banish' || e.type === 'warp') {
        const max = e.type === 'banish' ? 0.8 : e.type === 'pop' ? 0.4 : 0.3;
        const k = 1 - e.ttl / max;
        const col = e.type === 'banish' ? '240,80,80' : e.type === 'warp' ? '96,224,192' : '140,230,200';
        ctx.strokeStyle = `rgba(${col}, ${1 - k})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(sx, sy, k * z * (e.type === 'banish' ? 4 : 1), 0, 7); ctx.stroke();
        if (e.type === 'banish') {
          ctx.beginPath(); ctx.arc(sx, sy, k * z * 2.4, 0, 7); ctx.stroke();
        }
      }
    }
  }

  rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  glyph(ctx, ch, x, y, size) {
    ctx.font = `${size | 0}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y);
  }
}
