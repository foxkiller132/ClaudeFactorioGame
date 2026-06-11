// Global tuning constants. Keep all balance numbers here or in defs.js so the
// simulation systems stay mechanism-only.

export const CHUNK = 32;        // tiles per chunk side
export const TILE_PX = 8;       // base pixels per tile in the chunk render cache
export const UPS = 30;          // simulation updates per second
export const DT = 1 / UPS;

// Tile type codes (world terrain layer)
export const T_GRASS = 0;
export const T_ROCK = 1;
export const T_ABYSS = 2;
export const T_CRYSTAL = 3;
export const T_STONE = 4;
export const T_LEYWELL = 5;

export const BUILDABLE = new Set([T_GRASS, T_CRYSTAL, T_STONE, T_LEYWELL]);

// Logistics
export const JOB_SCAN_TICKS = 30;     // rebuild golem job list every N ticks
export const GOLEM_SPEED = 4.5;       // tiles per second
export const GOLEM_CAPACITY = 5;

// Corruption / enemies
export const CORRUPTION_TICKS = 30;   // diffusion step interval
export const CORRUPTION_SPREAD = 0.08;
export const CORRUPTION_DECAY = 0.015;
export const WRAITH_SPEED = 2.2;
export const WRAITH_RETARGET_TICKS = 60;
export const NEST_MIN_CHUNK_DIST = 5; // nests only generate this far from spawn
export const NEST_CHANCE = 0.10;

// Power
export const LINK_RANGE = 12;         // max distance between mana sources to join a network

// Hand mining yield per click
export const MINE_YIELD = 2;
