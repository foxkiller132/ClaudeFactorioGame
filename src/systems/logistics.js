// Golem hauling. Every JOB_SCAN_TICKS we match requesting buildings with
// providers (with reservation bookkeeping so two golems never chase the same
// items), then idle golems claim jobs whose endpoints lie within their den's
// range. Golems fly straight lines — they are magic constructs.

import { DT, JOB_SCAN_TICKS, GOLEM_SPEED, GOLEM_CAPACITY } from '../config.js';
import { RECIPES } from '../defs.js';
import {
  invAdd, invGet, invTake, providableItems, wantedAmount,
} from '../state.js';

// Items a building requests deliveries of.
function requestedItems(b) {
  switch (b.type) {
    case 'infuser': return ['crystal'];
    case 'runeforge': {
      const r = RECIPES[b.recipeId];
      return r ? Object.keys(r.in) : null;
    }
    case 'athenaeum': return ['scroll'];
    default: return null;
  }
}

function available(b, item) {
  return invGet(b.inv, item) - (b.reserved.get(item) || 0);
}

function reserve(map, item, n) { map.set(item, (map.get(item) || 0) + n); }

function unreserve(map, item, n) {
  const cur = (map.get(item) || 0) - n;
  if (cur <= 0) map.delete(item); else map.set(item, cur);
}

export function scanJobs(game) {
  if (game.tick % JOB_SCAN_TICKS !== 0) return;
  // No golems means no hauling: don't create jobs whose reservations would
  // lock items away from the wizard's manual Take/Feed.
  if (game.golems.length === 0) return;

  // Index providers by item.
  const providers = new Map(); // item -> [building]
  const surplus = [];          // producers with big buffers, candidates for storage runs
  for (const b of game.buildings.values()) {
    const items = providableItems(b);
    for (const item of items) {
      if (available(b, item) <= 0) continue;
      let list = providers.get(item);
      if (!list) providers.set(item, list = []);
      list.push(b);
    }
    if (b.type !== 'reliquary' && items.some(i => available(b, i) >= 10)) surplus.push(b);
  }

  const demanded = new Set();

  // Demand-driven jobs: requesters pull from the nearest provider.
  for (const b of game.buildings.values()) {
    const wantsItems = requestedItems(b);
    if (!wantsItems) continue;
    for (const item of wantsItems) {
      demanded.add(item);
      const want = wantedAmount(game, b, item);
      if (want <= 0) continue;
      const from = nearestProvider(providers.get(item), b, item);
      if (!from) continue;
      const n = Math.min(want, available(from, item), GOLEM_CAPACITY);
      if (n <= 0) continue;
      pushJob(game, from, b, item, n);
    }
  }

  // Storage runs: stash surplus that nothing is requesting into reliquaries.
  const reliquaries = [...game.buildings.values()].filter(b => b.type === 'reliquary');
  if (reliquaries.length) {
    for (const from of surplus) {
      for (const item of providableItems(from)) {
        if (demanded.has(item) || available(from, item) < 10) continue;
        const to = nearestProvider(reliquaries, from, null, true);
        if (!to || wantedAmount(game, to, item) <= 0) continue;
        pushJob(game, from, to, item, Math.min(available(from, item), GOLEM_CAPACITY));
      }
    }
  }
}

function nearestProvider(list, b, item, any) {
  if (!list) return null;
  let best = null, bestD = Infinity;
  for (const p of list) {
    if (p === b) continue;
    if (!any && available(p, item) <= 0) continue;
    const d = (p.x - b.x) ** 2 + (p.y - b.y) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function pushJob(game, from, to, item, n) {
  reserve(from.reserved, item, n);
  reserve(to.incoming, item, n);
  game.jobs.push({ fromId: from.id, toId: to.id, item, n });
}

function cancelJob(game, job) {
  const from = game.buildings.get(job.fromId);
  const to = game.buildings.get(job.toId);
  if (from) unreserve(from.reserved, job.item, job.n);
  if (to) unreserve(to.incoming, job.item, job.n);
}

function moveToward(g, tx, ty) {
  const dx = tx - g.x, dy = ty - g.y;
  const d = Math.hypot(dx, dy);
  const step = GOLEM_SPEED * DT;
  if (d <= step) { g.x = tx; g.y = ty; return true; }
  g.x += dx / d * step;
  g.y += dy / d * step;
  return false;
}

export function golemTick(game) {
  scanJobs(game);
  for (const g of game.golems) {
    const den = game.buildings.get(g.denId);
    if (!den) continue; // den destroyed; golem list is pruned in removeBuilding
    switch (g.state) {
      case 'idle': {
        if (den.ratio <= 0 && den.wants) break; // brownout: golems stall
        const range2 = den.def.range ** 2;
        let pick = -1, pickD = Infinity;
        for (let i = 0; i < game.jobs.length; i++) {
          const job = game.jobs[i];
          const from = game.buildings.get(job.fromId);
          const to = game.buildings.get(job.toId);
          if (!from || !to) { cancelJob(game, job); game.jobs.splice(i--, 1); continue; }
          const dF = (from.x - den.x) ** 2 + (from.y - den.y) ** 2;
          const dT = (to.x - den.x) ** 2 + (to.y - den.y) ** 2;
          if (dF > range2 || dT > range2) continue;
          const d = (from.x + 0.5 - g.x) ** 2 + (from.y + 0.5 - g.y) ** 2;
          if (d < pickD) { pickD = d; pick = i; }
        }
        if (pick >= 0) {
          g.job = game.jobs.splice(pick, 1)[0];
          g.state = 'pickup';
        } else {
          moveToward(g, den.x + 0.5, den.y + 0.5);
        }
        break;
      }
      case 'pickup': {
        const from = game.buildings.get(g.job.fromId);
        if (!from) { cancelJob(game, g.job); g.job = null; g.state = 'idle'; break; }
        if (moveToward(g, from.x + 0.5, from.y + 0.5)) {
          unreserve(from.reserved, g.job.item, g.job.n);
          const got = invTake(from.inv, g.job.item, g.job.n);
          if (got > 0) {
            const to = game.buildings.get(g.job.toId);
            if (to && got < g.job.n) unreserve(to.incoming, g.job.item, g.job.n - got);
            g.job.n = got;
            g.carry = { item: g.job.item, n: got };
            g.state = 'deliver';
          } else {
            const to = game.buildings.get(g.job.toId);
            if (to) unreserve(to.incoming, g.job.item, g.job.n);
            g.job = null; g.state = 'idle';
          }
        }
        break;
      }
      case 'deliver': {
        const to = game.buildings.get(g.job.toId);
        if (!to) {
          // destination gone: dump into player inventory (magical recall)
          invAdd(game.player.inv, g.carry.item, g.carry.n);
          g.carry = null; g.job = null; g.state = 'idle';
          break;
        }
        if (moveToward(g, to.x + 0.5, to.y + 0.5)) {
          unreserve(to.incoming, g.job.item, g.job.n);
          invAdd(to.inv, g.carry.item, g.carry.n);
          g.carry = null; g.job = null; g.state = 'idle';
        }
        break;
      }
    }
  }
}
