// DOM UI: top stats bar, build toolbar, research panel, building inspector.
// Reads game state; mutates it only through the same entry points the player
// would use (placeBuilding, selectResearch, ...).

import { ITEMS, BUILDINGS, RECIPES, TECHS } from './defs.js';
import {
  canPlace, placeBuilding, removeBuilding, buildingAt, invGet, logMsg,
} from './state.js';
import { canResearch, selectResearch } from './systems/research.js';
import { linkPortals } from './systems/portals.js';
import { banishAt } from './systems/enemies.js';
import { T_CRYSTAL, T_STONE, MINE_YIELD } from './config.js';
import { invAdd } from './state.js';

export class UI {
  constructor(game, renderer) {
    this.game = game;
    this.renderer = renderer;
    this.tool = 'select';        // 'select' | 'mine' | 'banish' | building type
    this.selected = null;        // selected building
    this.linking = null;         // portal awaiting its twin
    this.el = {
      top: document.getElementById('topbar'),
      toolbar: document.getElementById('toolbar'),
      side: document.getElementById('sidepanel'),
      inspector: document.getElementById('inspector'),
      log: document.getElementById('log'),
    };
    this.buildToolbar();
  }

  setTool(tool) {
    this.tool = tool;
    this.linking = null;
    const isBuilding = tool in BUILDINGS;
    this.renderer.placing = isBuilding ? tool : null;
    this.renderer.placingDef = isBuilding ? BUILDINGS[tool] : null;
    for (const btn of this.el.toolbar.children) {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    }
  }

  buildToolbar() {
    const bar = this.el.toolbar;
    bar.innerHTML = '';
    const tools = [
      ['select', '☞', 'Select / inspect (right-click demolishes)'],
      ['mine', '⛏', `Hand-mine deposits (+${MINE_YIELD} per click)`],
      ['banish', '✴', 'Banish a dark shrine (consumes 1 Banish Sigil)'],
    ];
    for (const [tool, glyph, tip] of tools) {
      bar.appendChild(this.toolButton(tool, glyph, tip));
    }
    for (const type in BUILDINGS) {
      const d = BUILDINGS[type];
      const cost = Object.entries(d.cost).map(([i, n]) => `${n} ${ITEMS[i].name}`).join(', ');
      bar.appendChild(this.toolButton(type, d.glyph, `${d.name} — ${cost}\n${d.desc}`));
    }
    this.setTool('select');
  }

  toolButton(tool, glyph, tip) {
    const btn = document.createElement('button');
    btn.dataset.tool = tool;
    btn.textContent = glyph;
    btn.title = tip;
    btn.onclick = () => this.setTool(tool);
    return btn;
  }

  // --- input handlers wired by main.js -------------------------------------

  onClick(tx, ty) {
    const game = this.game;
    if (this.tool in BUILDINGS) {
      const res = placeBuilding(game, this.tool, tx, ty);
      if (typeof res === 'string') logMsg(game, `Cannot build: ${res}`);
      return;
    }
    if (this.tool === 'mine') {
      const t = game.world.getTile(tx, ty);
      if (t === T_CRYSTAL || t === T_STONE) {
        const got = game.world.extract(tx, ty, MINE_YIELD);
        if (got) invAdd(game.player.inv, t === T_CRYSTAL ? 'crystal' : 'stone', got);
      }
      return;
    }
    if (this.tool === 'banish') {
      const err = banishAt(game, tx + 0.5, ty + 0.5);
      if (err) logMsg(game, `Banish failed: ${err}`);
      return;
    }
    // select tool
    const b = buildingAt(game, tx, ty);
    if (this.linking && b && b.type === 'portal') {
      const err = linkPortals(game, this.linking, b);
      logMsg(game, err ? `Link failed: ${err}` : 'Portals linked.');
      this.linking = null;
    }
    this.selected = b;
  }

  onRightClick(tx, ty) {
    if (this.tool !== 'select') { this.setTool('select'); return; }
    const b = buildingAt(this.game, tx, ty);
    if (b) {
      removeBuilding(this.game, b, true);
      if (this.selected === b) this.selected = null;
    }
  }

  // --- per-frame refresh -----------------------------------------------------

  refresh(fps, ups) {
    const g = this.game;
    const s = g.stats;
    const research = g.research.current
      ? `${TECHS[g.research.current].name} ${g.research.progress | 0}/${TECHS[g.research.current].cost}`
      : 'none (select in panel →)';
    this.el.top.innerHTML =
      `<b>ARCANUM</b> &nbsp; mana ${s.demand ? (s.satisfaction * 100 | 0) : 100}% ` +
      `(${s.supply | 0} supply / ${s.demand | 0} draw) &nbsp; ` +
      `wraiths ${g.wraiths.length} &nbsp; research: ${research} &nbsp; ` +
      `<span class="dim">${fps} fps · ${ups} ups</span>`;
    this.refreshSide();
    this.refreshInspector();
    this.refreshToolbarAvail();
    this.el.log.innerHTML = g.log.slice(-4).map(m => m.text).join('<br>');
  }

  refreshToolbarAvail() {
    for (const btn of this.el.toolbar.children) {
      const type = btn.dataset.tool;
      const d = BUILDINGS[type];
      if (!d) continue;
      const locked = d.tech && !this.game.research.unlocked.has(d.tech);
      btn.classList.toggle('locked', !!locked);
    }
  }

  refreshSide() {
    const g = this.game;
    let html = '<h3>Satchel</h3><div class="inv">';
    for (const id in ITEMS) {
      const n = invGet(g.player.inv, id);
      if (n > 0) html += `<span title="${ITEMS[id].name}" style="color:${ITEMS[id].color}">${ITEMS[id].name}: ${n}</span>`;
    }
    html += '</div><h3>Research</h3>';
    for (const id in TECHS) {
      const t = TECHS[id];
      const done = g.research.unlocked.has(id);
      const avail = canResearch(g, id);
      const cur = g.research.current === id;
      const cls = done ? 'tech done' : cur ? 'tech current' : avail ? 'tech avail' : 'tech locked';
      html += `<div class="${cls}" data-tech="${id}" title="${t.desc}">` +
        `${t.name} <span class="dim">${done ? '✓' : cur ? `${g.research.progress | 0}/${t.cost}` : t.cost}</span></div>`;
    }
    this.el.side.innerHTML = html;
    for (const div of this.el.side.querySelectorAll('.tech.avail, .tech.current')) {
      div.onclick = () => selectResearch(g, div.dataset.tech);
    }
  }

  refreshInspector() {
    const b = this.selected;
    if (!b || !this.game.buildings.has(b.id)) {
      this.el.inspector.style.display = 'none';
      return;
    }
    this.el.inspector.style.display = 'block';
    let html = `<h3>${b.def.name}</h3><div class="dim">${b.def.desc}</div>` +
      `<div>HP ${b.hp | 0}/${b.def.hp} · mana ${b.network >= 0 || b.def.coverage ? (b.ratio * 100 | 0) + '%' : '<span class="bad">no network</span>'}</div>`;
    if (b.inv.size) {
      html += '<div class="inv">' + [...b.inv].map(([i, n]) => `${ITEMS[i].name}: ${n}`).join(' · ') + '</div>';
    }
    if (b.type === 'runeforge') {
      html += `<button id="cycle-recipe">Recipe: ${b.recipeId}</button>`;
    }
    if (b.type === 'portal') {
      html += b.linkId
        ? `<div>Linked to portal #${b.linkId}</div>`
        : `<button id="link-portal">${this.linking === b ? 'Click target portal…' : 'Link…'}</button>`;
    }
    this.el.inspector.innerHTML = html;
    const cyc = document.getElementById('cycle-recipe');
    if (cyc) cyc.onclick = () => {
      const ids = Object.keys(RECIPES).filter(id =>
        !RECIPES[id].tech || this.game.research.unlocked.has(RECIPES[id].tech));
      b.recipeId = ids[(ids.indexOf(b.recipeId) + 1) % ids.length];
      b.progress = 0;
    };
    const link = document.getElementById('link-portal');
    if (link) link.onclick = () => { this.linking = b; };
  }
}
