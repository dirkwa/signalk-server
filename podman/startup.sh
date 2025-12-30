#!/bin/sh
# Signal K Server startup script for Podman container
# Runs as unprivileged user (node)

# Start D-Bus if socket is not mounted from host
if [ ! -S /run/dbus/system_bus_socket ]; then
    # Only try to start dbus if we have permissions (running as root in container)
    if [ "$(id -u)" = "0" ]; then
        mkdir -p /var/run/dbus
        dbus-daemon --system --fork 2>/dev/null || true
    fi
fi

# Start avahi for mDNS discovery (if available and we have permissions)
if command -v avahi-daemon >/dev/null 2>&1; then
    if [ "$(id -u)" = "0" ]; then
        avahi-daemon -k 2>/dev/null || true
        avahi-daemon --no-drop-root -D 2>/dev/null || true
    fi
fi

# Run Signal K Server
exec node /home/node/signalk-server/bin/signalk-server --securityenabled "$@"
