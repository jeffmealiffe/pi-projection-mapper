'use strict';
// Control UI: live preview with draggable keystone handles + per-window panel.

(function () {
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';

  let state = { canvas: { w: 1920, h: 1080 }, blackout: false, showGrid: false, windows: [], scenes: [] };
  let media = [];
  let status = {}; // window id -> latest playback status from the output page
  let selId = null;
  let selCorner = null;
  let ws;

  const win = (id) => state.windows.find((w) => w.id === id);
  const sel = () => win(selId);
  const color = (i) => `hsl(${(i * 67 + 20) % 360} 90% 58%)`;

  // ---- networking ---------------------------------------------------------

  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => setConn(true);
    ws.onclose = () => {
      setConn(false);
      setTimeout(connect, 1000);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case 'hello': {
          const { windows, ...g } = msg.state;
          state = { ...g, windows, scenes: g.scenes || [] };
          media = msg.media;
          if (!sel()) selId = state.windows[0] ? state.windows[0].id : null;
          renderAll();
          break;
        }
        case 'global': {
          state = { ...state, ...msg.global };
          renderAll();
          break;
        }
        case 'windows':
          state.windows = msg.windows;
          if (!sel()) selId = state.windows[0] ? state.windows[0].id : null;
          renderAll();
          break;
        case 'window': {
          const i = state.windows.findIndex((w) => w.id === msg.window.id);
          if (i >= 0) state.windows[i] = msg.window;
          renderAll();
          break;
        }
        case 'scenes':
          state.scenes = msg.scenes;
          renderScenes();
          break;
        case 'media':
          media = msg.media;
          renderMedia();
          break;
        case 'status':
          status = {};
          msg.status.forEach((s) => (status[s.id] = s));
          renderStatus();
          break;
      }
    };
  }

  function setConn(ok) {
    const el = $('conn');
    el.textContent = ok ? 'connected' : 'disconnected';
    el.className = 'pill ' + (ok ? 'ok' : 'bad');
  }

  // Local-first edits: apply immediately, push to server (others get it via broadcast).
  let pending = null;
  function patchWindow(id, patch, { live = false } = {}) {
    const w = win(id);
    if (!w) return;
    Object.assign(w, patch);
    if (live) {
      // coalesce drag updates to one message per frame
      pending = pending && pending.id === id ? { id, patch: { ...pending.patch, ...patch } } : { id, patch };
      requestAnimationFrame(flushPending);
    } else {
      send({ type: 'window', id, patch });
    }
    renderOverlay();
    syncPanel();
  }
  function flushPending() {
    if (!pending) return;
    send({ type: 'window', id: pending.id, patch: pending.patch });
    pending = null;
  }
  const patchGlobal = (patch) => {
    Object.assign(state, patch);
    send({ type: 'global', patch });
  };

  // ---- overlay (keystone handles) ----------------------------------------

  const overlay = $('overlay');
  const stageWrap = $('stageWrap');
  let drag = null;

  function layoutStage() {
    const { w, h } = state.canvas;
    stageWrap.style.aspectRatio = `${w} / ${h}`;
    overlay.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  function pxScale() {
    return state.canvas.w / (overlay.clientWidth || state.canvas.w);
  }

  function renderOverlay() {
    layoutStage();
    const k = pxScale();
    overlay.replaceChildren();
    state.windows.forEach((w, i) => {
      const c = color(i);
      const isSel = w.id === selId;
      const poly = document.createElementNS(SVGNS, 'polygon');
      poly.setAttribute('points', w.quad.map((p) => p.join(',')).join(' '));
      poly.setAttribute('fill', isSel ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,0.001)');
      poly.setAttribute('stroke', c);
      poly.setAttribute('stroke-width', (isSel ? 2.5 : 1.5) * k);
      poly.setAttribute('stroke-dasharray', w.enabled ? '' : `${6 * k} ${5 * k}`);
      poly.style.cursor = 'move';
      poly.addEventListener('pointerdown', (e) => startDrag(e, w.id, -1));
      overlay.appendChild(poly);

      if (isSel) {
        const [cx, cy] = centroid(w.quad);
        const t = document.createElementNS(SVGNS, 'text');
        t.textContent = w.name;
        t.setAttribute('x', cx);
        t.setAttribute('y', cy);
        t.setAttribute('fill', c);
        t.setAttribute('font-size', 16 * k);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('pointer-events', 'none');
        overlay.appendChild(t);
        w.quad.forEach((p, ci) => {
          const h = document.createElementNS(SVGNS, 'circle');
          h.setAttribute('cx', p[0]);
          h.setAttribute('cy', p[1]);
          h.setAttribute('r', (ci === selCorner ? 10 : 8) * k);
          h.setAttribute('fill', ci === selCorner ? c : 'rgba(0,0,0,.6)');
          h.setAttribute('stroke', c);
          h.setAttribute('stroke-width', 2 * k);
          h.style.cursor = 'crosshair';
          h.addEventListener('pointerdown', (e) => startDrag(e, w.id, ci));
          overlay.appendChild(h);
        });
      }
    });
  }

  function toCanvas(e) {
    const r = overlay.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * state.canvas.w, ((e.clientY - r.top) / r.height) * state.canvas.h];
  }

  function startDrag(e, id, corner) {
    e.preventDefault();
    e.stopPropagation();
    const changed = selId !== id;
    selId = id;
    selCorner = corner >= 0 ? corner : null;
    const w = win(id);
    drag = { id, corner, start: toCanvas(e), quad: w.quad.map((p) => [...p]) };
    overlay.setPointerCapture(e.pointerId);
    if (changed) renderAll();
    else renderOverlay();
  }

  overlay.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = toCanvas(e);
    const dx = x - drag.start[0];
    const dy = y - drag.start[1];
    const quad = drag.quad.map((p, i) =>
      drag.corner < 0 || drag.corner === i ? [Math.round(p[0] + dx), Math.round(p[1] + dy)] : p
    );
    patchWindow(drag.id, { quad }, { live: true });
  });
  const endDrag = () => {
    drag = null;
  };
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);

  overlay.addEventListener(
    'wheel',
    (e) => {
      const w = sel();
      if (!w) return;
      e.preventDefault();
      scaleQuad(w, Math.pow(1.002, -e.deltaY), true);
    },
    { passive: false }
  );

  overlay.addEventListener('pointerdown', () => {
    selCorner = null;
    renderOverlay();
  });

  addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && t.type !== 'range' && t.type !== 'checkbox') return;
    const w = sel();
    if (!w) return;
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const quad = w.quad.map((p, i) => (selCorner === null || selCorner === i ? [p[0] + d[0], p[1] + d[1]] : p));
    patchWindow(w.id, { quad }, { live: true });
  });

  // ---- geometry helpers ---------------------------------------------------

  function centroid(q) {
    return [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4];
  }

  function scaleQuad(w, f, live) {
    const [cx, cy] = centroid(w.quad);
    const quad = w.quad.map(([x, y]) => [Math.round(cx + (x - cx) * f), Math.round(cy + (y - cy) * f)]);
    patchWindow(w.id, { quad }, { live });
  }

  function resetShape(w, size = w.size) {
    const [cx, cy] = centroid(w.quad);
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const width = (d(w.quad[0], w.quad[1]) + d(w.quad[3], w.quad[2])) / 2;
    const height = (width * size.h) / size.w;
    const x = Math.round(cx - width / 2);
    const y = Math.round(cy - height / 2);
    const X = Math.round(x + width);
    const Y = Math.round(y + height);
    patchWindow(w.id, { size, quad: [[x, y], [X, y], [X, Y], [x, Y]] });
  }

  // ---- rendering ----------------------------------------------------------

  function renderAll() {
    $('showGrid').checked = state.showGrid;
    $('blackout').checked = state.blackout;
    if (document.activeElement !== $('canvasW')) $('canvasW').value = state.canvas.w;
    if (document.activeElement !== $('canvasH')) $('canvasH').value = state.canvas.h;
    renderOverlay();
    renderScenes();
    renderWinList();
    renderPlaylist();
    renderLibPick();
    renderMedia();
    syncPanel();
  }

  function renderScenes() {
    const ul = $('sceneList');
    ul.replaceChildren();
    for (const sc of state.scenes) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = sc.name;
      name.title = location.origin + '/api/scenes/' + encodeURIComponent(sc.name) + '/apply';
      const go = btn('▶ Apply', 'Apply this scene now', () => send({ type: 'applyScene', id: sc.id }));
      go.className = 'go';
      li.append(
        name,
        go,
        btn('⟳', 'Overwrite with the current state', () => {
          if (confirm(`Overwrite scene "${sc.name}" with what is set up now?`)) send({ type: 'saveScene', id: sc.id });
        }),
        btn('✎', 'Rename', () => {
          const n = prompt('Scene name', sc.name);
          if (n) send({ type: 'renameScene', id: sc.id, name: n });
        }),
        btn('✕', 'Delete scene', () => {
          if (confirm(`Delete scene "${sc.name}"?`)) send({ type: 'deleteScene', id: sc.id });
        })
      );
      ul.appendChild(li);
    }
    if (!state.scenes.length) ul.innerHTML = '<li class="muted">No scenes yet. Set up your windows, then save.</li>';
  }

  function renderWinList() {
    const ul = $('winList');
    ul.replaceChildren();
    state.windows.forEach((w, i) => {
      const li = document.createElement('li');
      li.className = w.id === selId ? 'sel' : '';
      li.innerHTML = '<span class="sw"></span><span class="name"></span>';
      li.querySelector('.sw').style.background = color(i);
      li.querySelector('.name').textContent = w.name + (w.enabled ? '' : ' (off)');
      li.addEventListener('click', () => {
        selId = w.id;
        selCorner = null;
        renderAll();
      });
      const up = btn('↑', 'Move down in stacking order (behind)', (e) => {
        e.stopPropagation();
        reorder(i, -1);
      });
      const dn = btn('↓', 'Move up in stacking order (in front)', (e) => {
        e.stopPropagation();
        reorder(i, 1);
      });
      const tg = btn(w.playing ? '⏸' : '▶', 'Play / pause', (e) => {
        e.stopPropagation();
        patchWindow(w.id, { playing: !w.playing });
        renderWinList();
      });
      li.append(tg, up, dn);
      ul.appendChild(li);
    });
    $('winPanel').classList.toggle('hidden', !sel());
  }

  function btn(text, title, fn) {
    const b = document.createElement('button');
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  }

  function reorder(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.windows.length) return;
    const ids = state.windows.map((w) => w.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    send({ type: 'reorder', order: ids });
  }

  function setVal(id, v) {
    const el = $(id);
    if (document.activeElement === el) return;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }

  function syncPanel() {
    const w = sel();
    $('winPanel').classList.toggle('hidden', !w);
    if (!w) return;
    setVal('wName', w.name);
    setVal('wEnabled', w.enabled);
    setVal('wOutline', w.showOutline);
    setVal('wMuted', w.muted);
    setVal('wVolume', Math.round(w.volume * 100));
    setVal('wRate', String(w.rate));
    setVal('wLoop', w.loopMode);
    setVal('wShuffle', w.shuffle);
    setVal('wFit', w.fit);
    setVal('wFlipH', w.flipH);
    setVal('wFlipV', w.flipV);
    setVal('wOpacity', Math.round(w.opacity * 100));
    setVal('wBright', Math.round(w.brightness * 100));
    setVal('wW', w.size.w);
    setVal('wH', w.size.h);
    const r = (w.size.w / w.size.h).toFixed(3);
    const preset = [...$('wAspect').options].find((o) => o.value && eval_ratio(o.value).toFixed(3) === r);
    $('wAspect').value = preset ? preset.value : '';
    $('bPlay').textContent = w.playing ? '⏸' : '▶';
    $('corners').textContent = ['TL', 'TR', 'BR', 'BL'].map((n, i) => `${n} ${w.quad[i][0]}, ${w.quad[i][1]}`).join('   ');
    renderStatus();
  }
  const eval_ratio = (s) => {
    const [a, b] = s.split(':').map(Number);
    return a / b;
  };

  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  let seeking = false;
  let lastIdx = -1;

  function renderStatus() {
    const w = sel();
    if (!w) return;
    const s = status[w.id];
    if (!s) {
      $('timeLbl').textContent = 'no output connected';
      $('nowPlaying').textContent = '';
      return;
    }
    if (!seeking) $('seek').value = s.duration ? Math.round((s.time / s.duration) * 1000) : 0;
    $('timeLbl').textContent = `${fmt(s.time)} / ${fmt(s.duration)}`;
    const item = w.playlist[s.idx];
    $('nowPlaying').textContent = s.error ? '⚠ ' + s.error : item ? 'Now: ' + item : 'Nothing queued — add a clip below';
    if (s.idx !== lastIdx) {
      lastIdx = s.idx;
      renderPlaylist();
    }
  }

  function renderPlaylist() {
    const w = sel();
    const ol = $('playlist');
    ol.replaceChildren();
    if (!w) return;
    const cur = status[w.id] ? status[w.id].idx : 0;
    w.playlist.forEach((item, i) => {
      const li = document.createElement('li');
      if (i === cur) li.className = 'cur';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item;
      name.title = item;
      li.append(
        name,
        btn('▶', 'Play this now', () => send({ type: 'cmd', id: w.id, action: 'jump', value: i })),
        btn('↑', 'Move up', () => movePl(w, i, -1)),
        btn('↓', 'Move down', () => movePl(w, i, 1)),
        btn('✕', 'Remove', () => patchWindow(w.id, { playlist: w.playlist.filter((_, k) => k !== i) }) || renderPlaylist())
      );
      ol.appendChild(li);
    });
    if (!w.playlist.length) ol.innerHTML = '<li class="muted">Empty playlist</li>';
  }

  function movePl(w, i, d) {
    const j = i + d;
    if (j < 0 || j >= w.playlist.length) return;
    const pl = [...w.playlist];
    [pl[i], pl[j]] = [pl[j], pl[i]];
    patchWindow(w.id, { playlist: pl });
    renderPlaylist();
  }

  function renderLibPick() {
    const s = $('libPick');
    const v = s.value;
    s.replaceChildren(...media.map((m) => new Option(m.name, m.name)));
    if (!media.length) s.appendChild(new Option('(upload a video first)', ''));
    s.value = v;
  }

  const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
  function renderMedia() {
    renderLibPick();
    const ul = $('mediaList');
    ul.replaceChildren();
    media.forEach((m) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="name"></span><span class="size"></span>';
      li.querySelector('.name').textContent = m.name;
      li.querySelector('.size').textContent = mb(m.size);
      li.append(
        btn('✕', 'Delete file', async () => {
          if (confirm(`Delete ${m.name} from the library?`)) await fetch('/api/media/' + encodeURIComponent(m.name), { method: 'DELETE' });
        })
      );
      ul.appendChild(li);
    });
    if (!media.length) ul.innerHTML = '<li class="muted">No media yet</li>';
  }

  // ---- wiring -------------------------------------------------------------

  const bind = (id, ev, fn) => $(id).addEventListener(ev, fn);
  const onWin = (id, ev, fn) =>
    bind(id, ev, (e) => {
      const w = sel();
      if (w) fn(w, e.target);
    });

  bind('showGrid', 'change', (e) => patchGlobal({ showGrid: e.target.checked }));
  bind('blackout', 'change', (e) => patchGlobal({ blackout: e.target.checked }));
  bind('playAll', 'click', () => state.windows.forEach((w) => patchWindow(w.id, { playing: true })) || renderWinList());
  bind('pauseAll', 'click', () => state.windows.forEach((w) => patchWindow(w.id, { playing: false })) || renderWinList());
  const canvasChange = () => patchGlobal({ canvas: { w: +$('canvasW').value, h: +$('canvasH').value } }) || renderOverlay();
  bind('canvasW', 'change', canvasChange);
  bind('canvasH', 'change', canvasChange);
  bind('addWin', 'click', () => {
    const before = new Set(state.windows.map((w) => w.id));
    send({ type: 'addWindow' });
    const t = setInterval(() => {
      const n = state.windows.find((w) => !before.has(w.id));
      if (n) {
        selId = n.id;
        clearInterval(t);
        renderAll();
      }
    }, 50);
    setTimeout(() => clearInterval(t), 2000);
  });
  bind('sceneSave', 'click', () => {
    send({ type: 'saveScene', name: $('sceneName').value.trim() });
    $('sceneName').value = '';
  });
  bind('livePreview', 'change', (e) => loadPreview(e.target.checked));

  onWin('wName', 'input', (w, el) => {
    patchWindow(w.id, { name: el.value });
    renderWinList();
  });
  onWin('wEnabled', 'change', (w, el) => {
    patchWindow(w.id, { enabled: el.checked });
    renderWinList();
  });
  onWin('wOutline', 'change', (w, el) => patchWindow(w.id, { showOutline: el.checked }));
  onWin('wDelete', 'click', (w) => {
    if (confirm(`Delete "${w.name}"?`)) send({ type: 'removeWindow', id: w.id });
  });

  onWin('bPlay', 'click', (w) => {
    patchWindow(w.id, { playing: !w.playing });
    renderWinList();
  });
  onWin('bRestart', 'click', (w) => send({ type: 'cmd', id: w.id, action: 'restart' }));
  onWin('bNext', 'click', (w) => send({ type: 'cmd', id: w.id, action: 'next' }));
  onWin('bPrev', 'click', (w) => send({ type: 'cmd', id: w.id, action: 'prev' }));
  bind('seek', 'pointerdown', () => (seeking = true));
  bind('seek', 'change', () => {
    seeking = false;
    const w = sel();
    const s = w && status[w.id];
    if (s && s.duration) send({ type: 'cmd', id: w.id, action: 'seek', value: ($('seek').value / 1000) * s.duration });
  });
  onWin('wMuted', 'change', (w, el) => patchWindow(w.id, { muted: el.checked }));
  onWin('wVolume', 'input', (w, el) => patchWindow(w.id, { volume: el.value / 100 }));
  onWin('wRate', 'change', (w, el) => patchWindow(w.id, { rate: +el.value }));
  onWin('wLoop', 'change', (w, el) => patchWindow(w.id, { loopMode: el.value }));
  onWin('wShuffle', 'change', (w, el) => patchWindow(w.id, { shuffle: el.checked }));

  onWin('libAdd', 'click', (w) => {
    const v = $('libPick').value;
    if (v) patchWindow(w.id, { playlist: [...w.playlist, v] }), renderPlaylist();
  });
  onWin('urlAdd', 'click', (w) => {
    const v = $('urlIn').value.trim();
    if (/^https?:\/\//i.test(v)) {
      patchWindow(w.id, { playlist: [...w.playlist, v] });
      $('urlIn').value = '';
      renderPlaylist();
    }
  });

  onWin('wFit', 'change', (w, el) => patchWindow(w.id, { fit: el.value }));
  onWin('wFlipH', 'change', (w, el) => patchWindow(w.id, { flipH: el.checked }));
  onWin('wFlipV', 'change', (w, el) => patchWindow(w.id, { flipV: el.checked }));
  onWin('wOpacity', 'input', (w, el) => patchWindow(w.id, { opacity: el.value / 100 }));
  onWin('wBright', 'input', (w, el) => patchWindow(w.id, { brightness: el.value / 100 }));

  onWin('wAspect', 'change', (w, el) => {
    if (!el.value) return;
    const [a, b] = el.value.split(':').map(Number);
    resetShape(w, { w: w.size.w, h: Math.round((w.size.w * b) / a) });
  });
  const sizeChange = (w) => resetShape(w, { w: +$('wW').value || w.size.w, h: +$('wH').value || w.size.h });
  onWin('wW', 'change', sizeChange);
  onWin('wH', 'change', sizeChange);
  onWin('gShrink', 'click', (w) => scaleQuad(w, 1 / 1.05));
  onWin('gGrow', 'click', (w) => scaleQuad(w, 1.05));
  onWin('gReset', 'click', (w) => resetShape(w));
  onWin('gCenter', 'click', (w) => {
    const [cx, cy] = centroid(w.quad);
    const dx = Math.round(state.canvas.w / 2 - cx);
    const dy = Math.round(state.canvas.h / 2 - cy);
    patchWindow(w.id, { quad: w.quad.map(([x, y]) => [x + dx, y + dy]) });
  });

  // upload
  bind('upBtn', 'click', () => $('upIn').click());
  bind('upIn', 'change', () => uploadFiles($('upIn').files));
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });
  function uploadFiles(files) {
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) $('upStatus').textContent = `Uploading… ${Math.round((e.loaded / e.total) * 100)}%`;
    };
    xhr.onload = () => {
      $('upStatus').textContent = xhr.status === 200 ? 'Upload complete' : 'Upload failed: ' + xhr.responseText;
      $('upIn').value = '';
    };
    xhr.onerror = () => ($('upStatus').textContent = 'Upload failed');
    xhr.send(fd);
  }

  function loadPreview(on) {
    $('preview').src = on ? 'output.html?role=preview' : 'about:blank';
  }

  addEventListener('resize', renderOverlay);
  loadPreview(true);
  connect();
})();
