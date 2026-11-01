#!/bin/sh
# Termux: put a trained "Hey Friday" openWakeWord model into the app.
# Run from ~/Friday/Friday :   sh scripts/add-friday-model.sh [path/to/model.onnx]
# No path given = the newest *.onnx in ~/storage/downloads (run termux-setup-storage once).
set -e
DEST="jarvis-studio-gui/src-tauri/tauri-plugin-phone/android/src/main/assets/hey_friday.onnx"
SRC="$1"
if [ -z "$SRC" ]; then
  SRC=$(ls -t "$HOME"/storage/downloads/*.onnx 2>/dev/null | head -n 1)
fi
[ -n "$SRC" ] && [ -f "$SRC" ] || { echo "Koi .onnx file nahi mili. Path do ya Downloads me rakho."; exit 1; }
SIZE=$(wc -c < "$SRC")
echo "File: $SRC ($SIZE bytes)"
# openWakeWord wake models are small (hey_jarvis.onnx is ~1.2 MB). Anything far off is the wrong file.
if [ "$SIZE" -lt 20000 ] || [ "$SIZE" -gt 5000000 ]; then
  echo "Size ajeeb hai (20 KB - 5 MB expected). Galat file ho sakti hai. Ruk gaya."; exit 1
fi
[ -d "$(dirname "$DEST")" ] || { echo "Ye script ~/Friday/Friday se chalao."; exit 1; }
cp "$SRC" "$DEST"
echo "Copied -> $DEST"
echo "Ab: git add -A && git commit -m 'Add Hey Friday wake model' && git push"
echo "Phir Actions > CI, phir Build APK. Install ke baad Settings > System me 'Wake word' row 'Hey Friday' dikhni chahiye."
