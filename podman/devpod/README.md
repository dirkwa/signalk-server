# SignalK Server Development with DevPod

This guide helps you set up a development environment for SignalK Server using DevPod and Podman. DevPod creates a containerized development environment with VS Code running in your browser.

## Prerequisites

- Debian/Ubuntu-based Linux system
- Terminal access

## Quick Start

### 1. Install DevPod

**For AMD64 (most PCs/laptops):**
```bash
curl -L -o devpod "https://github.com/loft-sh/devpod/releases/latest/download/devpod-linux-amd64" && \
sudo install -c -m 0755 devpod /usr/local/bin && \
rm -f devpod
```

**For ARM64 (Raspberry Pi, Apple Silicon, etc.):**
```bash
curl -L -o devpod "https://github.com/loft-sh/devpod/releases/latest/download/devpod-linux-arm64" && \
sudo install -c -m 0755 devpod /usr/local/bin && \
rm -f devpod
```

### 2. Install Podman

```bash
sudo apt update && sudo apt install -y podman podman-docker
```

The `podman-docker` package provides Docker compatibility (creates a `docker` command alias).

### 3. Configure Podman as Docker Provider

DevPod uses Docker by default, but Podman can emulate Docker. Run these commands to set it up:

```bash
# Enable the Podman socket (makes Podman accessible like Docker)
systemctl --user enable --now podman.socket

# Tell DevPod/Docker tools where to find Podman
export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock

# Make this permanent (so it works after reboot)
echo 'export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock' >> ~/.bashrc

# Configure Podman to not remap user IDs (keeps file ownership correct)
mkdir -p ~/.config/containers
cat >> ~/.config/containers/containers.conf << 'EOF'
[containers]
userns = "host"
EOF

# Add the Docker provider to DevPod
devpod provider add docker
```

### 4. Start the Development Environment

Navigate to your SignalK server repository and run:

```bash
devpod up . --ide openvscode
```

This will:
1. Build a container with Node.js 22 and all dependencies
2. Mount your local code into the container
3. Open VS Code in your browser

Access VS Code at: `http://localhost:10800`

If accessing from another machine, use: `http://<your-server-ip>:10800`

## Common Commands

### Start the dev environment
```bash
devpod up . --ide openvscode
```

### Stop the dev environment
```bash
devpod stop podman-signalk-server
```

### Restart with fresh container (after changing .devcontainer.json)
```bash
devpod up . --ide openvscode --recreate
```

### Check running containers
```bash
podman ps
```

### View container logs
```bash
podman logs signalk-server
```

### Enter the container manually
```bash
devpod ssh podman-signalk-server
```

## Working Inside the Dev Environment

Once VS Code opens in your browser:

1. Open a terminal: `Ctrl+`` ` (backtick) or Menu > Terminal > New Terminal
2. Install dependencies: `npm install`
3. Start SignalK: `npm start` or `./bin/signalk-server`
4. Access SignalK at: `http://localhost:3000`

Your local files are automatically synced - any changes you make in the container appear on your host machine and vice versa.

## Troubleshooting

### Container won't start
```bash
# Check for existing containers with the same name
podman ps -a | grep signalk

# Remove old container if needed
podman rm -f signalk-server

# Try again with --recreate
devpod up . --ide openvscode --recreate
```

### Permission issues with serial devices
Make sure your user is in the `dialout` group:
```bash
sudo usermod -aG dialout $USER
# Log out and back in for changes to take effect
```

### Podman socket not working
```bash
# Check if socket is running
systemctl --user status podman.socket

# Restart if needed
systemctl --user restart podman.socket
```

### Files owned by wrong user (UID 100000)
If files in your project become owned by UID 100000, Podman's user namespace remapping is interfering. Fix it:
```bash
# Fix ownership
sudo chown -R $USER:$USER /path/to/your/project

# Delete the devpod workspace
devpod delete podman-signalk-server

# Reset podman storage
podman system reset --force

# Configure podman to not remap UIDs
mkdir -p ~/.config/containers
cat >> ~/.config/containers/containers.conf << 'EOF'
[containers]
userns = "host"
EOF

# Restart podman socket
systemctl --user restart podman.socket

# Start fresh
devpod up . --ide openvscode
```

### Can't access VS Code from another machine
The browser IDE binds to localhost by default. Use SSH tunneling:
```bash
# From your remote machine (e.g., Windows)
ssh -L 10800:localhost:10800 user@server-ip
```
Then open `http://localhost:10800` in your browser.

## What's Included

The devcontainer is configured with:
- Ubuntu 24.04 (same as CI/production Docker images)
- Node.js 22
- Python and build-essential (for node-gyp builds)
- Full `/dev` access (serial ports, CAN bus, etc.)
- D-Bus socket (for Bluetooth/BLE support)
- Host networking (for mDNS/Avahi)
- Dark theme VS Code
