// Thaumic corruption and wraiths.
//
// Corruption is the magical analogue of Factorio's pollution: working buildings
// emit it into their chunk, it diffuses to neighbouring (already generated)
// chunks and slowly decays. Dark shrines absorb corruption from their chunk and
// convert it into wraith spawns — so a bigger, hungrier base attracts a bigger
// haunting. It is simulated at chunk granularity, so cost scales with explored
// area, not tile count.

import {
  DT, CHUNK, CORRUPTION_TICKS, CORRUPTION_SPREAD, CORRUPTION_DECAY,
  WRAITH_SPEED, WRAITH_RETARGET_TICKS,
} from '../config.js';
import {
  chunkKeyOf, damageBuilding, findNearestBuilding, invAdd, logMsg,
} from '../state.js';

export function corruptionTick(game) {
  // emission every tick (cheap: one map update per active building)
  for (const b of game.buildings.values()) {
    const e = b.def.corruption;
    if (e && b.ratio > 0) {
      const k = chunkKeyOf(b.x, b.y);
      game.corruption.set(k, (game.corruption.get(k) || 0) + e * b.ratio * DT);
    }
  }
  if (game.tick % CORRUPTION_TICKS !== 0) return;

  // diffusion + decay on the chunk grid
  const next = new Map();
  for (const [k, v] of game.corruption) {
    if (v < 0.01) continue;
    const [cx, cy] = k.split(',').map(Number);
    const spread = v * CORRUPTION_SPREAD;
    let kept = v - spread * 4;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nk = (cx + dx) + ',' + (cy + dy);
      if (game.world.chunks.has(nk)) {
        next.set(nk, (next.get(nk) || 0) + spread);
      } else {
        kept += spread; // don't force-generate chunks just to pollute them
      }
    }
    next.set(k, (next.get(k) || 0) + kept * (1 - CORRUPTION_DECAY));
  }
  game.corruption = next;

  // shrines drink corruption and birth wraiths
  for (const nest of game.nests) {
    const k = chunkKeyOf(nest.x, nest.y);
    const c = game.corruption.get(k) || 0;
    const drink = Math.min(c, 2);
    if (drink > 0) game.corruption.set(k, c - drink);
    nest.charge += drink + 0.05; // slow trickle even when clean
    if (nest.charge >= nest.threshold && game.wraiths.length < 200) {
      nest.charge -= nest.threshold;
      nest.threshold = Math.min(40, nest.threshold * 1.05); // ramping difficulty
      game.wraiths.push({
        x: nest.x + 0.5, y: nest.y + 0.5,
        hp: 60, maxHp: 60, target: 0, retarget: 0,
      });
    }
  }
}

export function wraithTick(game) {
  for (let i = 0; i < game.wraiths.length; i++) {
    const w = game.wraiths[i];
    if (w.hp <= 0) {
      game.stats.wraithKills++;
      if ((game.stats.wraithKills * 2654435761 >>> 16) % 10 < 4) {
        invAdd(game.player.inv, 'essence', 1); // essence dissipates into your grimoire
      }
      game.effects.push({ type: 'pop', x: w.x, y: w.y, ttl: 0.4 });
      game.wraiths[i] = game.wraiths[game.wraiths.length - 1];
      game.wraiths.pop();
      i--;
      continue;
    }
    if (--w.retarget <= 0) {
      w.retarget = WRAITH_RETARGET_TICKS;
      const b = findNearestBuilding(game, w.x, w.y, 64);
      w.target = b ? b.id : 0;
    }
    const target = game.buildings.get(w.target);
    let tx, ty;
    if (target) { tx = target.x + 0.5; ty = target.y + 0.5; }
    else { tx = 0.5; ty = 0.5; } // drift toward the heart of the base
    const dx = tx - w.x, dy = ty - w.y;
    const d = Math.hypot(dx, dy);
    if (target && d < 1.2) {
      damageBuilding(game, target, 10 * DT);
    } else if (d > 0.01) {
      const step = WRAITH_SPEED * DT;
      w.x += dx / d * Math.min(step, d);
      w.y += dy / d * Math.min(step, d);
    }
  }
}

export function wardTick(game) {
  for (const b of game.buildings.values()) {
    if (b.type !== 'ward') continue;
    b.cool -= DT;
    if (b.cool > 0 || b.ratio <= 0) continue;
    const range = b.def.range + game.mods.wardRange;
    const r2 = range * range;
    let best = null, bestD = r2;
    for (const w of game.wraiths) {
      if (w.hp <= 0) continue;
      const d = (w.x - b.x - 0.5) ** 2 + (w.y - b.y - 0.5) ** 2;
      if (d < bestD) { bestD = d; best = w; }
    }
    if (best) {
      best.hp -= b.def.damage * game.mods.wardDmg * b.ratio;
      b.cool = b.def.cooldown;
      game.effects.push({
        type: 'beam', x: b.x + 0.5, y: b.y + 0.5, x2: best.x, y2: best.y, ttl: 0.15,
      });
    }
  }
}

// Player-cast banishment: consumes a sigil, destroys the nest, slays nearby
// wraiths, refunds essence. Returns an error string or null.
export function banishAt(game, x, y) {
  const idx = game.nests.findIndex(n => Math.abs(n.x + 0.5 - x) < 2 && Math.abs(n.y + 0.5 - y) < 2);
  if (idx < 0) return 'no shrine there';
  if (!game.player.inv.has('banish_sigil')) return 'requires a Banish Sigil';
  game.player.inv.set('banish_sigil', game.player.inv.get('banish_sigil') - 1);
  if (game.player.inv.get('banish_sigil') <= 0) game.player.inv.delete('banish_sigil');
  const nest = game.nests[idx];
  game.nests.splice(idx, 1);
  for (const w of game.wraiths) {
    if ((w.x - nest.x) ** 2 + (w.y - nest.y) ** 2 < 64) w.hp = 0;
  }
  invAdd(game.player.inv, 'essence', 5);
  game.effects.push({ type: 'banish', x: nest.x + 0.5, y: nest.y + 0.5, ttl: 0.8 });
  logMsg(game, 'A dark shrine has been banished.');
  return null;
}
