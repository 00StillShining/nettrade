#!/usr/bin/env bash
# Build the REAL Actuality .app, signed with the stable self-signed identity
# "Actuality Self-Signed" so the macOS Keychain "Always Allow" grant persists
# across rebuilds (ad-hoc "-" signing changed every build and re-prompted).
#
# Setup that this relies on (done once, see docs/SIGNING.md):
#   - a self-signed code-signing cert lives in ~/.actuality-signing/
#   - it's imported into ~/Library/Keychains/actuality-signing.keychain-db
#   - tauri.conf.json bundle.macOS.signingIdentity = "Actuality Self-Signed"
#
# Usage: scripts/build.sh            # app bundle only (fast)
#        scripts/build.sh --bundles app,dmg
set -euo pipefail
cd "$(dirname "$0")/.."

SIGN_KC="$HOME/Library/Keychains/actuality-signing.keychain-db"
KCPW="actuality-local-signing"   # dev-only; guards a throwaway self-signed cert

if [ -f "$SIGN_KC" ]; then
  # unlock the signing keychain so tauri's codesign step is non-interactive
  security unlock-keychain -p "$KCPW" "$SIGN_KC" >/dev/null 2>&1 || true
  # make sure it's on the search list (survives reboots that reset it)
  if ! security list-keychains -d user | grep -q "actuality-signing"; then
    EXIST=$(security list-keychains -d user | sed 's/[" ]//g' | grep -v actuality-signing)
    security list-keychains -d user -s "$SIGN_KC" $EXIST
  fi
else
  echo "warn: signing keychain missing — falling back to whatever signingIdentity resolves to"
fi

ARGS=("--bundles" "app")
if [ "$#" -gt 0 ]; then ARGS=("$@"); fi
exec npm run tauri -- build "${ARGS[@]}"
