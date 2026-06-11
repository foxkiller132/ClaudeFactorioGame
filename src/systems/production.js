// Extraction and crafting. Phase 1 (declareWork) marks which buildings have
// work this tick so the power system can compute demand; phase 2 (productionTick)
// advances progress scaled by each building's mana satisfaction ratio.

import { DT, T_CRYSTAL } from '../config.js';
import { RECIPES, INFUSE_RECIPE } from '../defs.js';
import { invAdd, invGet, invTake, invHasAll, invTotal } from '../state.js';

const OUTPUT_CAP = 20; // products buffered before a producer stalls

function recipeOf(b) {
  if (b.type === 'infuser') return INFUSE_RECIPE;
  if (b.type === 'runeforge') return RECIPES[b.recipeId] || null;
  return null;
}

function outputBlocked(b, recipe) {
  for (const item in recipe.out) {
    if (invGet(b.inv, item) >= OUTPUT_CAP) return true;
  }
  return false;
}

export function declareWork(game) {
  for (const b of game.buildings.values()) {
    switch (b.type) {
      case 'siphon':
        b.wants = game.world.getReserve(b.x, b.y) > 0 && invTotal(b.inv) < OUTPUT_CAP;
        break;
      case 'infuser':
      case 'runeforge': {
        const r = recipeOf(b);
        b.wants = !!r && (b.progress > 0 || invHasAll(b.inv, r.in)) && !outputBlocked(b, r);
        break;
      }
      case 'athenaeum':
        b.wants = !!game.research.current &&
          (b.progress > 0 || invGet(b.inv, 'scroll') > 0);
        break;
      case 'ward':
        b.wants = true; // wards keep a standing draw so they can fire instantly
        break;
      case 'golem_den':
        b.wants = game.golems.some(g => g.denId === b.id && g.state !== 'idle');
        break;
      case 'portal':
        b.wants = b.linkId !== 0;
        break;
      default:
        b.wants = false;
    }
  }
}

export function productionTick(game) {
  const speed = game.mods.speed;
  for (const b of game.buildings.values()) {
    if (b.ratio <= 0) continue;
    switch (b.type) {
      case 'siphon': {
        b.progress += DT * b.def.speed * speed * b.ratio;
        if (b.progress >= 1) {
          b.progress -= 1;
          const tile = game.world.getTile(b.x, b.y);
          const item = tile === T_CRYSTAL ? 'crystal' : 'stone';
          if (game.world.extract(b.x, b.y, 1) > 0) invAdd(b.inv, item, 1);
        }
        break;
      }
      case 'infuser':
      case 'runeforge': {
        const r = recipeOf(b);
        if (!r) break;
        if (b.progress === 0) {
          if (!invHasAll(b.inv, r.in)) break;
          for (const item in r.in) invTake(b.inv, item, r.in[item]);
        }
        b.progress += DT * speed * b.ratio / r.time;
        if (b.progress >= 1) {
          b.progress = 0;
          for (const item in r.out) invAdd(b.inv, item, r.out[item]);
        }
        break;
      }
      case 'athenaeum': {
        if (b.progress === 0) {
          if (invTake(b.inv, 'scroll', 1) < 1) break;
        }
        b.progress += DT * speed * b.ratio / 4; // 4s per scroll
        if (b.progress >= 1) {
          b.progress = 0;
          game.research.progress += 10;
        }
        break;
      }
    }
  }
}
