// Simulation orchestrator: one fixed-timestep tick. Order matters:
// declare work -> power balance -> act. Everything here is DOM-free.

import { declareWork, productionTick } from './systems/production.js';
import { powerTick } from './systems/power.js';
import { golemTick } from './systems/logistics.js';
import { portalTick } from './systems/portals.js';
import { corruptionTick, wraithTick, wardTick } from './systems/enemies.js';
import { researchTick } from './systems/research.js';
import { DT } from './config.js';

export function gameTick(game) {
  game.tick++;
  declareWork(game);
  powerTick(game);
  productionTick(game);
  golemTick(game);
  portalTick(game);
  corruptionTick(game);
  wraithTick(game);
  wardTick(game);
  researchTick(game);
  // age transient render effects
  for (let i = 0; i < game.effects.length; i++) {
    if ((game.effects[i].ttl -= DT) <= 0) {
      game.effects[i] = game.effects[game.effects.length - 1];
      game.effects.pop();
      i--;
    }
  }
}
