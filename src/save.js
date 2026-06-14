// Save / load. The world is deterministic from its seed, so a save only needs
// the seed plus the chunks the player actually changed (mined deposits) — it
// scales with what you've altered, not what you've explored. Everything else is
// entity and progression state. Derived indices (byTile, byChunk, networks) are
// rebuilt on load rather than stored.

import { createGame, chunkKeyOf } from './state.js';
import { BUILDINGS } from './defs.js';

export const SAVE_VERSION = 1;
const SLOT_KEY = 'arcanum.save';

const mapToObj = m => { const o = {}; for (const [k, v] of m) o[k] = v; return o; };
const objToMap = o => { const m = new Map(); for (const k in o) m.set(k, o[k]); return m; };

function serializeBuilding(b) {
  return {
    id: b.id, type: b.type, x: b.x, y: b.y, hp: b.hp,
    recipeId: b.recipeId, progress: b.progress, cool: b.cool, linkId: b.linkId,
    inv: mapToObj(b.inv),
  };
  // incoming/reserved are golem-haul reservations; jobs are dropped on load so
  // we intentionally omit them — they get rebuilt by the next job scan.
}

export function serialize(game) {
  const chunks = [];
  for (const key of game.world.modified) {
    const c = game.world.chunks.get(key);
    if (!c) continue;
    chunks.push({ key, tiles: Array.from(c.tiles), res: Array.from(c.res) });
  }
  return {
    v: SAVE_VERSION,
    seed: game.seed,
    tick: game.tick,
    nextId: game.nextId,
    chunks,
    buildings: [...game.buildings.values()].map(serializeBuilding),
    golems: game.golems.map(g => ({
      x: g.x, y: g.y, denId: g.denId, state: 'idle', carry: g.carry,
    })),
    wraiths: game.wraiths.map(w => ({ x: w.x, y: w.y, hp: w.hp, maxHp: w.maxHp })),
    nests: game.nests.map(n => ({ x: n.x, y: n.y, hp: n.hp, charge: n.charge, threshold: n.threshold })),
    corruption: mapToObj(game.corruption),
    player: { x: game.player.x, y: game.player.y, inv: mapToObj(game.player.inv) },
    research: {
      current: game.research.current,
      progress: game.research.progress,
      unlocked: [...game.research.unlocked],
    },
    mods: { ...game.mods },
    stats: { ...game.stats },
  };
}

// Build a fresh game from a serialized snapshot. Reuses placeBuilding-free
// reconstruction so it works headless and never depends on the DOM.
export function deserialize(data) {
  if (!data || data.v !== SAVE_VERSION) {
    throw new Error(`unsupported save version ${data && data.v}`);
  }
  const game = createGame(data.seed);
  // wipe the starter-inventory and any spawn nests createGame seeded
  game.player.inv.clear();
  game.nests = [];
  game.tick = data.tick;
  game.nextId = data.nextId;

  for (const ch of data.chunks) {
    const [cx, cy] = ch.key.split(',').map(Number);
    game.world.applyChunkDelta(cx, cy, ch.tiles, ch.res);
  }

  for (const bd of data.buildings) {
    const b = reviveBuilding(game, bd);
    game.buildings.set(b.id, b);
    game.byTile.set(b.x + ',' + b.y, b.id);
    const ck = chunkKeyOf(b.x, b.y);
    let set = game.byChunk.get(ck);
    if (!set) game.byChunk.set(ck, set = new Set());
    set.add(b.id);
  }

  game.golems = data.golems.map(g => ({
    x: g.x, y: g.y, denId: g.denId, state: 'idle', job: null, carry: g.carry || null,
  }));
  game.wraiths = data.wraiths.map(w => ({
    x: w.x, y: w.y, hp: w.hp, maxHp: w.maxHp, target: 0, retarget: 0,
  }));
  game.nests = data.nests.map(n => ({ ...n }));
  game.corruption = objToMap(data.corruption);
  game.player.x = data.player.x;
  game.player.y = data.player.y;
  game.player.inv = objToMap(data.player.inv);
  game.research.current = data.research.current;
  game.research.progress = data.research.progress;
  game.research.unlocked = new Set(data.research.unlocked);
  game.mods = { ...game.mods, ...data.mods };
  game.stats = { ...game.stats, ...data.stats };
  game.networksDirty = true;
  return game;
}

function reviveBuilding(game, bd) {
  // Pull the live def so future content/balance changes apply to old saves.
  const def = BUILDINGS[bd.type];
  return {
    id: bd.id, type: bd.type, def, x: bd.x, y: bd.y,
    hp: bd.hp, inv: objToMap(bd.inv),
    recipeId: bd.recipeId,
    progress: bd.progress, network: -1, ratio: 0, wants: false,
    incoming: new Map(), reserved: new Map(),
    linkId: bd.linkId || 0, cool: bd.cool || 0,
  };
}

// --- localStorage slot ----------------------------------------------------------

export function saveToStorage(game) {
  const json = JSON.stringify(serialize(game));
  localStorage.setItem(SLOT_KEY, json);
  return json.length;
}

export function loadFromStorage() {
  const json = localStorage.getItem(SLOT_KEY);
  if (!json) return null;
  return deserialize(JSON.parse(json));
}

// Copy a freshly deserialized game's state into an existing game object so that
// live references held by the renderer and UI stay valid across a load.
export function copyStateInto(dst, src) {
  for (const k of [
    'seed', 'tick', 'nextId', 'world', 'buildings', 'byTile', 'byChunk',
    'networks', 'networksDirty', 'golems', 'wraiths', 'nests', 'jobs',
    'corruption', 'player', 'research', 'mods', 'stats',
  ]) {
    dst[k] = src[k];
  }
  dst.effects.length = 0;
}

export function hasSave() {
  return typeof localStorage !== 'undefined' && localStorage.getItem(SLOT_KEY) != null;
}

export function clearSave() {
  localStorage.removeItem(SLOT_KEY);
}
