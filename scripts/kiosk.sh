#!/usr/bin/env bash
# Launch Chromium fullscreen on the projector output.
# Usage: scripts/kiosk.sh [url]   (default http://localhost:3000/output.html)
URL="${1:-http://localhost:3000/output.html}"
BROWSER="$(command -v chromium-browser || command -v chromium || true)"
[ -z "$BROWSER" ] && { echo "chromium not found (sudo apt install chromium-browser)"; exit 1; }

# Wait for the server so we don't start on an error page.
for _ in $(seq 1 60); do curl -fs "${URL%/output.html}/api/state" >/dev/null && break; sleep 1; done

exec "$BROWSER" \
  --kiosk --noerrdialogs --disable-infobars --incognito \
  --autoplay-policy=no-user-gesture-required \
  --disable-session-crashed-bubble --disable-pinch --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  --user-data-dir="${HOME}/.config/projection-mapper-chromium" \
  "$URL"
