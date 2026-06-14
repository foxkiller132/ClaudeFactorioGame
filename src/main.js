// Entry point: wires the DOM-free simulation to the canvas renderer and UI,
// and runs a fixed-timestep loop (render decoupled from simulation).

import { createGame, logMsg, movePlayer } from './state.js';
import { gameTick } from './game.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { UPS, PLAYER_SPEED } from './config.js';
import {
  saveToStorage, loadFromStorage, copyStateInto, hasSave,
} from './save.js';

const canvas = document.getElementById('game');
const game = createGame(Date.now() & 0xffff);
const renderer = new Renderer(canvas, game);
const ui = new UI(game, renderer);

// Resume a previous session if one is stored; otherwise start fresh.
if (hasSave()) {
  try {
    copyStateInto(game, loadFromStorage());
    renderer.chunkCache.clear();
    renderer.cam.x = game.player.x;
    renderer.cam.y = game.player.y;
    logMsg(game, 'Saved realm restored. (F5 save · F9 reload · F8 new world)');
  } catch (err) {
    logMsg(game, 'Could not read save: ' + err.message);
  }
} else {
  logMsg(game, 'Build a Ley Tap on the ley well, then a Siphon on the crystals.');
}

function doSave() {
  try {
    const bytes = saveToStorage(game);
    logMsg(game, `Realm saved (${(bytes / 1024).toFixed(1)} KB).`);
  } catch (err) {
    logMsg(game, 'Save failed: ' + err.message);
  }
}

function doLoad() {
  const loaded = loadFromStorage();
  if (!loaded) { logMsg(game, 'No save to load.'); return; }
  copyStateInto(game, loaded);
  renderer.chunkCache.clear();
  ui.selected = null;
  logMsg(game, 'Realm reloaded.');
}

// Autosave every 2 minutes of real time and on tab close.
let autosaveAt = performance.now() + 120000;
addEventListener('beforeunload', () => { try { saveToStorage(game); } catch {} });

function resize() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}
addEventListener('resize', resize);
resize();

// --- input ----------------------------------------------------------------

const keys = new Set();
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'F5') { e.preventDefault(); doSave(); return; }
  if (e.key === 'F9') { e.preventDefault(); doLoad(); return; }
  if (e.key === 'F8') {
    e.preventDefault();
    copyStateInto(game, createGame(Date.now() & 0xffff));
    renderer.chunkCache.clear();
    ui.selected = null;
    logMsg(game, 'A new realm awakens.');
    return;
  }
  if (e.key.toLowerCase() === 'r') { ui.rotate(); return; }
  keys.add(e.key.toLowerCase());
  if (e.key === 'Escape') ui.setTool('select');
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

let dragging = false, dragMoved = false, lastMouse = [0, 0];
let followCam = true; // camera tracks the wizard until the player free-pans

canvas.addEventListener('mousedown', e => {
  if (e.button === 1 || e.button === 0) { dragging = e.button === 1; dragMoved = false; }
  lastMouse = [e.clientX, e.clientY];
});
// Document-level so hover state and tooltips update over UI panels too.
document.addEventListener('mousemove', e => {
  const dx = e.clientX - lastMouse[0], dy = e.clientY - lastMouse[1];
  if (dragging) {
    renderer.cam.x -= dx / renderer.cam.zoom;
    renderer.cam.y -= dy / renderer.cam.zoom;
    dragMoved = true;
    followCam = false;
  }
  lastMouse = [e.clientX, e.clientY];
  ui.mouse = [e.clientX, e.clientY];
  if (e.target === canvas) {
    const [wx, wy] = renderer.screenToWorld(e.clientX, e.clientY);
    renderer.hover = { x: Math.floor(wx), y: Math.floor(wy) };
    renderer.hoverF = { x: wx, y: wy };
    ui.uiTip = null;
  } else {
    renderer.hover = renderer.hoverF = null;
    const tipped = e.target.closest && e.target.closest('[data-tip]');
    ui.uiTip = tipped ? tipped.dataset.tip : null;
  }
});
canvas.addEventListener('mouseup', e => {
  dragging = false;
  if (e.button === 0 && !dragMoved) {
    const [wx, wy] = renderer.screenToWorld(e.clientX, e.clientY);
    ui.onClick(Math.floor(wx), Math.floor(wy));
  }
});
canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const [wx, wy] = renderer.screenToWorld(e.clientX, e.clientY);
  ui.onRightClick(Math.floor(wx), Math.floor(wy));
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const z = renderer.cam.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15);
  renderer.cam.zoom = Math.max(4, Math.min(48, z));
}, { passive: false });

// --- loop -------------------------------------------------------------------

let acc = 0, last = performance.now();
let frames = 0, ticks = 0, fps = 0, ups = 0, statT = 0;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.25); // avoid spiral of death after a paused tab

  // wizard movement (camera follows)
  let mx = 0, my = 0;
  if (keys.has('w') || keys.has('arrowup')) my -= 1;
  if (keys.has('s') || keys.has('arrowdown')) my += 1;
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
  if (keys.has('d') || keys.has('arrowright')) mx += 1;
  if (mx || my) {
    const speed = PLAYER_SPEED * (keys.has('shift') ? 1.6 : 1) * dt;
    const len = Math.hypot(mx, my);
    movePlayer(game, mx / len * speed, my / len * speed);
    followCam = true;
  }
  if (followCam) {
    const k = Math.min(1, dt * 8);
    renderer.cam.x += (game.player.x - renderer.cam.x) * k;
    renderer.cam.y += (game.player.y - renderer.cam.y) * k;
  }

  acc += dt;
  const step = 1 / UPS;
  while (acc >= step) {
    gameTick(game);
    ticks++;
    acc -= step;
  }

  if (now >= autosaveAt) {
    autosaveAt = now + 120000;
    doSave();
  }

  renderer.draw(now / 1000);
  frames++;
  statT += dt;
  if (statT >= 1) {
    fps = frames; ups = ticks;
    frames = ticks = 0; statT -= 1;
  }
  ui.refresh(fps, ups);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Tell the inline boot watchdog (index.html) we started cleanly.
if (typeof window.__arcanumBooted === 'function') window.__arcanumBooted();
