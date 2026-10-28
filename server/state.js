'use strict';
// State model + validation. Quad corners are in canvas pixels, ordered
// top-left, top-right, bottom-right, bottom-left of the video rectangle.

const FITS = ['cover', 'contain', 'fill'];
const LOOP_MODES = ['all', 'one', 'none'];

function num(v, d, min = -Infinity, max = Infinity) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
}

function rectQuad(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function defaultWindow(n = 1) {
  const off = ((n - 1) % 6) * 40;
  return {
    id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: 'Window ' + n,
    enabled: true,
    size: { w: 640, h: 360 }, // content aspect of the video rectangle
    quad: rectQuad(200 + off, 150 + off, 640, 360),
    playlist: [], // file names in /media, or http(s) URLs
    loopMode: 'all',
    shuffle: false,
    playing: true,
    muted: true,
    volume: 1,
    rate: 1,
    fit: 'cover',
    opacity: 1,
    brightness: 1,
    flipH: false,
    flipV: false,
    showOutline: false,
  };
}

function sanitizeQuad(q, fallback) {
  if (!Array.isArray(q) || q.length !== 4) return fallback;
  const out = q.map((p) => (Array.isArray(p) && p.length === 2 ? [num(p[0], 0), num(p[1], 0)] : null));
  return out.every(Boolean) ? out : fallback;
}

function sanitizeWindow(w) {
  const d = defaultWindow();
  const size = w.size || {};
  return {
    id: String(w.id || d.id),
    name: String(w.name ?? d.name).slice(0, 60),
    enabled: w.enabled !== false,
    size: { w: num(size.w, d.size.w, 16, 8192), h: num(size.h, d.size.h, 16, 8192) },
    quad: sanitizeQuad(w.quad, d.quad),
    playlist: (Array.isArray(w.playlist) ? w.playlist : []).map(String).slice(0, 200),
    loopMode: LOOP_MODES.includes(w.loopMode) ? w.loopMode : d.loopMode,
    shuffle: !!w.shuffle,
    playing: w.playing !== false,
    muted: w.muted !== false,
    volume: num(w.volume, 1, 0, 1),
    rate: num(w.rate, 1, 0.1, 4),
    fit: FITS.includes(w.fit) ? w.fit : d.fit,
    opacity: num(w.opacity, 1, 0, 1),
    brightness: num(w.brightness, 1, 0, 2),
    flipH: !!w.flipH,
    flipV: !!w.flipV,
    showOutline: !!w.showOutline,
  };
}

// ---- scenes ---------------------------------------------------------------
// A scene snapshots what each window plays and how it looks (not where it is:
// size/quad/name stay put so switching scenes never disturbs alignment).

const SCENE_KEYS = [
  'enabled', 'playlist', 'loopMode', 'shuffle', 'playing', 'muted', 'volume', 'rate',
  'fit', 'opacity', 'brightness', 'flipH', 'flipV',
];

function pickSceneKeys(w) {
  const out = {};
  for (const k of SCENE_KEYS) if (k in w) out[k] = w[k];
  return out;
}

function sanitizeScene(sc) {
  const entries = {};
  for (const [id, e] of Object.entries(sc.windows || {})) {
    // run through window validation, then keep only the keys that were present
    const clean = sanitizeWindow({ ...e, id });
    entries[id] = pickSceneKeys(Object.fromEntries(Object.keys(e).map((k) => [k, clean[k]])));
  }
  return {
    id: String(sc.id || 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
    name: String(sc.name ?? 'Scene').slice(0, 60),
    blackout: !!sc.blackout,
    windows: entries,
  };
}

function captureScene(state, name, id) {
  const windows = {};
  for (const w of state.windows) windows[w.id] = pickSceneKeys(w);
  return sanitizeScene({ id, name, blackout: state.blackout, windows });
}

// Returns the windows with the scene applied; windows the scene doesn't know are left alone.
function applyScene(state, scene) {
  return state.windows.map((w) => (scene.windows[w.id] ? sanitizeWindow({ ...w, ...scene.windows[w.id] }) : w));
}

function findScene(state, key) {
  const k = String(key).toLowerCase();
  return state.scenes.find((s) => s.id === key) || state.scenes.find((s) => s.name.toLowerCase() === k);
}

function defaultState() {
  return {
    canvas: { w: 1920, h: 1080 },
    blackout: false,
    showGrid: false,
    windows: [],
    scenes: [],
  };
}

function sanitizeState(s) {
  const d = defaultState();
  const c = s.canvas || {};
  return {
    canvas: { w: num(c.w, d.canvas.w, 320, 8192), h: num(c.h, d.canvas.h, 240, 8192) },
    blackout: !!s.blackout,
    showGrid: !!s.showGrid,
    windows: (Array.isArray(s.windows) ? s.windows : []).map(sanitizeWindow),
    scenes: (Array.isArray(s.scenes) ? s.scenes : []).map(sanitizeScene).slice(0, 100),
  };
}

module.exports = {
  defaultState, defaultWindow, sanitizeState, sanitizeWindow, rectQuad,
  sanitizeScene, captureScene, applyScene, findScene,
};
