#!/bin/bash
# Package SignalK Server for bundling with the installer
# This script creates a self-contained signalk-server directory with all dependencies
# Usage: ./package-signalk.sh [version]
# Example: ./package-signalk.sh 2.19.0

set -e

SIGNALK_VERSION="${1:-latest}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/../bundled-signalk"
TEMP_DIR="/tmp/signalk-package-$$"

echo "=== SignalK Server Packager ==="
echo "Version: ${SIGNALK_VERSION}"
echo "Output: ${OUTPUT_DIR}"
echo ""

# Create temp and output directories
mkdir -p "${TEMP_DIR}"
mkdir -p "${OUTPUT_DIR}"

# Change to temp directory
cd "${TEMP_DIR}"

# Create a minimal package.json to install signalk-server
echo "Creating temporary package..."
cat > package.json << EOF
{
  "name": "signalk-bundle",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "signalk-server": "${SIGNALK_VERSION}"
  }
}
EOF

# Install signalk-server with all dependencies
echo "Installing signalk-server@${SIGNALK_VERSION}..."
npm install --omit=dev --ignore-scripts

# The signalk-server is now in node_modules/signalk-server
# Copy it to output
echo "Copying to output directory..."
rm -rf "${OUTPUT_DIR}/signalk-server"
cp -r node_modules/signalk-server "${OUTPUT_DIR}/"

# Also copy the node_modules that signalk-server needs
# We need to flatten the dependency tree for bundling
echo "Copying dependencies..."
mkdir -p "${OUTPUT_DIR}/signalk-server/node_modules"

# Copy all dependencies except signalk-server itself
for dep in node_modules/*; do
    dep_name=$(basename "$dep")
    if [ "$dep_name" != "signalk-server" ] && [ -d "$dep" ]; then
        cp -r "$dep" "${OUTPUT_DIR}/signalk-server/node_modules/"
    fi
done

# Clean up temp directory
cd /
rm -rf "${TEMP_DIR}"

# Calculate size
size=$(du -sh "${OUTPUT_DIR}/signalk-server" | cut -f1)

echo ""
echo "=== Summary ==="
echo "SignalK Server packaged: ${OUTPUT_DIR}/signalk-server"
echo "Size: ${size}"
echo ""

# List what's included
echo "Contents:"
ls -la "${OUTPUT_DIR}/signalk-server/"

echo ""
echo "SignalK Server ${SIGNALK_VERSION} ready for bundling"
