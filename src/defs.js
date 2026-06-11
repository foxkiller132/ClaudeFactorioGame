// All game content data: items, recipes, buildings, technologies.
// Systems read these tables; adding content should rarely require system changes.

export const ITEMS = {
  crystal:      { name: 'Mana Crystal',  color: '#5fd8e8' },
  stone:        { name: 'Hewn Stone',    color: '#9a9a8e' },
  shard:        { name: 'Attuned Shard', color: '#b06ef0' },
  runestone:    { name: 'Runestone',     color: '#e8b84a' },
  golem_core:   { name: 'Golem Core',    color: '#e07840' },
  scroll:       { name: 'Arcane Scroll', color: '#e8e0c0' },
  essence:      { name: 'Wraith Essence',color: '#90f090' },
  banish_sigil: { name: 'Banish Sigil',  color: '#f05050' },
};

// Recipes selectable in the runeforge (cycle by clicking the building).
export const RECIPES = {
  runestone:    { in: { shard: 1, stone: 2 },     out: { runestone: 1 },    time: 2.0 },
  scroll:       { in: { shard: 1, stone: 1 },     out: { scroll: 1 },       time: 3.0 },
  golem_core:   { in: { runestone: 2, shard: 3 }, out: { golem_core: 1 },   time: 4.0 },
  banish_sigil: { in: { runestone: 1, essence: 2 }, out: { banish_sigil: 1 }, time: 5.0, tech: 'banishment' },
};

// Fixed recipe used by every infuser.
export const INFUSE_RECIPE = { in: { crystal: 2 }, out: { shard: 1 }, time: 1.5 };

export const BUILDINGS = {
  ley_tap: {
    name: 'Ley Tap', glyph: '♠', color: '#a070ff', hp: 250,
    cost: { stone: 5 }, on: 'leywell',
    manaOut: 20, coverage: 4, corruption: 0.2,
    desc: 'Draws raw mana from a ley well. The root of every mana network.',
  },
  obelisk: {
    name: 'Obelisk', glyph: '▲', color: '#c0a0ff', hp: 120,
    cost: { stone: 2, shard: 1 },
    coverage: 8, corruption: 0,
    desc: 'Relays mana. Buildings within its aura are powered; obelisks within 12 tiles of another source link networks.',
  },
  siphon: {
    name: 'Crystal Siphon', glyph: '◈', color: '#50c8d8', hp: 180,
    cost: { stone: 3, shard: 2 }, on: 'deposit',
    manaUse: 3, speed: 0.5, corruption: 0.6,
    desc: 'Extracts crystals or stone from the deposit beneath it. 1 item / 2s.',
  },
  infuser: {
    name: 'Arcane Infuser', glyph: '♨', color: '#b070e0', hp: 200,
    cost: { stone: 5, shard: 1 },
    manaUse: 4, corruption: 0.5,
    desc: 'Infuses 2 mana crystals into 1 attuned shard.',
  },
  runeforge: {
    name: 'Runeforge', glyph: '⚒', color: '#e0a040', hp: 220,
    cost: { stone: 8, shard: 4 },
    manaUse: 5, corruption: 0.4,
    desc: 'Crafts advanced components. Select its recipe in the inspector.',
  },
  reliquary: {
    name: 'Reliquary', glyph: '▤', color: '#a8a890', hp: 150,
    cost: { stone: 6 },
    capacity: 200, corruption: 0,
    desc: 'Storage. Golems deposit surplus here and draw from it.',
  },
  athenaeum: {
    name: 'Athenaeum', glyph: '☆', color: '#e8e0a0', hp: 200,
    cost: { stone: 10, runestone: 4 },
    manaUse: 8, corruption: 0.3,
    desc: 'Consumes arcane scrolls to advance the selected research.',
  },
  ward: {
    name: 'Ward Tower', glyph: '†', color: '#f0f0f0', hp: 300,
    cost: { shard: 4, runestone: 2 },
    manaUse: 2, range: 8, damage: 25, cooldown: 1.0, corruption: 0,
    desc: 'Banishing beam vs wraiths. Needs mana; each shot draws a surge.',
  },
  golem_den: {
    name: 'Golem Den', glyph: '⌂', color: '#d08050', hp: 250,
    cost: { stone: 10, golem_core: 2 }, tech: 'golems',
    manaUse: 4, golems: 3, range: 24, corruption: 0.2,
    desc: 'Houses 3 golems that haul items between buildings within 24 tiles.',
  },
  portal: {
    name: 'Portal Frame', glyph: '⊗', color: '#60e0c0', hp: 200,
    cost: { runestone: 6, golem_core: 1 }, tech: 'portals',
    manaUse: 6, rate: 2, corruption: 0.8,
    desc: 'Link two portals to teleport items: pulls from adjacent outputs, pushes to adjacent inputs at the far end.',
  },
};

export const TECHS = {
  efficiency:   { name: 'Arcane Efficiency', cost: 150, requires: [],
                  effect: { speed: 1.25 },
                  desc: '+25% crafting and extraction speed.' },
  golems:       { name: 'Golem Legion', cost: 100, requires: [],
                  desc: 'Unlocks the Golem Den: automated item hauling.' },
  mana_mastery: { name: 'Mana Mastery', cost: 250, requires: ['efficiency'],
                  effect: { manaOut: 1.5 },
                  desc: 'Ley taps yield +50% mana.' },
  greater_wards:{ name: 'Greater Wards', cost: 200, requires: [],
                  effect: { wardDmg: 1.5, wardRange: 2 },
                  desc: 'Ward towers: +50% damage, +2 range.' },
  banishment:   { name: 'Rite of Banishment', cost: 200, requires: ['greater_wards'],
                  desc: 'Unlocks the Banish Sigil recipe: destroy wraith shrines.' },
  portals:      { name: 'Portal Network', cost: 300, requires: ['golems', 'mana_mastery'],
                  desc: 'Unlocks Portal Frames for long-range item teleportation.' },
};

export const START_INVENTORY = { stone: 40, crystal: 20, shard: 12 };
