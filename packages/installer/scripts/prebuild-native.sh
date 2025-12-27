#!/bin/bash
# Pre-build native modules for all platforms
# This script builds native modules (serialport) for each target platform
# Usage: ./prebuild-native.sh
#
# Note: Cross-compilation requires appropriate toolchains installed.
# For CI, each platform builds its own native modules.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/../bundled-native"
NODE_VERSION="22"

# Detect current platform
case "$(uname -s)" in
    Linux*)     CURRENT_OS="linux";;
    Darwin*)    CURRENT_OS="darwin";;
    MINGW*|MSYS*|CYGWIN*) CURRENT_OS="win32";;
    *)          CURRENT_OS="unknown";;
esac

case "$(uname -m)" in
    x86_64|amd64)  CURRENT_ARCH="x64";;
    aarch64|arm64) CURRENT_ARCH="arm64";;
    *)             CURRENT_ARCH="unknown";;
esac

CURRENT_PLATFORM="${CURRENT_OS}-${CURRENT_ARCH}"

echo "=== Native Module Pre-builder ==="
echo "Current platform: ${CURRENT_PLATFORM}"
echo "Output: ${OUTPUT_DIR}"
echo ""

# Create output directory
mkdir -p "${OUTPUT_DIR}/${CURRENT_PLATFORM}"

# Modules to prebuild
MODULES=(
    "serialport@11.0.0"
)

# Create a temporary directory for building
TEMP_DIR="/tmp/prebuild-native-$$"
mkdir -p "${TEMP_DIR}"
cd "${TEMP_DIR}"

# Initialize npm project
cat > package.json << EOF
{
  "name": "native-prebuild",
  "version": "1.0.0",
  "private": true
}
EOF

echo "Building native modules for ${CURRENT_PLATFORM}..."

for module in "${MODULES[@]}"; do
    echo ""
    echo "--- Building ${module} ---"

    # Install the module (this will compile native code)
    npm install "${module}" --save

    # Find the native addon
    module_name="${module%%@*}"

    # For serialport, the native bindings are in @serialport/bindings-cpp
    if [ "$module_name" = "serialport" ]; then
        native_dir="node_modules/@serialport/bindings-cpp"
        if [ -d "$native_dir/prebuilds" ]; then
            echo "  Copying prebuilds..."
            mkdir -p "${OUTPUT_DIR}/${CURRENT_PLATFORM}/@serialport/bindings-cpp"
            cp -r "$native_dir/prebuilds" "${OUTPUT_DIR}/${CURRENT_PLATFORM}/@serialport/bindings-cpp/"
        fi

        # Also copy the build directory if prebuilds don't exist
        if [ -d "$native_dir/build" ]; then
            echo "  Copying build artifacts..."
            mkdir -p "${OUTPUT_DIR}/${CURRENT_PLATFORM}/@serialport/bindings-cpp"
            cp -r "$native_dir/build" "${OUTPUT_DIR}/${CURRENT_PLATFORM}/@serialport/bindings-cpp/"
        fi
    fi
done

# Cleanup
cd /
rm -rf "${TEMP_DIR}"

echo ""
echo "=== Summary ==="
echo "Native modules built for ${CURRENT_PLATFORM}"
du -sh "${OUTPUT_DIR}/${CURRENT_PLATFORM}"

echo ""
echo "Native modules ready in ${OUTPUT_DIR}/${CURRENT_PLATFORM}"
