// Canvas renderer. Terrain is rasterised once per chunk into an offscreen
// canvas cache and redrawn only when the chunk changes (mined-out tiles), so
// per-frame terrain cost is a handful of drawImage calls regardless of base
// size. Entities are culled to the viewport.

import { CHUNK, TILE_PX, T_GRASS, T_ROCK, T_ABYSS, T_CRYSTAL, T_STONE, T_LEYWELL } from './config.js';
import { LINK_RANGE, PLAYER_REACH } from './config.js';

const TERRAIN_COLORS = {
  [T_GRASS]: ['#26301f', '#2b3623'],
  [T_ROCK]: ['#46464a', '#3e3e42'],
  [T_ABYSS]: ['#0a0a14', '#0d0c18'],
  [T_CRYSTAL]: ['#1e5f6e', '#27778a'],
  [T_STONE]: ['#5c5c50', '#52524a'],
  [T_LEYWELL]: ['#5a2d8a', '#6e3aa8'],
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
    this.showReach = false;               // draw the wizard's reach ring (active tool)
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
          const pair = TERRAIN_COLORS[t];
          c.fillStyle = pair[(lx + ly) & 1];
          c.fillRect(lx * TILE_PX, ly * TILE_PX, TILE_PX, TILE_PX);
          if (t === T_CRYSTAL || t === T_LEYWELL) {
            c.fillStyle = t === T_CRYSTAL ? '#7fe8f8' : '#b080ff';
            c.fillRect(lx * TILE_PX + 3, ly * TILE_PX + 3, 2, 2);
          }
        }
      }
      this.chunkCache.set(key, cv);
      // keep cache bounded; evict arbitrary old entries
      if (this.chunkCache.size > 256) {
        for (const k of this.chunkCache.keys()) {
          if (this.chunkCache.size <= 192) break;
          this.chunkCache.delete(k);
        }
      }
    }
    return cv;
  }

  draw() {
    const { ctx, canvas, cam, game } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const [wx0, wy0] = this.screenToWorld(0, 0);
    const [wx1, wy1] = this.screenToWorld(canvas.width, canvas.height);
    const c0x = Math.floor(wx0 / CHUNK), c0y = Math.floor(wy0 / CHUNK);
    const c1x = Math.floor(wx1 / CHUNK), c1y = Math.floor(wy1 / CHUNK);

    // terrain
    const scale = cam.zoom / TILE_PX;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const cv = this.chunkCanvas(cx, cy);
        const [sx, sy] = this.worldToScreen(cx * CHUNK, cy * CHUNK);
        ctx.drawImage(cv, sx, sy, cv.width * scale, cv.height * scale);
        // corruption haze
        const cor = game.corruption.get(cx + ',' + cy) || 0;
        if (cor > 0.5) {
          ctx.fillStyle = `rgba(160, 40, 120, ${Math.min(0.35, cor / 120)})`;
          ctx.fillRect(sx, sy, CHUNK * cam.zoom, CHUNK * cam.zoom);
        }
      }
    }

    const inView = (x, y, m = 2) => x > wx0 - m && x < wx1 + m && y > wy0 - m && y < wy1 + m;
    const z = cam.zoom;

    // nests
    for (const n of game.nests) {
      if (!inView(n.x, n.y)) continue;
      const [sx, sy] = this.worldToScreen(n.x, n.y);
      ctx.fillStyle = '#3a1030';
      ctx.beginPath();
      ctx.arc(sx + z / 2, sy + z / 2, z * 0.6, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#c040a0';
      this.glyph(ctx, '☠', sx + z / 2, sy + z / 2, z * 0.7);
    }

    // buildings
    for (const b of game.buildings.values()) {
      if (!inView(b.x, b.y)) continue;
      const [sx, sy] = this.worldToScreen(b.x, b.y);
      ctx.fillStyle = '#14141e';
      ctx.fillRect(sx + 1, sy + 1, z - 2, z - 2);
      ctx.strokeStyle = b.network >= 0 || b.def.coverage ? b.def.color : '#803030';
      ctx.lineWidth = Math.max(1, z / 16);
      ctx.strokeRect(sx + 1, sy + 1, z - 2, z - 2);
      ctx.fillStyle = b.def.color;
      this.glyph(ctx, b.def.glyph, sx + z / 2, sy + z / 2, z * 0.6);
      if (b.hp < b.def.hp) {
        ctx.fillStyle = '#f04040';
        ctx.fillRect(sx + 1, sy, (z - 2) * (b.hp / b.def.hp), Math.max(1, z / 12));
      }
      if (b.progress > 0 && z >= 12) {
        ctx.fillStyle = '#f0e060';
        ctx.fillRect(sx + 1, sy + z - 3, (z - 2) * Math.min(1, b.progress), 2);
      }
    }

    // portal links
    ctx.strokeStyle = 'rgba(96, 224, 192, 0.25)';
    ctx.lineWidth = 1.5;
    for (const b of game.buildings.values()) {
      if (b.type === 'portal' && b.linkId > b.id) {
        const t = game.buildings.get(b.linkId);
        if (!t) continue;
        const [ax, ay] = this.worldToScreen(b.x + 0.5, b.y + 0.5);
        const [bx, by] = this.worldToScreen(t.x + 0.5, t.y + 0.5);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }

    // the wizard
    {
      const p = game.player;
      const [sx, sy] = this.worldToScreen(p.x, p.y);
      const r = Math.max(4, z * 0.32);
      if (this.showReach) {
        ctx.strokeStyle = 'rgba(220, 220, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.arc(sx, sy, PLAYER_REACH * z, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.ellipse(sx, sy + r * 0.8, r * 0.9, r * 0.35, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#4868d0';                       // robe
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
      ctx.fillStyle = '#e8d8b0';                       // face
      ctx.beginPath(); ctx.arc(sx, sy - r * 0.35, r * 0.45, 0, 7); ctx.fill();
      ctx.fillStyle = '#283a90';                       // hat
      ctx.beginPath();
      ctx.moveTo(sx - r * 0.8, sy - r * 0.55);
      ctx.lineTo(sx + r * 0.8, sy - r * 0.55);
      ctx.lineTo(sx + r * 0.1, sy - r * 1.9);
      ctx.closePath(); ctx.fill();
    }

    // golems
    ctx.fillStyle = '#e0a060';
    for (const g of game.golems) {
      if (!inView(g.x, g.y)) continue;
      const [sx, sy] = this.worldToScreen(g.x, g.y);
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(2, z * 0.18), 0, 7); ctx.fill();
      if (g.carry && z >= 12) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(sx - 2, sy - z * 0.3, 4, 4);
        ctx.fillStyle = '#e0a060';
      }
    }

    // wraiths
    for (const w of game.wraiths) {
      if (!inView(w.x, w.y)) continue;
      const [sx, sy] = this.worldToScreen(w.x, w.y);
      const r = Math.max(3, z * 0.28);
      ctx.fillStyle = 'rgba(140, 230, 200, 0.7)';
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
      ctx.fillStyle = '#0a2a20';
      ctx.fillRect(sx - r * 0.4, sy - r * 0.2, 2, 2);
      ctx.fillRect(sx + r * 0.2, sy - r * 0.2, 2, 2);
    }

    // effects
    for (const e of game.effects) {
      const [sx, sy] = this.worldToScreen(e.x, e.y);
      if (e.type === 'beam') {
        const [tx, ty] = this.worldToScreen(e.x2, e.y2);
        ctx.strokeStyle = `rgba(240, 240, 255, ${e.ttl / 0.15})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
      } else if (e.type === 'pop' || e.type === 'banish' || e.type === 'warp') {
        const max = e.type === 'banish' ? 0.8 : e.type === 'pop' ? 0.4 : 0.3;
        const t = 1 - e.ttl / max;
        ctx.strokeStyle = e.type === 'banish' ? `rgba(240,80,80,${1 - t})`
          : e.type === 'warp' ? `rgba(96,224,192,${1 - t})` : `rgba(140,230,200,${1 - t})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, t * z * (e.type === 'banish' ? 4 : 1), 0, 7); ctx.stroke();
      }
    }

    // placement ghost + coverage preview
    if (this.placing && this.hover) {
      const { x, y } = this.hover;
      const [sx, sy] = this.worldToScreen(x, y);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx, sy, z, z);
      ctx.globalAlpha = 1;
      const def = this.placingDef;
      if (def && def.coverage) {
        const [cx2, cy2] = this.worldToScreen(x + 0.5, y + 0.5);
        ctx.strokeStyle = 'rgba(160, 120, 255, 0.6)';
        ctx.beginPath(); ctx.arc(cx2, cy2, def.coverage * z, 0, 7); ctx.stroke();
        ctx.strokeStyle = 'rgba(160, 120, 255, 0.2)';
        ctx.beginPath(); ctx.arc(cx2, cy2, LINK_RANGE * z, 0, 7); ctx.stroke();
      }
    }
  }

  glyph(ctx, ch, x, y, size) {
    ctx.font = `${size | 0}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y);
  }
}
