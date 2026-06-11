// Mana network system. Sources (ley taps, obelisks) form networks via
// union-find when within LINK_RANGE of each other; a building is powered if any
// source's coverage aura reaches it. Networks are only rebuilt when the set of
// buildings changes (game.networksDirty), so steady-state cost per tick is just
// the supply/demand accounting.

import { LINK_RANGE } from '../config.js';

export function rebuildNetworks(game) {
  const sources = [];
  for (const b of game.buildings.values()) {
    if (b.def.coverage) sources.push(b);
  }
  // union-find over sources
  const parent = sources.map((_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const a = sources[i], c = sources[j];
      const d2 = (a.x - c.x) ** 2 + (a.y - c.y) ** 2;
      if (d2 <= LINK_RANGE * LINK_RANGE) {
        const ra = find(i), rc = find(j);
        if (ra !== rc) parent[ra] = rc;
      }
    }
  }
  const netIndex = new Map(); // root -> network array index
  game.networks = [];
  for (let i = 0; i < sources.length; i++) {
    const r = find(i);
    let n = netIndex.get(r);
    if (n === undefined) {
      n = game.networks.length;
      netIndex.set(r, n);
      game.networks.push({ sources: [], supply: 0, demand: 0, ratio: 1 });
    }
    sources[i].network = n;
    game.networks[n].sources.push(sources[i]);
  }
  // assign consumers to the network of any covering source
  for (const b of game.buildings.values()) {
    if (b.def.coverage) continue;
    b.network = -1;
    for (const s of sources) {
      const cov = s.def.coverage;
      const d2 = (s.x - b.x) ** 2 + (s.y - b.y) ** 2;
      if (d2 <= cov * cov) { b.network = s.network; break; }
    }
  }
  game.networksDirty = false;
}

// Per-tick accounting. Each consumer set b.wants (true if it has work to do)
// before this runs; we compute per-network satisfaction ratios that production
// systems then scale by.
export function powerTick(game) {
  if (game.networksDirty) rebuildNetworks(game);
  let totalSupply = 0, totalDemand = 0;
  for (const net of game.networks) { net.supply = 0; net.demand = 0; }
  for (const b of game.buildings.values()) {
    if (b.type === 'ley_tap') {
      const out = b.def.manaOut * game.mods.manaOut;
      game.networks[b.network].supply += out;
      totalSupply += out;
    } else if (b.def.manaUse && b.wants && b.network >= 0) {
      game.networks[b.network].demand += b.def.manaUse;
      totalDemand += b.def.manaUse;
    }
  }
  for (const net of game.networks) {
    net.ratio = net.demand > 0 ? Math.min(1, net.supply / net.demand) : 1;
  }
  for (const b of game.buildings.values()) {
    b.ratio = (b.network >= 0 && b.wants) ? game.networks[b.network].ratio : 0;
  }
  game.stats.supply = totalSupply;
  game.stats.demand = totalDemand;
  game.stats.satisfaction = totalDemand > 0 ? Math.min(1, totalSupply / totalDemand) : 1;
}
