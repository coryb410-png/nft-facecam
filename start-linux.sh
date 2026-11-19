#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
for B in google-chrome chromium chromium-browser microsoft-edge brave-browser; do
  if command -v $B >/dev/null; then
    exec $B --user-data-dir="$HOME/.config/nftfacecam-browser" --no-first-run --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --app="file://$DIR/index.html"
  fi
done
xdg-open "$DIR/index.html"
