#!/bin/bash
# Opens NFT FaceCam in its own Chrome/Edge window, set up so it keeps running
# smoothly while OBS captures it in the background.
DIR="$(cd "$(dirname "$0")" && pwd)"
URL="file://${DIR// /%20}/index.html"
PROFILE="$HOME/Library/Application Support/NFTFaceCam/BrowserProfile"
FLAGS=(--user-data-dir="$PROFILE" --no-first-run --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --app="$URL")
for APP in "Google Chrome" "Microsoft Edge" "Brave Browser"; do
  if open -Ra "$APP" 2>/dev/null; then
    open -na "$APP" --args "${FLAGS[@]}"
    exit 0
  fi
done
echo "Chrome or Edge not found - opening in your default browser."
open "$DIR/index.html"
