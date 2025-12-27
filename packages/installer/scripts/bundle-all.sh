#!/bin/bash
# Bundle all components for the installer
# This is the main script called during CI build
# Usage: ./bundle-all.sh [node-version] [signalk-version]

set -e

NODE_VERSION="${1:-22.12.0}"
SIGNALK_VERSION="${2:-latest}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================="
echo "SignalK Installer Bundle Script"
echo "=========================================="
echo "Node.js version: ${NODE_VERSION}"
echo "SignalK version: ${SIGNALK_VERSION}"
echo ""

# Detect current platform for native module building
case "$(uname -s)" in
    Linux*)     CURRENT_OS="linux";;
    Darwin*)    CURRENT_OS="darwin";;
    MINGW*|MSYS*|CYGWIN*) CURRENT_OS="win32";;
esac

case "$(uname -m)" in
    x86_64|amd64)  CURRENT_ARCH="x64";;
    aarch64|arm64) CURRENT_ARCH="arm64";;
esac

CURRENT_PLATFORM="${CURRENT_OS}-${CURRENT_ARCH}"
echo "Building for platform: ${CURRENT_PLATFORM}"
echo ""

# Step 1: Download Node.js binary for current platform only (in CI, each runner handles its platform)
echo "=== Step 1: Download Node.js ==="
"${SCRIPT_DIR}/download-node.sh" "${NODE_VERSION}"

# Step 2: Package SignalK Server
echo ""
echo "=== Step 2: Package SignalK Server ==="
"${SCRIPT_DIR}/package-signalk.sh" "${SIGNALK_VERSION}"

# Step 3: Build native modules
echo ""
echo "=== Step 3: Build Native Modules ==="
"${SCRIPT_DIR}/prebuild-native.sh"

# Step 4: Prepare the resources directory for Tauri
echo ""
echo "=== Step 4: Prepare Tauri Resources ==="

RESOURCES_DIR="${SCRIPT_DIR}/../src-tauri/resources"
mkdir -p "${RESOURCES_DIR}"

# Copy Node.js binary for current platform
if [ -d "${SCRIPT_DIR}/../bundled-node/${CURRENT_PLATFORM}" ]; then
    cp -r "${SCRIPT_DIR}/../bundled-node/${CURRENT_PLATFORM}"/* "${RESOURCES_DIR}/"
    echo "Copied Node.js binary"
fi

# Copy SignalK server
if [ -d "${SCRIPT_DIR}/../bundled-signalk/signalk-server" ]; then
    cp -r "${SCRIPT_DIR}/../bundled-signalk/signalk-server" "${RESOURCES_DIR}/"
    echo "Copied SignalK Server"
fi

# Copy native modules
if [ -d "${SCRIPT_DIR}/../bundled-native/${CURRENT_PLATFORM}" ]; then
    # Merge native modules into signalk-server's node_modules
    cp -r "${SCRIPT_DIR}/../bundled-native/${CURRENT_PLATFORM}"/* "${RESOURCES_DIR}/signalk-server/node_modules/" 2>/dev/null || true
    echo "Copied native modules"
fi

echo ""
echo "=== Bundle Complete ==="
echo "Resources ready in: ${RESOURCES_DIR}"
du -sh "${RESOURCES_DIR}"
ls -la "${RESOURCES_DIR}"
