#!/bin/bash
#
# Signal K Server Installation Script
# https://get.signalk.io
#
# Usage:
#   Install:   curl -sSL https://get.signalk.io | bash
#   Uninstall: curl -sSL https://get.signalk.io | bash -s -- --uninstall
#
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SIGNALK_IMAGE="ghcr.io/signalk/signalk-server:latest"
SIGNALK_PORT=3000
SIGNALK_DATA_DIR="$HOME/.signalk"

# Print functions
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Detect OS
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_ID="$ID"
        OS_VERSION="$VERSION_ID"
        OS_NAME="$PRETTY_NAME"
    else
        error "Cannot detect OS. /etc/os-release not found."
    fi
    info "Detected: $OS_NAME"
}

# Check if running as root (we don't want that)
check_not_root() {
    if [ "$(id -u)" -eq 0 ]; then
        error "Do not run this script as root. Run as a regular user (sudo will be requested when needed)."
    fi
}

# Check if Podman is installed
check_podman() {
    if command -v podman &> /dev/null; then
        PODMAN_VERSION=$(podman --version | awk '{print $3}')
        success "Podman $PODMAN_VERSION is installed"
        return 0
    fi
    return 1
}

# Install Podman based on OS
install_podman() {
    info "Installing Podman..."

    case "$OS_ID" in
        debian|ubuntu|raspbian)
            sudo apt-get update
            sudo apt-get install -y podman
            ;;
        fedora)
            sudo dnf install -y podman
            ;;
        centos|rhel|rocky|almalinux)
            sudo dnf install -y podman
            ;;
        arch|manjaro)
            sudo pacman -S --noconfirm podman
            ;;
        opensuse*|sles)
            sudo zypper install -y podman
            ;;
        *)
            error "Unsupported OS: $OS_ID. Please install Podman manually and re-run this script."
            ;;
    esac

    success "Podman installed successfully"
}

# Add user to dialout group for serial port access
setup_serial_access() {
    if groups | grep -q dialout; then
        success "User already in dialout group"
    else
        info "Adding user to dialout group for serial port access..."
        sudo usermod -aG dialout "$USER"
        warn "You may need to log out and back in for serial port access to take effect"
    fi
}

# Scan for serial devices
scan_serial_devices() {
    info "Scanning for serial devices..."

    DEVICES=()

    # Scan common serial device paths
    for dev in /dev/ttyUSB* /dev/ttyACM* /dev/ttyAMA* /dev/serial/by-id/*; do
        if [ -e "$dev" ]; then
            DEVICES+=("$dev")
        fi
    done

    if [ ${#DEVICES[@]} -eq 0 ]; then
        warn "No serial devices found"
        return
    fi

    echo ""
    echo "Found serial devices:"
    for i in "${!DEVICES[@]}"; do
        echo "  [$i] ${DEVICES[$i]}"
    done
    echo ""

    read -p "Enter device numbers to use (comma-separated, e.g., 0,1) or 'all' or 'none': " selection

    SELECTED_DEVICES=()

    if [ "$selection" = "all" ]; then
        SELECTED_DEVICES=("${DEVICES[@]}")
    elif [ "$selection" != "none" ] && [ -n "$selection" ]; then
        IFS=',' read -ra indices <<< "$selection"
        for idx in "${indices[@]}"; do
            idx=$(echo "$idx" | tr -d ' ')
            if [ -n "${DEVICES[$idx]}" ]; then
                SELECTED_DEVICES+=("${DEVICES[$idx]}")
            fi
        done
    fi

    if [ ${#SELECTED_DEVICES[@]} -gt 0 ]; then
        success "Selected devices: ${SELECTED_DEVICES[*]}"
    else
        info "No devices selected"
    fi
}

# Pull the Signal K image
pull_image() {
    info "Pulling Signal K Server image..."
    podman pull "$SIGNALK_IMAGE"
    success "Image pulled successfully"
}

# Create data directory
create_data_dir() {
    if [ ! -d "$SIGNALK_DATA_DIR" ]; then
        info "Creating data directory: $SIGNALK_DATA_DIR"
        mkdir -p "$SIGNALK_DATA_DIR"
    fi
    success "Data directory ready: $SIGNALK_DATA_DIR"
}

# Enable lingering for user systemd services
enable_lingering() {
    if loginctl show-user "$USER" 2>/dev/null | grep -q "Linger=yes"; then
        success "Lingering already enabled"
    else
        info "Enabling lingering for user services to run without login..."
        sudo loginctl enable-linger "$USER"
        success "Lingering enabled"
    fi
}

# Generate Quadlet container file
generate_quadlet() {
    QUADLET_DIR="$HOME/.config/containers/systemd"
    QUADLET_FILE="$QUADLET_DIR/signalk.container"

    info "Generating Quadlet systemd service..."

    mkdir -p "$QUADLET_DIR"

    # Build device lines
    DEVICE_LINES=""
    for dev in "${SELECTED_DEVICES[@]}"; do
        DEVICE_LINES+="AddDevice=$dev\n"
    done

    cat > "$QUADLET_FILE" << EOF
# Signal K Server Container
# Generated by install-signalk.sh on $(date)
#
# Manage with:
#   systemctl --user start signalk
#   systemctl --user stop signalk
#   systemctl --user status signalk
#   journalctl --user -u signalk -f

[Container]
Image=$SIGNALK_IMAGE
PublishPort=$SIGNALK_PORT:3000
Volume=$SIGNALK_DATA_DIR:/home/node/.signalk:Z
Network=host

# D-Bus access (for Bluetooth/BLE support)
Volume=/run/dbus/system_bus_socket:/run/dbus/system_bus_socket

# SocketCAN support (requires NET_ADMIN for interface setup)
AddCapability=NET_ADMIN

# Map host UID to container UID (fixes permission issues for npm installs)
UserNS=keep-id:uid=1000,gid=1000

# Run as root initially to fix node capability, then drop to node user
User=root
Entrypoint=/bin/bash
Exec=-c "setcap -r /usr/bin/node 2>/dev/null; exec su node -c '/home/node/signalk/startup.sh'"

# Serial devices
$(echo -e "$DEVICE_LINES")
[Service]
Restart=always
TimeoutStartSec=300

[Install]
WantedBy=default.target
EOF

    success "Quadlet file created: $QUADLET_FILE"
}

# Reload and start the service
start_service() {
    info "Reloading systemd user daemon..."
    systemctl --user daemon-reload

    info "Starting Signal K Server..."
    systemctl --user start signalk

    # Wait a moment for startup
    sleep 3

    if systemctl --user is-active --quiet signalk; then
        success "Signal K Server is running"
    else
        warn "Service may still be starting. Check status with: systemctl --user status signalk"
    fi
}

# Verify service is enabled (Quadlet handles this via [Install] section)
verify_autostart() {
    # Quadlet services are auto-enabled via the [Install] WantedBy directive
    # No need to run systemctl enable - it's handled by the generator
    success "Service will start automatically on boot (via Quadlet)"
}

# Print final instructions
print_summary() {
    LOCAL_IP=$(hostname -I | awk '{print $1}')

    echo ""
    echo "=============================================="
    echo -e "${GREEN}Signal K Server Installation Complete!${NC}"
    echo "=============================================="
    echo ""
    echo "Access the server at:"
    echo "  http://localhost:$SIGNALK_PORT"
    [ -n "$LOCAL_IP" ] && echo "  http://$LOCAL_IP:$SIGNALK_PORT"
    echo ""
    echo "Useful commands:"
    echo "  systemctl --user status signalk    # Check status"
    echo "  systemctl --user restart signalk   # Restart server"
    echo "  systemctl --user stop signalk      # Stop server"
    echo "  journalctl --user -u signalk -f    # View logs"
    echo ""
    echo "Data directory: $SIGNALK_DATA_DIR"
    echo ""
    if [ ${#SELECTED_DEVICES[@]} -gt 0 ]; then
        echo "Serial devices configured:"
        for dev in "${SELECTED_DEVICES[@]}"; do
            echo "  $dev"
        done
        echo ""
    fi
    echo "To reconfigure devices, edit:"
    echo "  $HOME/.config/containers/systemd/signalk.container"
    echo "Then run: systemctl --user daemon-reload && systemctl --user restart signalk"
    echo ""
}

# Uninstall Signal K
uninstall() {
    echo ""
    echo "========================================="
    echo "  Signal K Server Uninstaller"
    echo "========================================="
    echo ""

    check_not_root

    QUADLET_FILE="$HOME/.config/containers/systemd/signalk.container"

    # Stop and remove service
    if systemctl --user is-active --quiet signalk 2>/dev/null; then
        info "Stopping Signal K Server..."
        systemctl --user stop signalk
        success "Service stopped"
    fi

    # Remove Quadlet file
    if [ -f "$QUADLET_FILE" ]; then
        info "Removing Quadlet service file..."
        rm -f "$QUADLET_FILE"
        systemctl --user daemon-reload
        success "Service file removed"
    else
        info "No Quadlet service file found"
    fi

    # Remove container if exists
    if podman container exists systemd-signalk 2>/dev/null; then
        info "Removing container..."
        podman rm -f systemd-signalk
        success "Container removed"
    fi

    # Ask about image removal (default: Yes)
    echo ""
    read -p "Remove Signal K container image? [Y/n]: " remove_image
    remove_image="${remove_image:-y}"
    if [ "$remove_image" = "y" ] || [ "$remove_image" = "Y" ]; then
        info "Removing container image..."
        podman rmi "$SIGNALK_IMAGE" 2>/dev/null || true
        success "Image removed"
    fi

    # Ask about data directory (default: No)
    echo ""
    warn "Data directory: $SIGNALK_DATA_DIR"
    read -p "Remove data directory? This will DELETE all your Signal K data! [y/N]: " remove_data
    if [ "$remove_data" = "y" ] || [ "$remove_data" = "Y" ]; then
        read -p "Are you SURE? Type 'yes' to confirm: " confirm
        if [ "$confirm" = "yes" ]; then
            info "Removing data directory..."
            rm -rf "$SIGNALK_DATA_DIR"
            success "Data directory removed"
        else
            info "Data directory preserved"
        fi
    else
        info "Data directory preserved at: $SIGNALK_DATA_DIR"
    fi

    echo ""
    echo "=============================================="
    echo -e "${GREEN}Signal K Server Uninstalled${NC}"
    echo "=============================================="
    echo ""
    echo "Podman was NOT removed (you may have other containers)."
    echo "To remove Podman: sudo apt remove podman"
    echo ""
}

# Main installation flow
install() {
    echo ""
    echo "========================================="
    echo "  Signal K Server Installer (Podman)"
    echo "========================================="
    echo ""

    check_not_root
    detect_os

    if ! check_podman; then
        install_podman
    fi

    setup_serial_access
    scan_serial_devices
    create_data_dir
    pull_image
    enable_lingering
    generate_quadlet
    start_service
    verify_autostart
    print_summary
}

# Parse arguments and run
case "${1:-}" in
    --uninstall|-u)
        uninstall
        ;;
    --help|-h)
        echo "Signal K Server Installer"
        echo ""
        echo "Usage:"
        echo "  $0              Install Signal K Server"
        echo "  $0 --uninstall  Uninstall Signal K Server"
        echo "  $0 --help       Show this help"
        ;;
    *)
        install
        ;;
esac
