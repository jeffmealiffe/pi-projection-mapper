'use strict';
// Pi Projection Mapper server.
//  - serves the control UI (/) and the output page (/output.html)
//  - holds the authoritative state and persists it to disk
//  - relays state/commands between controllers and output pages over WebSocket
//  - manages the media library (upload / list / delete)

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const {
  defaultState, defaultWindow, sanitizeState, sanitizeWindow, captureScene, applyScene, findScene,
} = require('./state');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || path.join(ROOT, 'media'));
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const MEDIA_EXT = /\.(mp4|m4v|webm|mov|mkv|ogv|ogg)$/i;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ---- state ---------------------------------------------------------------

let state = defaultState();
try {
  state = sanitizeState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
} catch (e) {
  if (e.code !== 'ENOENT') console.warn('Could not read state.json, starting fresh:', e.message);
}

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(state, null, 2), (err) => {
      if (err) return console.warn('save failed:', err.message);
      fs.rename(tmp, STATE_FILE, (e2) => e2 && console.warn('save failed:', e2.message));
    });
  }, 300);
}

// ---- http ----------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/media', express.static(MEDIA_DIR, { acceptRanges: true }));

function listMedia() {
  return fs
    .readdirSync(MEDIA_DIR)
    .filter((f) => MEDIA_EXT.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(MEDIA_DIR, f));
      return { name: f, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function safeName(name) {
  return path.basename(name).replace(/[^\w.\- ()]/g, '_');
}

const upload = multer({
  storage: multer.diskStorage({
    destination: MEDIA_DIR,
    filename: (_req, file, cb) => cb(null, safeName(file.originalname)),
  }),
  fileFilter: (_req, file, cb) =>
    MEDIA_EXT.test(file.originalname) ? cb(null, true) : cb(new Error('Unsupported file type')),
});

app.get('/api/media', (_req, res) => res.json(listMedia()));

app.post('/api/media', (req, res) => {
  upload.array('files')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    broadcast({ type: 'media', media: listMedia() });
    res.json(listMedia());
  });
});

app.delete('/api/media/:name', (req, res) => {
  const file = path.join(MEDIA_DIR, safeName(req.params.name));
  fs.unlink(file, (err) => {
    if (err && err.code !== 'ENOENT') return res.status(500).json({ error: err.message });
    broadcast({ type: 'media', media: listMedia() });
    res.json(listMedia());
  });
});

app.get('/api/state', (_req, res) => res.json(state));

// ---- scenes + trigger endpoints (for HomeSeer, Home Assistant, curl, ...) ----
// Apply by id or case-insensitive name. GET is allowed so a plain URL works as a trigger.

function runScene(sc) {
  state.windows = applyScene(state, sc);
  state.blackout = sc.blackout;
  saveSoon();
  broadcast({ type: 'global', global: globalOf(state) });
  broadcast({ type: 'windows', windows: state.windows });
  for (const id of Object.keys(sc.windows)) broadcast({ type: 'cmd', id, action: 'reset' });
}

function sceneRoute(req, res) {
  const sc = findScene(state, req.params.key);
  if (!sc) return res.status(404).json({ error: 'no such scene' });
  runScene(sc);
  res.json({ ok: true, scene: sc.name });
}
app.get('/api/scenes', (_req, res) => res.json(state.scenes.map(({ id, name }) => ({ id, name }))));
app.get('/api/scenes/:key/apply', sceneRoute);
app.post('/api/scenes/:key/apply', sceneRoute);

function blackoutRoute(on) {
  return (_req, res) => {
    state.blackout = on;
    saveSoon();
    broadcast({ type: 'global', global: globalOf(state) });
    res.json({ ok: true, blackout: on });
  };
}
for (const m of ['get', 'post']) {
  app[m]('/api/blackout/on', blackoutRoute(true));
  app[m]('/api/blackout/off', blackoutRoute(false));
}

function playAllRoute(playing) {
  return (_req, res) => {
    state.windows = state.windows.map((w) => ({ ...w, playing }));
    saveSoon();
    broadcast({ type: 'windows', windows: state.windows });
    res.json({ ok: true, playing });
  };
}
for (const m of ['get', 'post']) {
  app[m]('/api/play', playAllRoute(true));
  app[m]('/api/pause', playAllRoute(false));
}

// ---- websocket -----------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg, except) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c !== except && c.readyState === 1) c.send(data);
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', state, media: listMedia() })); // state includes scenes

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      // Patch global settings: { type:'global', patch:{ canvas, blackout, showOutlines, ... } }
      case 'global': {
        state = sanitizeState({ ...state, ...msg.patch, windows: state.windows, scenes: state.scenes });
        saveSoon();
        broadcast({ type: 'global', global: globalOf(state) }, ws); // sender already applied it locally
        break;
      }
      // Patch one window: { type:'window', id, patch:{...} }
      case 'window': {
        const i = state.windows.findIndex((w) => w.id === msg.id);
        if (i < 0) break;
        state.windows[i] = sanitizeWindow({ ...state.windows[i], ...msg.patch, id: msg.id });
        saveSoon();
        broadcast({ type: 'window', window: state.windows[i] }, ws);
        break;
      }
      case 'addWindow': {
        const w = sanitizeWindow({ ...defaultWindow(state.windows.length + 1), ...(msg.window || {}) });
        state.windows.push(w);
        saveSoon();
        broadcast({ type: 'windows', windows: state.windows });
        break;
      }
      case 'removeWindow': {
        state.windows = state.windows.filter((w) => w.id !== msg.id);
        saveSoon();
        broadcast({ type: 'windows', windows: state.windows });
        break;
      }
      case 'reorder': {
        const order = Array.isArray(msg.order) ? msg.order : [];
        state.windows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        saveSoon();
        broadcast({ type: 'windows', windows: state.windows });
        break;
      }
      // Scenes: save current playback/appearance as a scene (new, or overwrite with id), apply, rename, delete.
      case 'saveScene': {
        const old = state.scenes.find((s) => s.id === msg.id);
        const sc = captureScene(state, String(msg.name || (old && old.name) || 'Scene ' + (state.scenes.length + 1)), old && old.id);
        if (old) state.scenes[state.scenes.indexOf(old)] = sc;
        else state.scenes.push(sc);
        saveSoon();
        broadcast({ type: 'scenes', scenes: state.scenes });
        break;
      }
      case 'renameScene': {
        const sc = state.scenes.find((s) => s.id === msg.id);
        if (sc) sc.name = String(msg.name || sc.name).slice(0, 60);
        saveSoon();
        broadcast({ type: 'scenes', scenes: state.scenes });
        break;
      }
      case 'deleteScene':
        state.scenes = state.scenes.filter((s) => s.id !== msg.id);
        saveSoon();
        broadcast({ type: 'scenes', scenes: state.scenes });
        break;
      case 'applyScene': {
        const sc = state.scenes.find((s) => s.id === msg.id);
        if (sc) runScene(sc);
        break;
      }
      // Transient playback commands (not persisted): restart, seek, next, prev.
      case 'cmd':
        broadcast({ type: 'cmd', id: msg.id, action: msg.action, value: msg.value });
        break;
      // Output -> controllers playback status (not persisted).
      case 'status':
        broadcast({ type: 'status', status: msg.status }, ws);
        break;
    }
  });
});

function globalOf(s) {
  const { windows, scenes, ...rest } = s;
  return rest;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Projection mapper listening on http://0.0.0.0:${PORT}`);
  console.log(`  control: http://<this-host>:${PORT}/`);
  console.log(`  output:  http://localhost:${PORT}/output.html`);
  console.log(`  media:   ${MEDIA_DIR}`);
});
