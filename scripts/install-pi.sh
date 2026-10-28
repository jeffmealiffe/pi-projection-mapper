#!/usr/bin/env bash
# One-shot setup for Raspberry Pi OS (Bookworm, desktop). Run from the repo dir as your normal user.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"

sudo apt-get update
sudo apt-get install -y nodejs npm ffmpeg curl
sudo apt-get install -y chromium-browser || sudo apt-get install -y chromium
(cd "$DIR" && npm install --omit=dev)

# Server as a systemd service
sed -e "s#__USER__#$USER#" -e "s#__DIR__#$DIR#" "$DIR/deploy/projection-mapper.service" \
  | sudo tee /etc/systemd/system/projection-mapper.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now projection-mapper

# Kiosk browser autostart (labwc = Pi OS Bookworm default on Pi 4/5)
chmod +x "$DIR/scripts/"*.sh
mkdir -p "$HOME/.config/labwc"
AUTOSTART="$HOME/.config/labwc/autostart"
grep -q projection-mapper "$AUTOSTART" 2>/dev/null || echo "$DIR/scripts/kiosk.sh &  # projection-mapper" >> "$AUTOSTART"

echo
echo "Done. Control UI: http://$(hostname).local:3000/   (reboot to start the kiosk output)"
