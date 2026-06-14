// Game state container and building lifecycle. No DOM or rendering here:
// the whole simulation can run headless (see test/smoke.mjs).

import {
  CHUNK, T_CRYSTAL, T_STONE, T_LEYWELL, T_ROCK, T_ABYSS, BUILDABLE,
  PLAYER_REACH,
} from './config.js';
import { BUILDINGS, RECIPES, START_INVENTORY, ITEMS } from './defs.js';
import { World } from './world.js';

// --- inventory helpers (plain Maps of item -> count) ---------------------------

export function invGet(inv, item) { return inv.get(item) || 0; }

export function invAdd(inv, item, n) {
  if (n <= 0) return;
  inv.set(item, (inv.get(item) || 0) + n);
}

export function invTake(inv, item, n) {
  const have = inv.get(item) || 0;
  const take = Math.min(have, n);
  if (take > 0) {
    if (have === take) inv.delete(item); else inv.set(item, have - take);
  }
  return take;
}

export function invTotal(inv) {
  let t = 0;
  for (const n of inv.values()) t += n;
  return t;
}

export function invHasAll(inv, req) {
  for (const item in req) if (invGet(inv, item) < req[item]) return false;
  return true;
}

// --- game ----------------------------------------------------------------------

export function createGame(seed = 1337) {
  const game = {
    seed, tick: 0,
    world: new World(seed),
    buildings: new Map(),     // id -> building
    byTile: new Map(),        // "x,y" -> id
    byChunk: new Map(),       // "cx,cy" -> Set(id), locality index for combat/AI
    nextId: 1,
    networksDirty: true,
    networks: [],             // [{ sources: [b], supply, demand, ratio }]
    golems: [],
    conduits: [],             // flat list of conduit buildings for the belt system
    wraiths: [],
    nests: [],
    jobs: [],
    corruption: new Map(),    // "cx,cy" -> float
    effects: [],              // transient render effects { type, x, y, x2, y2, ttl }
    player: { x: 4.5, y: 4.5, inv: new Map() },
    research: { current: null, progress: 0, unlocked: new Set() },
    mods: { speed: 1, manaOut: 1, wardDmg: 1, wardRange: 0 },
    stats: { supply: 0, demand: 0, satisfaction: 1, wraithKills: 0 },
    log: [],
  };
  for (const item in START_INVENTORY) invAdd(game.player.inv, item, START_INVENTORY[item]);
  game.world.onChunkGen = (cx, cy) => {
    const spot = game.world.nestSpotFor(cx, cy);
    if (spot) game.nests.push({ x: spot.x, y: spot.y, hp: 400, charge: 0, threshold: 8 });
  };
  return game;
}

// Short-lived floating prompt in the world (e.g. "Too far away").
export function toastMsg(game, x, y, text) {
  game.effects.push({ type: 'toast', x, y, text, ttl: 1.4 });
}

export function logMsg(game, text) {
  game.log.push({ tick: game.tick, text });
  if (game.log.length > 50) game.log.shift();
}

export function chunkKeyOf(x, y) {
  return Math.floor(x / CHUNK) + ',' + Math.floor(y / CHUNK);
}

// --- player character ------------------------------------------------------------

function walkable(game, x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  const t = game.world.getTile(tx, ty);
  if (t === T_ROCK || t === T_ABYSS) return false;
  const b = buildingAt(game, tx, ty);
  return !b || b.def.walkable; // the wizard steps over conduits
}

// Move the wizard by (dx, dy), sliding along blocked axes.
export function movePlayer(game, dx, dy) {
  const p = game.player;
  if (dx && walkable(game, p.x + dx, p.y)) p.x += dx;
  if (dy && walkable(game, p.x, p.y + dy)) p.y += dy;
}

// Whether tile (x, y) is within the wizard's interaction reach.
export function inReach(game, x, y) {
  const d2 = (x + 0.5 - game.player.x) ** 2 + (y + 0.5 - game.player.y) ** 2;
  return d2 <= PLAYER_REACH * PLAYER_REACH;
}

// --- building lifecycle ---------------------------------------------------------

export function buildingAt(game, x, y) {
  const id = game.byTile.get(x + ',' + y);
  return id ? game.buildings.get(id) : null;
}

export function canPlace(game, type, x, y) {
  const def = BUILDINGS[type];
  if (!def) return 'unknown building';
  if (def.tech && !game.research.unlocked.has(def.tech)) return 'requires research';
  if (game.byTile.has(x + ',' + y)) return 'tile occupied';
  const t = game.world.getTile(x, y);
  if (!BUILDABLE.has(t)) return 'cannot build here';
  if (def.on === 'leywell' && t !== T_LEYWELL) return 'must be placed on a ley well';
  if (def.on === 'deposit' && t !== T_CRYSTAL && t !== T_STONE) return 'must be placed on a deposit';
  if (!invHasAll(game.player.inv, def.cost)) return 'missing materials';
  return null;
}

export function placeBuilding(game, type, x, y, dir = 0) {
  const err = canPlace(game, type, x, y);
  if (err) return err;
  const def = BUILDINGS[type];
  for (const item in def.cost) invTake(game.player.inv, item, def.cost[item]);
  const b = {
    id: game.nextId++, type, def, x, y,
    hp: def.hp, inv: new Map(),
    recipeId: type === 'runeforge' ? 'runestone' : null,
    progress: 0, network: -1, ratio: 0, wants: false,
    dir: def.rotatable ? (dir & 3) : 0,   // 0=E 1=S 2=W 3=N
    incoming: new Map(),   // item -> count reserved by inbound golems
    reserved: new Map(),   // item -> count reserved by outbound golems
    linkId: 0, cool: 0,
  };
  game.buildings.set(b.id, b);
  game.byTile.set(x + ',' + y, b.id);
  const ck = chunkKeyOf(x, y);
  let set = game.byChunk.get(ck);
  if (!set) game.byChunk.set(ck, set = new Set());
  set.add(b.id);
  game.networksDirty = true;
  if (type === 'golem_den') {
    for (let i = 0; i < def.golems; i++) {
      game.golems.push({ x: x + 0.5, y: y + 0.5, denId: b.id, state: 'idle', job: null, carry: null });
    }
  }
  if (def.conduit) game.conduits.push(b);
  return b;
}

export function removeBuilding(game, b, refund = true) {
  if (!game.buildings.has(b.id)) return;
  game.buildings.delete(b.id);
  game.byTile.delete(b.x + ',' + b.y);
  const set = game.byChunk.get(chunkKeyOf(b.x, b.y));
  if (set) set.delete(b.id);
  game.networksDirty = true;
  if (refund) {
    for (const item in b.def.cost) {
      invAdd(game.player.inv, item, Math.floor(b.def.cost[item] / 2));
    }
    for (const [item, n] of b.inv) invAdd(game.player.inv, item, n);
  }
  if (b.type === 'golem_den') {
    game.golems = game.golems.filter(g => g.denId !== b.id);
  }
  if (b.def.conduit) {
    const i = game.conduits.indexOf(b);
    if (i >= 0) game.conduits.splice(i, 1);
  }
  if (b.type === 'portal' && b.linkId) {
    const twin = game.buildings.get(b.linkId);
    if (twin) twin.linkId = 0;
  }
}

export function damageBuilding(game, b, dmg) {
  b.hp -= dmg;
  if (b.hp <= 0) {
    removeBuilding(game, b, false);
    game.effects.push({ type: 'banish', x: b.x + 0.5, y: b.y + 0.5, ttl: 0.8 });
    logMsg(game, `${b.def.name} destroyed by wraiths!`);
  }
}

// Nearest building to (x,y) within maxR tiles, searched via the chunk index.
export function findNearestBuilding(game, x, y, maxR) {
  const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
  const cr = Math.ceil(maxR / CHUNK) + 1;
  let best = null, bestD = maxR * maxR;
  for (let dy = -cr; dy <= cr; dy++) {
    for (let dx = -cr; dx <= cr; dx++) {
      const set = game.byChunk.get((cx + dx) + ',' + (cy + dy));
      if (!set) continue;
      for (const id of set) {
        const b = game.buildings.get(id);
        const d = (b.x + 0.5 - x) ** 2 + (b.y + 0.5 - y) ** 2;
        if (d < bestD) { bestD = d; best = b; }
      }
    }
  }
  return best;
}

// --- logistics roles -------------------------------------------------------------

// Items a building offers for pickup (its products / stored goods).
export function providableItems(b) {
  switch (b.type) {
    case 'reliquary': return [...b.inv.keys()];
    case 'siphon': return [...b.inv.keys()];
    case 'infuser': return b.inv.has('shard') ? ['shard'] : [];
    case 'runeforge': {
      const r = RECIPES[b.recipeId];
      return r ? Object.keys(r.out).filter(i => b.inv.has(i)) : [];
    }
    case 'portal': return [...b.inv.keys()];
    default: return [];
  }
}

// How many more of `item` the building wants delivered (0 if none).
export function wantedAmount(game, b, item) {
  const have = invGet(b.inv, item) + (b.incoming.get(item) || 0);
  switch (b.type) {
    case 'infuser': {
      const need = { crystal: 10 };
      return Math.max(0, (need[item] || 0) - have);
    }
    case 'runeforge': {
      const r = RECIPES[b.recipeId];
      if (!r || !(item in r.in)) return 0;
      return Math.max(0, r.in[item] * 4 - have);
    }
    case 'athenaeum':
      return item === 'scroll' ? Math.max(0, 10 - have) : 0;
    case 'reliquary': {
      const cap = b.def.capacity;
      return Math.max(0, cap - invTotal(b.inv) - totalIncoming(b));
    }
    default: return 0;
  }
}

function totalIncoming(b) {
  let t = 0;
  for (const n of b.incoming.values()) t += n;
  return t;
}

// --- manual transfer (the wizard's hands) -----------------------------------------
// The pre-golem way to move items: empty a building into the satchel, or feed a
// building the inputs it wants. Reach checks live in the UI layer.

export function takeAllFromBuilding(game, b) {
  let moved = 0;
  for (const [item, n] of [...b.inv]) {
    const free = n - (b.reserved.get(item) || 0); // leave goods promised to golems
    if (free <= 0) continue;
    invTake(b.inv, item, free);
    invAdd(game.player.inv, item, free);
    moved += free;
  }
  return moved;
}

export function feedBuilding(game, b) {
  let moved = 0;
  for (const item in ITEMS) {
    const want = wantedAmount(game, b, item);
    if (want <= 0) continue;
    const given = invTake(game.player.inv, item, want);
    invAdd(b.inv, item, given);
    moved += given;
  }
  return moved;
}
