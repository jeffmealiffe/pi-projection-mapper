'use strict';
// Output page: renders every window as a <video> warped onto its quad and
// follows state pushed by the server. ?role=preview mutes audio and does not
// report playback status (used for the live preview inside the control UI).

(function () {
  const params = new URLSearchParams(location.search);
  const isPreview = params.get('role') === 'preview';

  const stage = document.getElementById('stage');
  const gridEl = document.getElementById('grid');
  const blackEl = document.getElementById('blackout');
  const connEl = document.getElementById('conn');

  let global = { canvas: { w: 1920, h: 1080 }, blackout: false, showGrid: false };
  const wins = new Map(); // id -> { w, el, video, outline, label, idx, listKey }

  function srcUrl(item) {
    return /^https?:\/\//i.test(item) ? item : '/media/' + encodeURIComponent(item);
  }

  function fitStage() {
    stage.style.width = global.canvas.w + 'px';
    stage.style.height = global.canvas.h + 'px';
    const s = Math.min(innerWidth / global.canvas.w, innerHeight / global.canvas.h);
    stage.style.transform = `translate(${(innerWidth - global.canvas.w * s) / 2}px, ${(innerHeight - global.canvas.h * s) / 2}px) scale(${s})`;
  }
  addEventListener('resize', fitStage);

  function applyGlobal() {
    fitStage();
    gridEl.style.display = global.showGrid ? 'block' : 'none';
    blackEl.style.display = global.blackout ? 'block' : 'none';
  }

  function makeWin(w) {
    const el = document.createElement('div');
    el.className = 'win';
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.disablePictureInPicture = true;
    el.appendChild(video);
    const outline = document.createElement('div');
    outline.className = 'outline';
    const label = document.createElement('div');
    label.className = 'label';
    outline.appendChild(label);
    el.appendChild(outline);
    stage.insertBefore(el, gridEl);
    const rec = { w, el, video, outline, label, idx: 0, listKey: null, lastError: null };
    video.addEventListener('ended', () => onEnded(rec));
    video.addEventListener('error', () => {
      rec.lastError = 'cannot play ' + (video.currentSrc || '');
      // Skip a broken item when there is something else to play.
      if (rec.w.playlist.length > 1) setTimeout(() => advance(rec, 1), 1000);
    });
    video.addEventListener('playing', () => (rec.lastError = null));
    wins.set(w.id, rec);
    return rec;
  }

  function currentItem(rec) {
    return rec.w.playlist[rec.idx] || null;
  }

  function loadCurrent(rec) {
    const item = currentItem(rec);
    const v = rec.video;
    if (!item) {
      v.removeAttribute('src');
      v.load();
      return;
    }
    v.src = srcUrl(item);
    v.load();
    applyPlayback(rec);
  }

  function advance(rec, dir) {
    const list = rec.w.playlist;
    if (!list.length) return;
    if (rec.w.shuffle && list.length > 1 && dir > 0) {
      let n;
      do n = Math.floor(Math.random() * list.length); while (n === rec.idx);
      rec.idx = n;
    } else {
      rec.idx = (rec.idx + dir + list.length) % list.length;
    }
    loadCurrent(rec);
  }

  function onEnded(rec) {
    const { loopMode, playlist } = rec.w;
    if (loopMode === 'none') {
      if (rec.idx < playlist.length - 1) advance(rec, 1);
      return;
    }
    if (loopMode === 'one') return; // handled by video.loop
    advance(rec, 1);
  }

  function applyPlayback(rec) {
    const w = rec.w;
    const v = rec.video;
    v.loop = w.loopMode === 'one' || (w.loopMode === 'all' && w.playlist.length <= 1);
    v.muted = isPreview || w.muted;
    v.volume = w.volume;
    v.playbackRate = w.rate;
    if (w.playing && w.enabled) {
      const p = v.play();
      if (p) p.catch(() => {});
    } else {
      v.pause();
    }
  }

  function applyWindow(w) {
    const rec = wins.get(w.id) || makeWin(w);
    rec.w = w;
    const el = rec.el;
    el.style.display = w.enabled ? 'block' : 'none';
    el.style.width = w.size.w + 'px';
    el.style.height = w.size.h + 'px';
    el.style.transform = Homography.matrix3d(w.size.w, w.size.h, w.quad);
    el.style.opacity = w.opacity;
    rec.video.style.objectFit = w.fit;
    rec.video.style.filter = w.brightness === 1 ? '' : `brightness(${w.brightness})`;
    rec.video.style.transform = `scale(${w.flipH ? -1 : 1}, ${w.flipV ? -1 : 1})`;
    rec.outline.style.display = w.showOutline ? 'block' : 'none';
    rec.label.textContent = w.name;

    const key = w.playlist.join('\n');
    if (key !== rec.listKey) {
      rec.listKey = key;
      rec.idx = 0;
      loadCurrent(rec);
    } else {
      applyPlayback(rec);
    }
  }

  function setWindows(list) {
    const ids = new Set(list.map((w) => w.id));
    for (const [id, rec] of wins) {
      if (!ids.has(id)) {
        rec.video.pause();
        rec.el.remove();
        wins.delete(id);
      }
    }
    list.forEach((w, i) => {
      applyWindow(w);
      wins.get(w.id).el.style.zIndex = i + 1; // later windows on top
    });
  }

  function runCmd(msg) {
    const rec = wins.get(msg.id);
    if (!rec) return;
    switch (msg.action) {
      case 'reset': // scene change: back to first clip, from the start
        if (rec.idx !== 0) {
          rec.idx = 0;
          loadCurrent(rec);
        } else {
          rec.video.currentTime = 0;
        }
        break;
      case 'restart':
        rec.video.currentTime = 0;
        if (rec.w.playing) rec.video.play().catch(() => {});
        break;
      case 'seek':
        rec.video.currentTime = Math.max(0, Number(msg.value) || 0);
        break;
      case 'next':
        advance(rec, 1);
        break;
      case 'prev':
        advance(rec, -1);
        break;
      case 'jump':
        if (rec.w.playlist[msg.value] !== undefined) {
          rec.idx = msg.value;
          loadCurrent(rec);
        }
        break;
    }
  }

  // ---- websocket ----------------------------------------------------------

  let ws;
  let retry = 500;
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => {
      retry = 500;
      connEl.style.display = 'none';
    };
    ws.onclose = () => {
      connEl.style.display = isPreview ? 'none' : 'block';
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 5000);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case 'hello': {
          const { windows, scenes, ...g } = msg.state;
          global = g;
          applyGlobal();
          setWindows(windows);
          break;
        }
        case 'global':
          global = msg.global;
          applyGlobal();
          break;
        case 'windows':
          setWindows(msg.windows);
          break;
        case 'window': {
          // Keep z-order: re-applying a single window must not change its stacking.
          const prev = wins.get(msg.window.id);
          const z = prev ? prev.el.style.zIndex : '';
          applyWindow(msg.window);
          if (z) wins.get(msg.window.id).el.style.zIndex = z;
          break;
        }
        case 'cmd':
          runCmd(msg);
          break;
      }
    };
  }
  connect();

  if (!isPreview) {
    setInterval(() => {
      if (!ws || ws.readyState !== 1) return;
      const status = [];
      for (const [id, rec] of wins) {
        const v = rec.video;
        const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
        status.push({
          id,
          idx: rec.idx,
          time: v.currentTime || 0,
          duration: isFinite(v.duration) ? v.duration : 0,
          paused: v.paused,
          frames: q ? q.totalVideoFrames : 0,
          dropped: q ? q.droppedVideoFrames : 0,
          error: rec.lastError,
        });
      }
      ws.send(JSON.stringify({ type: 'status', status }));
    }, 500);
  }
})();
