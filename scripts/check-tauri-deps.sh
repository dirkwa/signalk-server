#!/bin/bash
# Check if Tauri development dependencies are installed
# This script helps users identify missing system packages

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Checking Tauri development dependencies..."
echo ""

MISSING_DEPS=()

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
    OS="windows"
else
    echo -e "${YELLOW}Unknown OS: $OSTYPE${NC}"
    OS="unknown"
fi

check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 found"
        return 0
    else
        echo -e "${RED}✗${NC} $1 not found"
        return 1
    fi
}

check_pkg_config() {
    if pkg-config --exists "$1" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} $1 found ($(pkg-config --modversion "$1" 2>/dev/null || echo 'version unknown'))"
        return 0
    else
        echo -e "${RED}✗${NC} $1 not found"
        return 1
    fi
}

echo "=== Required Tools ==="
check_command "rustc" || MISSING_DEPS+=("rust")
check_command "cargo" || MISSING_DEPS+=("rust")
check_command "node" || MISSING_DEPS+=("nodejs")
check_command "npm" || MISSING_DEPS+=("nodejs")

if [[ "$OS" == "linux" ]]; then
    echo ""
    echo "=== Linux System Libraries ==="
    check_command "pkg-config" || MISSING_DEPS+=("pkg-config")

    if command -v pkg-config &> /dev/null; then
        check_pkg_config "glib-2.0" || MISSING_DEPS+=("libglib2.0-dev")
        check_pkg_config "gtk+-3.0" || MISSING_DEPS+=("libgtk-3-dev")
        check_pkg_config "webkit2gtk-4.1" || MISSING_DEPS+=("libwebkit2gtk-4.1-dev")
        check_pkg_config "ayatana-appindicator3-0.1" || check_pkg_config "appindicator3-0.1" || MISSING_DEPS+=("libayatana-appindicator3-dev or libappindicator3-dev")
        check_pkg_config "librsvg-2.0" || MISSING_DEPS+=("librsvg2-dev")
        check_pkg_config "libudev" || MISSING_DEPS+=("libudev-dev")
    fi

    check_command "patchelf" || MISSING_DEPS+=("patchelf")

    # Check for display (warn if missing, but don't fail)
    if [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; then
        echo ""
        echo -e "${YELLOW}Warning: No display detected (DISPLAY/WAYLAND_DISPLAY not set)${NC}"
        echo -e "${YELLOW}You may need to use: xvfb-run npm run tauri:dev${NC}"
        check_command "xvfb-run" || echo -e "${YELLOW}  Install xvfb: sudo apt-get install xvfb${NC}"
    fi
fi

if [[ "$OS" == "macos" ]]; then
    echo ""
    echo "=== macOS Tools ==="
    check_command "xcode-select" || MISSING_DEPS+=("xcode-command-line-tools")
fi

echo ""

if [ ${#MISSING_DEPS[@]} -eq 0 ]; then
    echo -e "${GREEN}All dependencies are installed!${NC}"
    exit 0
else
    echo -e "${RED}Missing dependencies detected!${NC}"
    echo ""

    if [[ "$OS" == "linux" ]]; then
        # Detect package manager
        if command -v apt-get &> /dev/null; then
            echo "Install missing dependencies with:"
            echo ""
            echo -e "${YELLOW}sudo apt-get update"
            echo -e "sudo apt-get install -y build-essential pkg-config libglib2.0-dev libgtk-3-dev \\"
            echo -e "    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \\"
            echo -e "    libudev-dev patchelf xvfb${NC}"
        elif command -v dnf &> /dev/null; then
            echo "Install missing dependencies with:"
            echo ""
            echo -e "${YELLOW}sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \\"
            echo -e "    librsvg2-devel systemd-devel patchelf xorg-x11-server-Xvfb${NC}"
        elif command -v pacman &> /dev/null; then
            echo "Install missing dependencies with:"
            echo ""
            echo -e "${YELLOW}sudo pacman -S --noconfirm webkit2gtk-4.1 gtk3 libappindicator-gtk3 \\"
            echo -e "    librsvg libsoup3 patchelf xorg-server-xvfb${NC}"
        elif command -v zypper &> /dev/null; then
            echo "Install missing dependencies with:"
            echo ""
            echo -e "${YELLOW}sudo zypper install -y webkit2gtk3-devel gtk3-devel libappindicator3-devel \\"
            echo -e "    librsvg-devel libudev-devel patchelf${NC}"
        elif command -v emerge &> /dev/null; then
            echo "Install missing dependencies with:"
            echo ""
            echo -e "${YELLOW}sudo emerge --ask net-libs/webkit-gtk:4.1 x11-libs/gtk+:3 \\"
            echo -e "    dev-libs/libayatana-appindicator gnome-base/librsvg sys-apps/systemd${NC}"
        elif command -v apk &> /dev/null; then
            echo "Install missing dependencies with:"
            echo ""
            echo -e "${YELLOW}sudo apk add gtk+3.0-dev webkit2gtk-4.1-dev libayatana-appindicator-dev \\"
            echo -e "    librsvg-dev eudev-dev patchelf${NC}"
        elif command -v xbps-install &> /dev/null; then
            echo "Install missing dependencies with:"
            echo ""
            echo -e "${YELLOW}sudo xbps-install -y webkit2gtk-devel gtk+3-devel libappindicator-devel \\"
            echo -e "    librsvg-devel eudev-libudev-devel patchelf${NC}"
        elif command -v nix-env &> /dev/null; then
            echo "For NixOS, add these to your configuration.nix or use nix-shell:"
            echo ""
            echo -e "${YELLOW}nix-shell -p pkg-config gtk3 webkitgtk_4_1 libayatana-appindicator librsvg${NC}"
            echo ""
            echo "Or add to environment.systemPackages in configuration.nix"
        else
            echo "Please install the following packages using your package manager:"
            echo "  - WebKit2GTK 4.1"
            echo "  - GTK 3"
            echo "  - libappindicator or libayatana-appindicator"
            echo "  - librsvg"
            echo "  - libudev"
            echo "  - patchelf"
        fi
        echo ""
        echo "See https://tauri.app/start/prerequisites/ for more details."
    elif [[ "$OS" == "macos" ]]; then
        echo "Install Xcode Command Line Tools:"
        echo ""
        echo -e "${YELLOW}xcode-select --install${NC}"
        echo ""
        echo "See https://tauri.app/start/prerequisites/ for more details."
    elif [[ "$OS" == "windows" ]]; then
        echo "On Windows, you need:"
        echo "  - Microsoft Visual Studio C++ Build Tools"
        echo "  - WebView2 (usually pre-installed on Windows 10/11)"
        echo ""
        echo "See https://tauri.app/start/prerequisites/ for more details."
    fi

    exit 1
fi
