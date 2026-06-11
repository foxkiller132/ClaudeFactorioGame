// Magic research. Athenaeums convert scrolls into progress on the selected
// technology (production.js adds the points); this system finishes techs and
// applies their permanent effects.

import { TECHS } from '../defs.js';
import { logMsg } from '../state.js';

export function canResearch(game, techId) {
  const t = TECHS[techId];
  if (!t || game.research.unlocked.has(techId)) return false;
  return t.requires.every(r => game.research.unlocked.has(r));
}

export function selectResearch(game, techId) {
  if (!canResearch(game, techId)) return 'prerequisites not met';
  if (game.research.current !== techId) {
    game.research.current = techId;
    game.research.progress = 0;
  }
  return null;
}

export function researchTick(game) {
  const id = game.research.current;
  if (!id) return;
  const t = TECHS[id];
  if (game.research.progress < t.cost) return;
  game.research.unlocked.add(id);
  game.research.current = null;
  game.research.progress = 0;
  if (t.effect) {
    const m = game.mods;
    if (t.effect.speed) m.speed *= t.effect.speed;
    if (t.effect.manaOut) m.manaOut *= t.effect.manaOut;
    if (t.effect.wardDmg) m.wardDmg *= t.effect.wardDmg;
    if (t.effect.wardRange) m.wardRange += t.effect.wardRange;
  }
  logMsg(game, `Research complete: ${t.name}`);
}
