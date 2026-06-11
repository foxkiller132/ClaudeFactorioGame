# Arcanum — a factory of magic

A Factorio-like automation game where the factory is a wizard's ever-growing
arcane engine. Electricity becomes **mana**, pollution becomes **thaumic
corruption**, biters become **wraiths**, and logistics runs on **golems and
portals** instead of belts and trains.

Zero dependencies, no build step: plain ES modules + canvas.

## Running

```sh
python3 -m http.server 8000     # or any static file server
# open http://localhost:8000
```

Headless simulation test (no browser needed):

```sh
node test/smoke.mjs
```

## How to play

1. Build a **Ley Tap** (♠) on the purple ley well at spawn — the root of your
   mana network.
2. Build a **Crystal Siphon** (◈) on the cyan crystal patch. Extend mana
   coverage with **Obelisks** (▲) — buildings inside a source's aura are
   powered, and sources within 12 tiles of each other join networks.
3. Hand-mine (⛏) early materials, then chain **Infuser** (crystal → shard) →
   **Runeforge** (shards → runestones, scrolls, golem cores) →
   **Athenaeum** (scrolls → research).
4. Research **Golem Legion**, build a **Golem Den**: golems automatically haul
   items between producers, consumers, and **Reliquary** storage.
5. Your engine emits corruption; distant **dark shrines** (☠) drink it and
   birth wraiths that hunt your buildings. Defend with **Ward Towers** (†),
   harvest **wraith essence** from kills, research **Rite of Banishment**, and
   destroy shrines with Banish Sigils (✴ tool).
6. Research **Portal Network** for long-range logistics: a linked portal pulls
   from adjacent outputs and its twin pushes into adjacent inputs anywhere on
   the map.

Controls: WASD/arrows walk your wizard (shift to sprint; the camera follows,
middle-drag to free-look), wheel to zoom, left-click to use the selected tool,
right-click to demolish (or cancel the current tool), Esc to return to select.
Building, mining, demolishing, and banishing only work within the wizard's
reach — a floating "Too far away" prompt appears if you click beyond it.
Hover anything — 
buildings, deposits, wraiths, golems, shrines, toolbar buttons, techs — for a
context box describing it.

### Theme mapping

| Factorio | Arcanum |
|---|---|
| Electricity + poles | Mana networks: ley taps (generators) + obelisks (relays with coverage auras) |
| Mining drills | Crystal siphons on crystal/stone deposits |
| Furnaces / assemblers | Arcane infusers / runeforges |
| Labs + science packs | Athenaeums + arcane scrolls |
| Logistics bots | Golems (den-based, range-limited, fly straight lines) |
| Trains | Portal pairs teleporting items at a mana cost |
| Pollution | Thaumic corruption (chunk-grid diffusion) |
| Biters + nests | Wraiths + dark shrines that *feed on corruption* to spawn faster |
| Turrets | Ward towers drawing mana per shot |

## Architecture

The simulation core is completely DOM-free — `test/smoke.mjs` boots a full
game and runs the entire production/combat/research loop under plain Node.
Rendering and UI are thin layers on top.

```
src/
  config.js        constants & tuning
  defs.js          all content data: items, recipes, buildings, techs
  world.js         chunked lazy worldgen (typed arrays, deterministic noise)
  state.js         game state, inventories, building lifecycle, spatial index
  game.js          tick orchestrator (fixed order of systems)
  systems/
    power.js       mana networks (union-find over sources, per-network ratios)
    production.js  extraction & crafting (declare-work / satisfy / act phases)
    logistics.js   golem job matching with reservation bookkeeping
    portals.js     linked-portal item teleportation
    enemies.js     corruption diffusion, shrines, wraiths, wards, banishment
    research.js    tech completion & permanent modifiers
  render.js        canvas renderer (cached chunk bitmaps, viewport culling)
  ui.js            DOM toolbar / research panel / inspector
  main.js          input + fixed-timestep loop (30 UPS, render decoupled)
```

### Performance choices (for large bases)

- **Chunked world, generated lazily** — `Uint8Array` terrain + `Uint32Array`
  reserves per 32×32 chunk; the map is unbounded but you only pay for what
  you explore.
- **Fixed 30 UPS timestep with an accumulator**; rendering runs at display
  rate independently and clamps catch-up after tab pauses.
- **Cached chunk bitmaps** — terrain rasterises once per chunk into an
  offscreen canvas; per-frame terrain cost is ~a dozen `drawImage` calls at
  any base size. Entities are viewport-culled.
- **Coarse-grained corruption** — simulated on the chunk grid (one float per
  chunk), like Factorio's pollution, not per tile.
- **Event-driven network rebuilds** — mana networks recompute only when a
  building is placed/destroyed; steady-state power is one pass of
  supply/demand accounting.
- **Amortised logistics** — golem jobs are matched every 30 ticks with
  reservation counters (`incoming`/`reserved`) so golems never duplicate
  hauls; per-tick golem work is pure movement.
- **Chunk-bucketed spatial index** (`byChunk`) for nearest-building queries by
  wraiths instead of global scans.
- **Data-driven content** — new items/recipes/buildings/techs are rows in
  `defs.js`; systems are mechanism-only, so content scales without code
  changes.

## Roadmap ideas

- Save/load (serialize state to localStorage)
- Multi-tile buildings, conveyance runes (belt analogue)
- Wraith variants and shrine assaults; mana shields
- Rituals: endgame megastructure (rocket-launch analogue)
- Web worker simulation thread for very large bases
