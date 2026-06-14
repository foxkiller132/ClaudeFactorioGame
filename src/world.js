// Chunked, lazily-generated world. Terrain and resource reserves live in typed
// arrays per chunk; chunks are created on first access so the map is unbounded.

import {
  CHUNK, T_GRASS, T_ROCK, T_ABYSS, T_CRYSTAL, T_STONE, T_LEYWELL,
  NEST_MIN_CHUNK_DIST, NEST_CHANCE,
  ROCK_THRESHOLD, ABYSS_THRESHOLD, DEPOSIT_THRESHOLD, DEPOSIT_BASE,
  DEPOSIT_RICHNESS, LEYWELL_CHANCE,
} from './config.js';

// --- deterministic hash noise -------------------------------------------------

function h2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442669)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, y, scale, seed) {
  const fx = x / scale, fy = y / scale;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = smooth(fx - x0), ty = smooth(fy - y0);
  const a = h2(x0, y0, seed), b = h2(x0 + 1, y0, seed);
  const c = h2(x0, y0 + 1, seed), d = h2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

// --- guaranteed starting area patches ------------------------------------------
// Centered near (0,0) so a new game is always playable.

const START_PATCHES = [
  { x: 4, y: 4, r: 3, t: T_GRASS, res: 0 },   // clear ground so the wizard always spawns walkable
  { x: 0, y: 0, r: 1, t: T_LEYWELL, res: 0 },
  { x: 7, y: -5, r: 3, t: T_CRYSTAL, res: 2500 },
  { x: -8, y: 6, r: 3, t: T_STONE, res: 2500 },
];

export class World {
  constructor(seed) {
    this.seed = seed | 0;
    this.chunks = new Map();      // "cx,cy" -> { tiles: Uint8Array, res: Uint32Array }
    this.dirty = new Set();       // chunk keys whose render cache must refresh
    this.modified = new Set();    // chunk keys diverged from generation (for saves)
    this.onChunkGen = null;       // (cx, cy) => void, set by the game for nest placement
  }

  key(cx, cy) { return cx + ',' + cy; }

  chunkAt(cx, cy) {
    const k = this.key(cx, cy);
    let c = this.chunks.get(k);
    if (!c) {
      c = this.generate(cx, cy);
      this.chunks.set(k, c);
      this.dirty.add(k);
      if (this.onChunkGen) this.onChunkGen(cx, cy);
    }
    return c;
  }

  generate(cx, cy) {
    const tiles = new Uint8Array(CHUNK * CHUNK);
    const res = new Uint32Array(CHUNK * CHUNK);
    const s = this.seed;
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = cx * CHUNK + lx, y = cy * CHUNK + ly;
        const i = ly * CHUNK + lx;
        const elev = valueNoise(x, y, 24, s);
        let t = T_GRASS;
        if (elev > ROCK_THRESHOLD) t = T_ROCK;
        else if (elev < ABYSS_THRESHOLD) t = T_ABYSS;
        else {
          const cN = valueNoise(x, y, 9, s + 7);
          const sN = valueNoise(x, y, 9, s + 13);
          const span = 1 - DEPOSIT_THRESHOLD;
          if (cN > DEPOSIT_THRESHOLD) {
            t = T_CRYSTAL;
            res[i] = DEPOSIT_BASE + ((cN - DEPOSIT_THRESHOLD) / span * DEPOSIT_RICHNESS | 0);
          } else if (sN > DEPOSIT_THRESHOLD) {
            t = T_STONE;
            res[i] = DEPOSIT_BASE + ((sN - DEPOSIT_THRESHOLD) / span * DEPOSIT_RICHNESS | 0);
          }
        }
        tiles[i] = t;
      }
    }
    // Rare ley wells: one deterministic 2x2 well in a fraction of chunks.
    if (h2(cx, cy, s + 31) < LEYWELL_CHANCE) {
      const ox = 4 + (h2(cx, cy, s + 37) * (CHUNK - 9) | 0);
      const oy = 4 + (h2(cx, cy, s + 41) * (CHUNK - 9) | 0);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        tiles[(oy + dy) * CHUNK + ox + dx] = T_LEYWELL;
      }
    }
    // Starter patch overrides near spawn.
    for (const p of START_PATCHES) {
      for (let dy = -p.r; dy <= p.r; dy++) for (let dx = -p.r; dx <= p.r; dx++) {
        if (dx * dx + dy * dy > p.r * p.r) continue;
        const x = p.x + dx, y = p.y + dy;
        if (Math.floor(x / CHUNK) !== cx || Math.floor(y / CHUNK) !== cy) continue;
        const i = (((y % CHUNK) + CHUNK) % CHUNK) * CHUNK + (((x % CHUNK) + CHUNK) % CHUNK);
        tiles[i] = p.t;
        res[i] = p.res;
      }
    }
    return { tiles, res };
  }

  getTile(x, y) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    const c = this.chunkAt(cx, cy);
    return c.tiles[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)];
  }

  getReserve(x, y) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    const c = this.chunkAt(cx, cy);
    return c.res[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)];
  }

  // Take up to n units from a deposit tile; converts to grass when exhausted.
  // Returns the amount actually taken.
  extract(x, y, n) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    const c = this.chunkAt(cx, cy);
    const i = (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK);
    const take = Math.min(n, c.res[i]);
    c.res[i] -= take;
    if (take > 0) this.modified.add(this.key(cx, cy));
    if (c.res[i] === 0 && (c.tiles[i] === T_CRYSTAL || c.tiles[i] === T_STONE)) {
      c.tiles[i] = T_GRASS;
      this.dirty.add(this.key(cx, cy));
    }
    return take;
  }

  // Overlay a saved chunk's tiles+res onto generation, marking it modified so a
  // re-save preserves it even if it is evicted from the live cache meanwhile.
  applyChunkDelta(cx, cy, tiles, res) {
    const k = this.key(cx, cy);
    const c = this.chunkAt(cx, cy);
    c.tiles.set(tiles);
    c.res.set(res);
    this.modified.add(k);
    this.dirty.add(k);
  }

  // Deterministic nest placement for a freshly generated chunk, or null.
  nestSpotFor(cx, cy) {
    const dist = Math.max(Math.abs(cx), Math.abs(cy));
    if (dist < NEST_MIN_CHUNK_DIST) return null;
    if (h2(cx, cy, this.seed + 53) >= NEST_CHANCE) return null;
    const lx = 3 + (h2(cx, cy, this.seed + 59) * (CHUNK - 6) | 0);
    const ly = 3 + (h2(cx, cy, this.seed + 61) * (CHUNK - 6) | 0);
    const c = this.chunkAt(cx, cy);
    if (c.tiles[ly * CHUNK + lx] !== T_GRASS) return null;
    return { x: cx * CHUNK + lx, y: cy * CHUNK + ly };
  }
}

export { h2 };
