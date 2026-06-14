// Conduit runes: the belt analogue. Each conduit tile holds up to CONDUIT_CAP
// items and moves them one tile per tick toward the tile it faces. Items enter
// the network from the building immediately behind a conduit (its input side)
// and leave into a building ahead that wants them.
//
// Movement uses a start-of-tick load snapshot so each item advances at most one
// tile per tick: a freshly arrived item isn't in the snapshot, so it waits a
// tick before moving on. A whole straight line therefore steps forward in
// lock-step, exactly like a belt. Cost is O(active conduits) — empty conduits
// do almost nothing — so long belt runs stay cheap on large bases.

import { DIRS, CONDUIT_CAP, DT } from '../config.js';
import {
  buildingAt, invAdd, invGet, invTake, invTotal, providableItems, wantedAmount,
} from '../state.js';

const FLOW_SPEED = 1.5; // cosmetic flow-dash phase per second

export function conduitTick(game) {
  const conduits = game.conduits;
  if (conduits.length === 0) return;

  // advance the cosmetic flow phase
  for (const c of conduits) c.progress = (c.progress + FLOW_SPEED * DT) % 1;

  // --- pass 1: push each conduit's leading item one tile ---------------------
  const load = new Map();        // id -> item count at tick start
  const pendingIn = new Map();   // id -> space already claimed by inbound items
  for (const c of conduits) load.set(c.id, invTotal(c.inv));

  for (const c of conduits) {
    if (load.get(c.id) <= 0) continue;            // nothing here at tick start
    const [dx, dy] = DIRS[c.dir];
    const target = buildingAt(game, c.x + dx, c.y + dy);
    if (!target) continue;                        // dead end: items pile up
    const item = c.inv.keys().next().value;

    if (target.def.conduit) {
      const claimed = pendingIn.get(target.id) || 0;
      if (invTotal(target.inv) + claimed >= CONDUIT_CAP) continue; // downstream full
      pendingIn.set(target.id, claimed + 1);
      invTake(c.inv, item, 1);
      invAdd(target.inv, item, 1);
      load.set(c.id, load.get(c.id) - 1);
    } else if (wantedAmount(game, target, item) > 0) {
      invTake(c.inv, item, 1);
      invAdd(target.inv, item, 1);
      load.set(c.id, load.get(c.id) - 1);
    }
  }

  // --- pass 2: pull from the producer behind each conduit --------------------
  for (const c of conduits) {
    if (invTotal(c.inv) >= CONDUIT_CAP) continue;
    const [dx, dy] = DIRS[c.dir];
    const src = buildingAt(game, c.x - dx, c.y - dy);
    if (!src || src.def.conduit) continue;        // upstream conduits feed via pass 1
    for (const item of providableItems(src)) {
      const avail = invGet(src.inv, item) - (src.reserved.get(item) || 0);
      if (avail > 0) {
        invTake(src.inv, item, 1);
        invAdd(c.inv, item, 1);
        break;
      }
    }
  }
}
