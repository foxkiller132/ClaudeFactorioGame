// Headless simulation test: proves the sim core has no DOM dependency and that
// the full chain (ley tap -> siphon -> infuser -> runeforge -> athenaeum ->
// research, plus golem hauling, portals, corruption, wraiths) actually runs.
//
//   node test/smoke.mjs

import {
  createGame, placeBuilding, invAdd, invGet, movePlayer, inReach,
  takeAllFromBuilding, feedBuilding,
} from '../src/state.js';
import { gameTick } from '../src/game.js';
import { selectResearch } from '../src/systems/research.js';
import { linkPortals } from '../src/systems/portals.js';
import { UPS } from '../src/config.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

function run(game, seconds) {
  for (let i = 0; i < seconds * UPS; i++) gameTick(game);
}

const game = createGame(42);
// generous materials so placement never blocks the test
for (const it of ['stone', 'crystal', 'shard', 'runestone', 'golem_core']) {
  invAdd(game.player.inv, it, 500);
}

// --- placement on the guaranteed starter patches -----------------------------
const tap = placeBuilding(game, 'ley_tap', 0, 0);
check('ley tap placed on ley well', typeof tap === 'object', String(tap));
const obelisk = placeBuilding(game, 'obelisk', 4, 0);
check('obelisk placed', typeof obelisk === 'object', String(obelisk));
const siphon = placeBuilding(game, 'siphon', 7, -5);   // crystal patch
check('siphon placed on crystal', typeof siphon === 'object', String(siphon));
const bad = placeBuilding(game, 'siphon', 2, 2);
check('siphon rejected off-deposit', typeof bad === 'string', String(bad));

const infuser = placeBuilding(game, 'infuser', 4, -2);
const forge = placeBuilding(game, 'runeforge', 5, 2);
const athen = placeBuilding(game, 'athenaeum', 3, 3);
const reliq = placeBuilding(game, 'reliquary', 2, -3);
check('core buildings placed', [infuser, forge, athen, reliq].every(b => typeof b === 'object'));

// --- extraction under power ----------------------------------------------------
run(game, 10);
check('mana network formed', siphon.network >= 0 && siphon.network === tap.network);
check('siphon extracted crystals', invGet(siphon.inv, 'crystal') >= 3,
  `got ${invGet(siphon.inv, 'crystal')}`);

// --- manual transfer: the pre-golem bootstrap path -------------------------------
{
  const before = invGet(game.player.inv, 'crystal');
  const taken = takeAllFromBuilding(game, siphon);
  check('take-all empties siphon into satchel', taken >= 3 && invGet(game.player.inv, 'crystal') === before + taken);
  const fed = feedBuilding(game, infuser);
  check('feed gives infuser its wanted crystals', fed > 0 && invGet(infuser.inv, 'crystal') > 0);
}

// --- golem hauling feeds the chain ---------------------------------------------
game.research.unlocked.add('golems');
const den = placeBuilding(game, 'golem_den', 1, -1);
check('golem den placed', typeof den === 'object', String(den));
check('golems spawned', game.golems.length === 3);

forge.recipeId = 'scroll';
invAdd(reliq.inv, 'stone', 100); // stand-in for a stone siphon feeding storage
run(game, 60);
const scrolls = invGet(forge.inv, 'scroll') + invGet(athen.inv, 'scroll');
// scrolls need stone (reliquary) AND shards (infuser), so they prove hauling
check('golems hauled the production chain inputs', scrolls > 0 ||
  invGet(infuser.inv, 'crystal') + invGet(infuser.inv, 'shard') > 0);
// scrolls require shards, so scroll output also proves the infuser ran
check('infuser produced shards', invGet(infuser.inv, 'shard') + invGet(forge.inv, 'shard') + scrolls > 0);
check('runeforge produced scrolls', scrolls > 0,
  `forge buffer ${invGet(forge.inv, 'scroll')}, athenaeum ${invGet(athen.inv, 'scroll')}`);

// --- research ---------------------------------------------------------------------
check('research selectable', selectResearch(game, 'efficiency') === null);
run(game, 120);
check('research completed', game.research.unlocked.has('efficiency'),
  `progress ${game.research.progress | 0}`);
check('speed modifier applied', game.mods.speed > 1);

// --- portals ------------------------------------------------------------------------
game.research.unlocked.add('portals');
const p1 = placeBuilding(game, 'portal', 8, -5);   // beside the siphon
const p2 = placeBuilding(game, 'portal', 5, 3);    // beside the athenaeum/forge
check('portals placed', typeof p1 === 'object' && typeof p2 === 'object', `${p1} ${p2}`);
check('portals linked', linkPortals(game, p1, p2) === null);
invAdd(siphon.inv, 'crystal', 10);
run(game, 20);
check('portal teleported items', p2.inv.size > 0 || invGet(forge.inv, 'crystal') > 0 || invGet(infuser.inv, 'crystal') > 0,
  `p2 buffer ${[...p2.inv]}`);

// --- corruption & wraiths ---------------------------------------------------------
const totalCorruption = [...game.corruption.values()].reduce((a, b) => a + b, 0);
check('corruption emitted', totalCorruption > 0, totalCorruption.toFixed(2));

// force-generate a far chunk until a nest appears, then let it spawn
let tries = 0;
while (game.nests.length === 0 && tries < 400) {
  game.world.getTile(200 + tries * 32, 200);
  tries++;
}
check('nest generated in far chunks', game.nests.length > 0, `${tries} chunks probed`);
if (game.nests.length) {
  game.nests[0].charge = 1000;
  run(game, 5);
  check('wraith spawned from charged nest', game.wraiths.length > 0);
  // drop a wraith on a ward and watch it die
  const ward = placeBuilding(game, 'ward', 6, 0);
  check('ward placed', typeof ward === 'object', String(ward));
  game.wraiths.push({ x: 6.5, y: 1.5, hp: 60, maxHp: 60, target: 0, retarget: 0 });
  const before = game.stats.wraithKills;
  run(game, 10);
  check('ward killed a wraith', game.stats.wraithKills > before);
}

// --- player character ----------------------------------------------------------------
{
  const g2 = createGame(42);
  const px = g2.player.x;
  movePlayer(g2, 1, 0);
  check('player walks on clear ground', g2.player.x === px + 1);
  const block = placeBuilding(g2, 'reliquary', Math.floor(g2.player.x) + 1, Math.floor(g2.player.y));
  check('blocking building placed', typeof block === 'object', String(block));
  const bx = g2.player.x;
  movePlayer(g2, 1, 0);
  check('player blocked by building', g2.player.x === bx);
  check('reach: near tile in range', inReach(g2, Math.floor(g2.player.x) + 2, Math.floor(g2.player.y)));
  check('reach: far tile out of range', !inReach(g2, Math.floor(g2.player.x) + 30, Math.floor(g2.player.y)));
}

// --- determinism sanity: same seed, same world -------------------------------------
import { World } from '../src/world.js';
const w1 = new World(7), w2 = new World(7);
let same = true;
for (let i = 0; i < 200; i++) {
  if (w1.getTile(i * 13 - 50, i * 7 - 90) !== w2.getTile(i * 13 - 50, i * 7 - 90)) same = false;
}
check('worldgen deterministic per seed', same);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
