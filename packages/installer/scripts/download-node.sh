#!/bin/bash
# Download Node.js binaries for all supported platforms
# Usage: ./download-node.sh [version]
# Example: ./download-node.sh 22.12.0

set -e

NODE_VERSION="${1:-22.12.0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/../bundled-node"

# Node.js download base URL
NODE_BASE_URL="https://nodejs.org/dist/v${NODE_VERSION}"

# Platform configurations: name, node archive name, binary path in archive
declare -A PLATFORMS=(
    ["linux-x64"]="node-v${NODE_VERSION}-linux-x64.tar.xz:bin/node"
    ["linux-arm64"]="node-v${NODE_VERSION}-linux-arm64.tar.xz:bin/node"
    ["darwin-x64"]="node-v${NODE_VERSION}-darwin-x64.tar.gz:bin/node"
    ["darwin-arm64"]="node-v${NODE_VERSION}-darwin-arm64.tar.gz:bin/node"
    ["win32-x64"]="node-v${NODE_VERSION}-win-x64.zip:node.exe"
)

echo "=== Node.js Binary Downloader ==="
echo "Version: ${NODE_VERSION}"
echo "Output: ${OUTPUT_DIR}"
echo ""

# Create output directory
mkdir -p "${OUTPUT_DIR}"

# Download and extract for each platform
for platform in "${!PLATFORMS[@]}"; do
    IFS=':' read -r archive binary_path <<< "${PLATFORMS[$platform]}"

    platform_dir="${OUTPUT_DIR}/${platform}"
    archive_url="${NODE_BASE_URL}/${archive}"

    echo "--- Processing ${platform} ---"

    # Skip if already downloaded
    if [ -f "${platform_dir}/node" ] || [ -f "${platform_dir}/node.exe" ]; then
        echo "  Already exists, skipping..."
        continue
    fi

    mkdir -p "${platform_dir}"

    # Download archive
    echo "  Downloading ${archive}..."
    temp_file="/tmp/${archive}"

    if ! curl -fsSL "${archive_url}" -o "${temp_file}"; then
        echo "  ERROR: Failed to download ${archive_url}"
        continue
    fi

    # Extract based on file type
    echo "  Extracting..."
    case "${archive}" in
        *.tar.xz)
            tar -xJf "${temp_file}" -C "/tmp"
            archive_dir="/tmp/${archive%.tar.xz}"
            ;;
        *.tar.gz)
            tar -xzf "${temp_file}" -C "/tmp"
            archive_dir="/tmp/${archive%.tar.gz}"
            ;;
        *.zip)
            unzip -q "${temp_file}" -d "/tmp"
            archive_dir="/tmp/${archive%.zip}"
            ;;
    esac

    # Copy the node binary
    echo "  Copying binary..."
    if [[ "${platform}" == win32-* ]]; then
        cp "${archive_dir}/${binary_path}" "${platform_dir}/node.exe"
    else
        cp "${archive_dir}/${binary_path}" "${platform_dir}/node"
        chmod +x "${platform_dir}/node"
    fi

    # Cleanup
    rm -rf "${temp_file}" "${archive_dir}"

    echo "  Done: ${platform_dir}"
done

echo ""
echo "=== Summary ==="
for platform in "${!PLATFORMS[@]}"; do
    platform_dir="${OUTPUT_DIR}/${platform}"
    if [ -f "${platform_dir}/node" ] || [ -f "${platform_dir}/node.exe" ]; then
        size=$(du -sh "${platform_dir}" | cut -f1)
        echo "  ${platform}: ${size}"
    else
        echo "  ${platform}: MISSING"
    fi
done

echo ""
echo "Node.js ${NODE_VERSION} binaries ready in ${OUTPUT_DIR}"
