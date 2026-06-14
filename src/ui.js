// DOM UI: top stats bar, build toolbar, research panel, building inspector.
// Reads game state; mutates it only through the same entry points the player
// would use (placeBuilding, selectResearch, ...).

import { ITEMS, BUILDINGS, RECIPES, TECHS } from './defs.js';
import {
  canPlace, placeBuilding, removeBuilding, buildingAt, invGet, logMsg,
  inReach, invAdd, toastMsg, takeAllFromBuilding, feedBuilding, wantedAmount,
} from './state.js';
import { canResearch, selectResearch } from './systems/research.js';
import { linkPortals } from './systems/portals.js';
import { banishAt } from './systems/enemies.js';
import {
  T_CRYSTAL, T_STONE, T_LEYWELL, T_ROCK, T_ABYSS, MINE_YIELD,
} from './config.js';

export class UI {
  constructor(game, renderer) {
    this.game = game;
    this.renderer = renderer;
    this.tool = 'select';        // 'select' | 'mine' | 'banish' | building type
    this.selected = null;        // selected building
    this.linking = null;         // portal awaiting its twin
    this.dir = 0;                // pending placement facing (0=E 1=S 2=W 3=N)
    this.mouse = [0, 0];         // last cursor position (screen px)
    this.uiTip = null;           // tooltip text for a hovered [data-tip] element
    this.el = {
      top: document.getElementById('topbar'),
      toolbar: document.getElementById('toolbar'),
      side: document.getElementById('sidepanel'),
      inspector: document.getElementById('inspector'),
      log: document.getElementById('log'),
      tooltip: document.getElementById('tooltip'),
    };
    this.buildToolbar();
  }

  setTool(tool) {
    this.tool = tool;
    this.linking = null;
    const isBuilding = tool in BUILDINGS;
    this.renderer.placing = isBuilding ? tool : null;
    this.renderer.placingDef = isBuilding ? BUILDINGS[tool] : null;
    this.renderer.placingDir = this.dir;
    for (const btn of this.el.toolbar.children) {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    }
  }

  // Rotate the pending placement direction (R key). Only meaningful for
  // rotatable buildings like conduits.
  rotate() {
    this.dir = (this.dir + 1) & 3;
    this.renderer.placingDir = this.dir;
    if (this.tool in BUILDINGS && BUILDINGS[this.tool].rotatable) {
      const names = ['East', 'South', 'West', 'North'];
      toastMsg(this.game, this.game.player.x, this.game.player.y - 1, `Facing ${names[this.dir]}`);
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
    btn.dataset.tip = tip;
    btn.onclick = () => this.setTool(tool);
    return btn;
  }

  // --- input handlers wired by main.js -------------------------------------

  onClick(tx, ty) {
    const game = this.game;
    const activeTool = this.tool !== 'select';
    if (activeTool && !inReach(game, tx, ty)) {
      toastMsg(game, tx + 0.5, ty + 0.5, 'Too far away');
      return;
    }
    if (this.tool in BUILDINGS) {
      const res = placeBuilding(game, this.tool, tx, ty, this.dir);
      if (typeof res === 'string') toastMsg(game, tx + 0.5, ty + 0.5, res);
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
      if (err) toastMsg(game, tx + 0.5, ty + 0.5, err);
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
    if (b && !inReach(this.game, tx, ty)) {
      toastMsg(this.game, tx + 0.5, ty + 0.5, 'Too far away');
      return;
    }
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
    this.refreshTooltip();
    this.el.log.innerHTML = g.log.slice(-4).map(m => m.text).join('<br>');
  }

  // --- hover context boxes ----------------------------------------------------

  refreshTooltip() {
    const tip = this.el.tooltip;
    const html = this.uiTip
      ? this.uiTip.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
      : this.worldTip();
    if (!html) { tip.style.display = 'none'; return; }
    tip.innerHTML = html;
    tip.style.display = 'block';
    const [mx, my] = this.mouse;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(mx + 16, innerWidth - r.width - 8) + 'px';
    tip.style.top = Math.min(my + 16, innerHeight - r.height - 8) + 'px';
  }

  // Context box for whatever is under the cursor in the world, or null.
  worldTip() {
    const hover = this.renderer.hover, hf = this.renderer.hoverF;
    if (!hover) return null;
    const g = this.game;

    const near = (e, r) => (e.x - hf.x) ** 2 + (e.y - hf.y) ** 2 < r * r;
    const wraith = g.wraiths.find(w => near(w, 0.6));
    if (wraith) return `<b>Wraith</b><br>HP ${wraith.hp | 0}/${wraith.maxHp}`;
    const golem = g.golems.find(go => near(go, 0.5));
    if (golem) {
      const doing = golem.carry
        ? `hauling ${golem.carry.n} ${ITEMS[golem.carry.item].name}`
        : golem.state === 'idle' ? 'idle' : 'fetching';
      return `<b>Golem</b><br>${doing}`;
    }

    const b = buildingAt(g, hover.x, hover.y);
    if (b) return this.buildingTip(b);

    const nest = g.nests.find(n =>
      Math.abs(n.x + 0.5 - hf.x) < 1.5 && Math.abs(n.y + 0.5 - hf.y) < 1.5);
    if (nest) {
      return `<b>Dark Shrine</b><br>` +
        `charge ${Math.min(100, nest.charge / nest.threshold * 100) | 0}%<br>` +
        `<span class="dim">Drinks corruption to spawn wraiths.<br>` +
        `Destroy with a Banish Sigil (✴).</span>`;
    }

    const t = g.world.getTile(hover.x, hover.y);
    if (t === T_CRYSTAL || t === T_STONE) {
      const name = t === T_CRYSTAL ? 'Mana Crystal Deposit' : 'Stone Deposit';
      return `<b>${name}</b><br>${g.world.getReserve(hover.x, hover.y)} remaining` +
        `<br><span class="dim">Hand-mine (⛏) or place a Siphon.</span>`;
    }
    if (t === T_LEYWELL) return `<b>Ley Well</b><br><span class="dim">Place a Ley Tap here to draw mana.</span>`;
    if (t === T_ROCK) return `<b>Ancient Rock</b><br><span class="dim">Impassable.</span>`;
    if (t === T_ABYSS) return `<b>The Abyss</b><br><span class="dim">Nothing can be built over it.</span>`;
    return null;
  }

  buildingTip(b) {
    const mana = b.network >= 0 || b.def.coverage
      ? `${(b.ratio * 100) | 0}%`
      : '<span class="bad">no network</span>';
    let html = `<b style="color:${b.def.color}">${b.def.name}</b><br>` +
      `HP ${b.hp | 0}/${b.def.hp}` +
      (b.def.manaUse || b.def.manaOut ? ` · mana ${mana}` : '');
    if (b.type === 'runeforge') html += `<br>recipe: ${RECIPES[b.recipeId] ? b.recipeId : 'none'}`;
    if (b.type === 'portal') html += `<br>${b.linkId ? `linked to portal #${b.linkId}` : 'unlinked'}`;
    if (b.progress > 0) html += `<br>progress ${(Math.min(1, b.progress) * 100) | 0}%`;
    if (b.inv.size) {
      html += '<br><span class="dim">' +
        [...b.inv].map(([i, n]) => `${ITEMS[i].name}: ${n}`).join(' · ') + '</span>';
    }
    return html;
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
      if (n > 0) html += `<span style="color:${ITEMS[id].color}">${ITEMS[id].name}: ${n}</span>`;
    }
    html += '</div><h3>Research</h3>';
    for (const id in TECHS) {
      const t = TECHS[id];
      const done = g.research.unlocked.has(id);
      const avail = canResearch(g, id);
      const cur = g.research.current === id;
      const cls = done ? 'tech done' : cur ? 'tech current' : avail ? 'tech avail' : 'tech locked';
      html += `<div class="${cls}" data-tech="${id}" data-tip="${t.desc}">` +
        `${t.name} <span class="dim">${done ? '✓' : cur ? `${g.research.progress | 0}/${t.cost}` : t.cost}</span></div>`;
    }
    if (html === this._sideHtml) return; // avoid destroying elements mid-click
    this._sideHtml = html;
    this.el.side.innerHTML = html;
    for (const div of this.el.side.querySelectorAll('.tech.avail, .tech.current')) {
      div.onclick = () => selectResearch(g, div.dataset.tech);
    }
  }

  refreshInspector() {
    const b = this.selected;
    if (!b || !this.game.buildings.has(b.id)) {
      this.el.inspector.style.display = 'none';
      this._inspHtml = null;
      return;
    }
    this.el.inspector.style.display = 'block';
    let html = `<h3>${b.def.name}</h3><div class="dim">${b.def.desc}</div>` +
      `<div>HP ${b.hp | 0}/${b.def.hp} · mana ${b.network >= 0 || b.def.coverage ? (b.ratio * 100 | 0) + '%' : '<span class="bad">no network</span>'}</div>`;
    if (b.inv.size) {
      html += '<div class="inv">' + [...b.inv].map(([i, n]) => `${ITEMS[i].name}: ${n}`).join(' · ') + '</div>';
    }
    const reachable = inReach(this.game, b.x, b.y);
    if (reachable && b.inv.size) {
      html += `<button id="take-items" data-tip="Move this building's items into your satchel">Take all</button> `;
    }
    if (reachable && this.playerCanFeed(b)) {
      html += `<button id="feed-items" data-tip="Hand over the items this building wants from your satchel">Feed</button>`;
    }
    if (!reachable && (b.inv.size || this.playerCanFeed(b))) {
      html += `<div class="dim">Walk closer to transfer items by hand.</div>`;
    }
    if (b.type === 'runeforge') {
      html += `<button id="cycle-recipe">Recipe: ${b.recipeId}</button>`;
    }
    if (b.type === 'portal') {
      html += b.linkId
        ? `<div>Linked to portal #${b.linkId}</div>`
        : `<button id="link-portal">${this.linking === b ? 'Click target portal…' : 'Link…'}</button>`;
    }
    // Only touch the DOM when content actually changed: rewriting innerHTML
    // every frame would destroy buttons mid-click, making them unclickable.
    if (html === this._inspHtml) return;
    this._inspHtml = html;
    this.el.inspector.innerHTML = html;
    const take = document.getElementById('take-items');
    if (take) take.onclick = () => {
      const moved = takeAllFromBuilding(this.game, b);
      toastMsg(this.game, b.x + 0.5, b.y + 0.5, moved ? `+${moved} items` : 'nothing free to take');
    };
    const feed = document.getElementById('feed-items');
    if (feed) feed.onclick = () => {
      const moved = feedBuilding(this.game, b);
      toastMsg(this.game, b.x + 0.5, b.y + 0.5, moved ? `fed ${moved} items` : 'nothing it wants');
    };
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

  // Whether the wizard holds anything this building would accept.
  playerCanFeed(b) {
    for (const [item] of this.game.player.inv) {
      if (wantedAmount(this.game, b, item) > 0) return true;
    }
    return false;
  }
}
