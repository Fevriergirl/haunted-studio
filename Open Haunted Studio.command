#!/usr/bin/env bash
# Double-click this file to open Haunted Studio (macOS / Linux).
#
# It starts the local studio and opens the page in your browser. Leave this
# window open while you use it; close it (or press Ctrl-C) to stop the studio.
#
# One-time setup first: install Node.js (https://nodejs.org), then in this
# folder run `npm install`. After that, this launcher is all you need.

cd "$(dirname "$0")" || exit 1

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js / npm is not installed. Install it from https://nodejs.org and try again."
  read -r -p "Press Return to close." _
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First-time setup: installing dependencies (this happens only once)..."
  npm install || { echo "Setup failed."; read -r -p "Press Return to close." _; exit 1; }
fi

echo "Opening Haunted Studio..."
npm run studio
