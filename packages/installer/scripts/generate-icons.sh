#!/bin/bash
# Generate app icons from source SVG/PNG for all platforms
# Requires: ImageMagick (convert), icnsutil or png2icns (macOS icons)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER_DIR="${SCRIPT_DIR}/.."
ICONS_DIR="${INSTALLER_DIR}/src-tauri/icons"
SOURCE_PNG="${INSTALLER_DIR}/../../public/signalk-logo-transparent.png"
SOURCE_SVG="${INSTALLER_DIR}/../../packages/server-admin-ui/public_src/img/signal-k-logo-image.svg"

echo "=== Generating App Icons ==="

# Create icons directory
mkdir -p "${ICONS_DIR}"

# Check for ImageMagick
if ! command -v convert &> /dev/null; then
    echo "ImageMagick not found. Attempting to install..."

    # Detect package manager and install ImageMagick
    if command -v apt-get &> /dev/null; then
        # Debian, Ubuntu, Raspberry Pi OS, Linux Mint, Pop!_OS
        sudo apt-get update && sudo apt-get install -y imagemagick
    elif command -v dnf &> /dev/null; then
        # Fedora, RHEL 8+, CentOS Stream, Rocky Linux, AlmaLinux
        sudo dnf install -y ImageMagick
    elif command -v yum &> /dev/null; then
        # CentOS 7, older RHEL
        sudo yum install -y ImageMagick
    elif command -v pacman &> /dev/null; then
        # Arch Linux, Manjaro, EndeavourOS
        sudo pacman -S --noconfirm imagemagick
    elif command -v emerge &> /dev/null; then
        # Gentoo
        sudo emerge --ask=n media-gfx/imagemagick
    elif command -v zypper &> /dev/null; then
        # openSUSE, SLES
        sudo zypper install -y ImageMagick
    elif command -v apk &> /dev/null; then
        # Alpine Linux
        sudo apk add imagemagick
    elif command -v xbps-install &> /dev/null; then
        # Void Linux
        sudo xbps-install -y ImageMagick
    elif command -v brew &> /dev/null; then
        # macOS (Homebrew)
        brew install imagemagick
    elif command -v port &> /dev/null; then
        # macOS (MacPorts)
        sudo port install ImageMagick
    elif command -v choco &> /dev/null; then
        # Windows (Chocolatey)
        choco install imagemagick -y
    elif command -v scoop &> /dev/null; then
        # Windows (Scoop)
        scoop install imagemagick
    elif command -v winget &> /dev/null; then
        # Windows (winget)
        winget install ImageMagick.ImageMagick
    elif command -v nix-env &> /dev/null; then
        # NixOS / Nix package manager
        nix-env -iA nixpkgs.imagemagick
    else
        echo "Error: Could not detect package manager."
        echo "Please install ImageMagick manually:"
        echo "  - Debian/Ubuntu: sudo apt install imagemagick"
        echo "  - Fedora/RHEL:   sudo dnf install ImageMagick"
        echo "  - Arch Linux:    sudo pacman -S imagemagick"
        echo "  - Gentoo:        sudo emerge media-gfx/imagemagick"
        echo "  - openSUSE:      sudo zypper install ImageMagick"
        echo "  - Alpine:        sudo apk add imagemagick"
        echo "  - macOS:         brew install imagemagick"
        echo "  - Windows:       choco install imagemagick"
        exit 1
    fi

    # Verify installation succeeded
    if ! command -v convert &> /dev/null; then
        echo "Error: ImageMagick installation failed. Please install manually."
        exit 1
    fi
fi

# Check source file exists
if [ ! -f "${SOURCE_PNG}" ]; then
    echo "Error: Source PNG not found at ${SOURCE_PNG}"
    exit 1
fi

echo "Using source: ${SOURCE_PNG}"

# Generate PNG icons with square canvas and proper padding
# 32x32 icon
echo "Generating 32x32.png..."
convert "${SOURCE_PNG}" \
    -resize 28x28 \
    -gravity center \
    -background transparent \
    -extent 32x32 \
    "${ICONS_DIR}/32x32.png"

# 128x128 icon
echo "Generating 128x128.png..."
convert "${SOURCE_PNG}" \
    -resize 112x112 \
    -gravity center \
    -background transparent \
    -extent 128x128 \
    "${ICONS_DIR}/128x128.png"

# 128x128@2x icon (256x256)
echo "Generating 128x128@2x.png..."
convert "${SOURCE_PNG}" \
    -resize 224x224 \
    -gravity center \
    -background transparent \
    -extent 256x256 \
    "${ICONS_DIR}/128x128@2x.png"

# Generate Windows .ico file (multiple sizes embedded)
echo "Generating icon.ico..."
convert "${SOURCE_PNG}" \
    \( -clone 0 -resize 16x16 \) \
    \( -clone 0 -resize 24x24 \) \
    \( -clone 0 -resize 32x32 \) \
    \( -clone 0 -resize 48x48 \) \
    \( -clone 0 -resize 64x64 \) \
    \( -clone 0 -resize 128x128 \) \
    \( -clone 0 -resize 256x256 \) \
    -delete 0 \
    "${ICONS_DIR}/icon.ico"

# Generate macOS .icns file
echo "Generating icon.icns..."

# Create iconset directory structure for macOS
ICONSET_DIR="${ICONS_DIR}/icon.iconset"
mkdir -p "${ICONSET_DIR}"

convert "${SOURCE_PNG}" -resize 16x16     "${ICONSET_DIR}/icon_16x16.png"
convert "${SOURCE_PNG}" -resize 32x32     "${ICONSET_DIR}/icon_16x16@2x.png"
convert "${SOURCE_PNG}" -resize 32x32     "${ICONSET_DIR}/icon_32x32.png"
convert "${SOURCE_PNG}" -resize 64x64     "${ICONSET_DIR}/icon_32x32@2x.png"
convert "${SOURCE_PNG}" -resize 128x128   "${ICONSET_DIR}/icon_128x128.png"
convert "${SOURCE_PNG}" -resize 256x256   "${ICONSET_DIR}/icon_128x128@2x.png"
convert "${SOURCE_PNG}" -resize 256x256   "${ICONSET_DIR}/icon_256x256.png"
convert "${SOURCE_PNG}" -resize 512x512   "${ICONSET_DIR}/icon_256x256@2x.png"
convert "${SOURCE_PNG}" -resize 512x512   "${ICONSET_DIR}/icon_512x512.png"
convert "${SOURCE_PNG}" -resize 720x720   "${ICONSET_DIR}/icon_512x512@2x.png"

# Convert iconset to icns (macOS only, or use png2icns on Linux)
if command -v iconutil &> /dev/null; then
    iconutil -c icns "${ICONSET_DIR}" -o "${ICONS_DIR}/icon.icns"
elif command -v png2icns &> /dev/null; then
    png2icns "${ICONS_DIR}/icon.icns" "${ICONSET_DIR}"/*.png
else
    echo "Warning: iconutil/png2icns not available, creating placeholder .icns"
    # On non-macOS, just copy the largest PNG as a placeholder
    # The actual .icns will be generated on the macOS CI runner
    cp "${ICONSET_DIR}/icon_512x512@2x.png" "${ICONS_DIR}/icon.icns.png"
    # Create a simple icns by using ImageMagick (won't be valid but works as placeholder)
    convert "${SOURCE_PNG}" -resize 512x512 "${ICONS_DIR}/icon.icns" 2>/dev/null || \
        cp "${ICONSET_DIR}/icon_512x512.png" "${ICONS_DIR}/icon.icns"
fi

# Cleanup iconset directory
rm -rf "${ICONSET_DIR}"

echo ""
echo "=== Icons Generated ==="
ls -la "${ICONS_DIR}"
