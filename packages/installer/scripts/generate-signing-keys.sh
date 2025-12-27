#!/bin/bash
# Generate Tauri signing keys for auto-updates
#
# This script generates a keypair for signing installer updates.
# Run this ONCE, then:
# 1. Add the PRIVATE key as a GitHub secret named TAURI_SIGNING_PRIVATE_KEY
# 2. Add the password as a GitHub secret named TAURI_SIGNING_PRIVATE_KEY_PASSWORD
# 3. The PUBLIC key will be displayed - add it to tauri.conf.json
#
# Usage: ./generate-signing-keys.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_DIR="$SCRIPT_DIR/../.keys"

echo "=== Tauri Signing Key Generator ==="
echo ""

# Check if tauri CLI is available
if ! command -v cargo-tauri &> /dev/null && ! command -v tauri &> /dev/null; then
    echo "Installing Tauri CLI..."
    cargo install tauri-cli
fi

# Create keys directory
mkdir -p "$KEY_DIR"

# Generate the keys
echo "Generating signing keys..."
echo ""

# Use npx to run tauri signer
cd "$SCRIPT_DIR/.."
npx tauri signer generate -w "$KEY_DIR/signalk-installer.key"

echo ""
echo "=== Keys Generated Successfully ==="
echo ""
echo "Key files created in: $KEY_DIR"
echo ""
echo "IMPORTANT: Follow these steps:"
echo ""
echo "1. The PRIVATE KEY is in: $KEY_DIR/signalk-installer.key"
echo "   Add this as a GitHub secret named: TAURI_SIGNING_PRIVATE_KEY"
echo ""
echo "2. The PASSWORD you entered (if any) should be added as:"
echo "   GitHub secret named: TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
echo ""
echo "3. The PUBLIC KEY is in: $KEY_DIR/signalk-installer.key.pub"
echo "   Copy this value to tauri.conf.json under plugins.updater.pubkey"
echo ""
echo "4. DO NOT commit the .keys directory to git!"
echo "   It should already be in .gitignore"
echo ""

# Show the public key
echo "=== Public Key (copy this to tauri.conf.json) ==="
cat "$KEY_DIR/signalk-installer.key.pub"
echo ""
