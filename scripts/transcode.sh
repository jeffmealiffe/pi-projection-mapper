#!/usr/bin/env bash
# Re-encode clips so the Pi can decode several at once.
# Usage: scripts/transcode.sh input.mov [WIDTH] [FPS]   -> media/<name>.mp4
# Pick WIDTH close to how large the window really is on the projector (default 1280).
set -euo pipefail
IN="$1"; W="${2:-1280}"; FPS="${3:-30}"
OUT="$(dirname "$0")/../media/$(basename "${IN%.*}").mp4"
ffmpeg -y -i "$IN" -vf "scale=${W}:-2,fps=${FPS}" \
  -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p -crf 23 -preset slow \
  -c:a aac -b:a 128k -movflags +faststart "$OUT"
echo "wrote $OUT"
