# Pi Projection Mapper

Play several videos **independently** in specific regions of a projector's output, each with its own
**4-corner keystone**, source/playlist and playback controls — driven from a web UI on your LAN.
Built for Halloween rear-projection onto small windows, but works for any multi-surface projection.

- **Per-window keystone**: drag the four corners; the video is warped with a GPU homography (CSS `matrix3d`).
- **Sizing / placement**: drag to move, wheel or ± to scale, arrow-key nudging (Shift = 10 px), aspect presets.
- **Independent playback** per window: play/pause, restart, seek, prev/next, speed, volume/mute, loop
  (playlist / single clip / once), shuffle.
- **Independent sources**: each window has its own playlist of uploaded clips or `http(s)` video URLs.
- **Appearance**: fit (crop/letterbox/stretch), opacity, brightness, flip H/V, stacking order.
- **Alignment aids**: calibration grid, per-window outline, blackout.
- **Live preview** in the control page, multi-client safe (phone + laptop at once), state persists across restarts.

## How it works

```
 browser (any device) ──┐
                        ├── WebSocket ── Node server (state, media library) ── WebSocket ── Chromium kiosk
 browser (any device) ──┘                                                                (output.html → projector)
```

The Pi runs a small Node server and a fullscreen Chromium pointed at `/output.html`. Everything else is
configured from `http://<pi-hostname>.local:3000/`.

## Install on a Raspberry Pi (Pi OS Bookworm, desktop)

```bash
git clone https://github.com/jeffmealiffe/pi-projection-mapper.git
cd pi-projection-mapper
scripts/install-pi.sh
sudo reboot
```

This installs Node/Chromium/ffmpeg, runs the server as a systemd service (`projection-mapper`), and adds
`scripts/kiosk.sh` to the labwc autostart so the output page fills the projector on boot.

Then open `http://<pi-hostname>.local:3000/`, upload clips, **Add window**, and:

1. Turn on **Grid** and each window's **Outline**.
2. Set the canvas size to the projector's resolution (default 1920×1080).
3. Drag each window's corners until it lines up with its physical window.

### Running anywhere else (testing)

```bash
npm install
npm start          # control UI on :3000, output at /output.html
```

Environment: `PORT` (3000), `DATA_DIR` (`./data`, holds `state.json`), `MEDIA_DIR` (`./media`).

## Performance tips for the Pi

- **Pre-scale clips** to about the size the window occupies on the projector. A 4K clip in a 300 px window wastes decode time.
  `scripts/transcode.sh input.mov 960 30` makes a Pi-friendly H.264 MP4 in `media/`.
- Pi 4 has hardware H.264 decode; Pi 5 decodes H.264 in software (fine for several 720p clips, fewer at 1080p).
  Use H.264 MP4 or WebM VP9 at modest bitrates.
- Use `muted` windows unless you need audio (HDMI audio goes to the projector; `Mute` is on by default).

## Security

There is **no authentication**: anyone on the network can reach the control UI and upload files. Keep it on a
trusted LAN (or firewall/VPN it). The server only serves files from `MEDIA_DIR` and restricts uploads to video extensions.

## Layout

| Path | Purpose |
| --- | --- |
| `server/` | Express + WebSocket server, state validation, media API |
| `public/output.js` | Output renderer (video elements + homography warp) |
| `public/app.js` | Control UI (preview overlay, keystone handles, panels) |
| `public/homography.js` | Rect → quad matrix solver (unit-tested) |
| `scripts/`, `deploy/` | Pi install, kiosk launcher, transcoder, systemd unit |

## Roadmap ideas

HLS/RTSP sources, edge-blend/feather masks, scenes/presets with triggers (MQTT / HomeSeer / motion sensor),
curved (mesh) warp, per-window schedules.

## License

MIT
