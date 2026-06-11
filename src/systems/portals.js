// Portal item teleportation: long-range logistics, the magical answer to
// trains. A linked source portal pulls items from the output inventories of
// adjacent buildings into the aether; its twin pushes them into adjacent
// buildings that want them. Throughput is def.rate items/second per direction,
// scaled by mana satisfaction.

import { DT } from '../config.js';
import {
  buildingAt, invAdd, invTake, providableItems, wantedAmount, invTotal,
} from '../state.js';

const BUFFER_CAP = 10;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function neighbours(game, b) {
  const out = [];
  for (const [dx, dy] of DIRS) {
    const n = buildingAt(game, b.x + dx, b.y + dy);
    if (n && n !== b) out.push(n);
  }
  return out;
}

export function portalTick(game) {
  for (const b of game.buildings.values()) {
    if (b.type !== 'portal' || !b.linkId) continue;
    const twin = game.buildings.get(b.linkId);
    if (!twin) { b.linkId = 0; continue; }
    if (b.ratio <= 0) continue;

    b.progress += DT * b.def.rate * b.ratio;
    while (b.progress >= 1) {
      b.progress -= 1;

      // 1. pull one item from an adjacent provider into the twin's buffer
      if (invTotal(twin.inv) < BUFFER_CAP) {
        outer:
        for (const n of neighbours(game, b)) {
          for (const item of providableItems(n)) {
            if (n.type === 'portal') continue;
            if (invTake(n.inv, item, 1) > 0) {
              invAdd(twin.inv, item, 1);
              game.effects.push({ type: 'warp', x: b.x + 0.5, y: b.y + 0.5, ttl: 0.3 });
              break outer;
            }
          }
        }
      }

      // 2. push one buffered item into an adjacent building that wants it
      outer2:
      for (const [item] of b.inv) {
        for (const n of neighbours(game, b)) {
          if (n.type === 'portal') continue;
          if (wantedAmount(game, n, item) > 0) {
            invTake(b.inv, item, 1);
            invAdd(n.inv, item, 1);
            break outer2;
          }
        }
      }
    }
  }
}

export function linkPortals(game, a, b) {
  if (a.type !== 'portal' || b.type !== 'portal' || a === b) return 'select two portals';
  for (const p of [a, b]) {
    if (p.linkId) {
      const old = game.buildings.get(p.linkId);
      if (old) old.linkId = 0;
    }
  }
  a.linkId = b.id;
  b.linkId = a.id;
  return null;
}
