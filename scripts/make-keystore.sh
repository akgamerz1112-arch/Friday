#!/data/data/com.termux/files/usr/bin/bash
# One-time: make the FIXED signing key so every new APK installs OVER the old app.
# Run in Termux:  bash scripts/make-keystore.sh
set -e
KS="$HOME/friday.keystore"
command -v keytool >/dev/null 2>&1 || pkg install -y openjdk-17
if [ -f "$KS" ]; then echo "Already exists: $KS (not overwritten)"; else
  keytool -genkeypair -keystore "$KS" -alias androiddebugkey -storepass android -keypass android \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
fi
base64 -w0 "$KS" > "$HOME/friday-keystore.b64"
if command -v termux-clipboard-set >/dev/null 2>&1; then
  termux-clipboard-set < "$HOME/friday-keystore.b64" && echo "Copied to clipboard."
else
  echo "Open and copy: $HOME/friday-keystore.b64  (cat ~/friday-keystore.b64)"
fi
echo "BACKUP $KS somewhere safe. If you lose it, you must uninstall the app once more."
echo "Now GitHub > repo > Settings > Secrets and variables > Actions > New secret:"
echo "  Name: ANDROID_KEYSTORE_BASE64   Value: (paste)"
