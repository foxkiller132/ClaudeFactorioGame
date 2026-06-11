// Entry point: wires the DOM-free simulation to the canvas renderer and UI,
// and runs a fixed-timestep loop (render decoupled from simulation).

import { createGame, logMsg } from './state.js';
import { gameTick } from './game.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { UPS } from './config.js';

const canvas = document.getElementById('game');
const game = createGame(Date.now() & 0xffff);
const renderer = new Renderer(canvas, game);
const ui = new UI(game, renderer);

logMsg(game, 'Build a Ley Tap on the ley well, then a Siphon on the crystals.');

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
  keys.add(e.key.toLowerCase());
  if (e.key === 'Escape') ui.setTool('select');
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

let dragging = false, dragMoved = false, lastMouse = [0, 0];

canvas.addEventListener('mousedown', e => {
  if (e.button === 1 || e.button === 0) { dragging = e.button === 1; dragMoved = false; }
  lastMouse = [e.clientX, e.clientY];
});
canvas.addEventListener('mousemove', e => {
  const dx = e.clientX - lastMouse[0], dy = e.clientY - lastMouse[1];
  if (dragging) {
    renderer.cam.x -= dx / renderer.cam.zoom;
    renderer.cam.y -= dy / renderer.cam.zoom;
    dragMoved = true;
  }
  lastMouse = [e.clientX, e.clientY];
  const [wx, wy] = renderer.screenToWorld(e.clientX, e.clientY);
  renderer.hover = { x: Math.floor(wx), y: Math.floor(wy) };
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

  // camera pan
  const pan = (keys.has('shift') ? 40 : 20) * dt;
  if (keys.has('w') || keys.has('arrowup')) renderer.cam.y -= pan;
  if (keys.has('s') || keys.has('arrowdown')) renderer.cam.y += pan;
  if (keys.has('a') || keys.has('arrowleft')) renderer.cam.x -= pan;
  if (keys.has('d') || keys.has('arrowright')) renderer.cam.x += pan;

  acc += dt;
  const step = 1 / UPS;
  while (acc >= step) {
    gameTick(game);
    ticks++;
    acc -= step;
  }

  renderer.draw();
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
