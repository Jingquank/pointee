#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

rm -rf dist
mkdir -p dist/chrome

SRC_FILES="manifest.json background.js rail.js shot.js content.js shader-agent.js tokens.css content.css"
SRC_DIRS="icons lib settings fonts"

for f in $SRC_FILES; do cp "$f" dist/chrome/; done
for d in $SRC_DIRS; do cp -r "$d" dist/chrome/; done
rm -f dist/chrome/icons/generate-icons.mjs

(cd dist/chrome && zip -qr ../pointee-chrome.zip . -x ".*")
echo "Chrome build: dist/pointee-chrome.zip"

echo "Done!"
