# Signal K Server - Podman Installation

One-command installation for Signal K Server using rootless Podman with systemd integration.

## Linux Installation

```bash
curl -sSL https://get.signalk.io | bash
```

Or run locally:
```bash
./install-signalk.sh
```

### What it does

1. Detects your OS and installs Podman if needed
2. Adds your user to the `dialout` group (serial port access)
3. Scans for serial devices and lets you select which to use
4. Pulls the Signal K Server container image
5. Creates a systemd user service (Quadlet) that starts on boot
6. Starts Signal K Server

### Managing the service

```bash
systemctl --user status signalk     # Check status
systemctl --user restart signalk    # Restart server
systemctl --user stop signalk       # Stop server
journalctl --user -u signalk -f     # View logs
```

### Reconfiguring serial devices

Edit the Quadlet file:
```bash
nano ~/.config/containers/systemd/signalk.container
```

Add or remove `AddDevice=` lines, then reload:
```bash
systemctl --user daemon-reload && systemctl --user restart signalk
```

### Uninstall

```bash
./install-signalk.sh --uninstall
```

Or via curl:
```bash
curl -sSL https://get.signalk.io | bash -s -- --uninstall
```

## Windows Installation

### Prerequisites

- Windows 10/11 with WSL2 support
- At least 6GB RAM

### Running the installer

1. Open PowerShell (as regular user, NOT Administrator)
2. If the script is blocked, unblock it first:
   ```powershell
   Unblock-File -Path .\install-signalk.ps1
   ```
3. Run the installer:
   ```powershell
   .\install-signalk.ps1
   ```

Or bypass execution policy for a single run:
```powershell
powershell -ExecutionPolicy Bypass -File .\install-signalk.ps1
```

### What it does

1. Checks for 6GB RAM minimum
2. Installs WSL2 (kernel only, no full Linux distro)
3. Installs Podman via winget
4. Initializes Podman Machine (uses WSL2 backend)
5. Pulls the Signal K Server container image
6. Creates start/stop scripts in `~\.signalk\`
7. Starts Signal K Server

### Managing the server

```powershell
podman logs -f signalk      # View logs
podman stop signalk         # Stop server
podman start signalk        # Start server
podman machine stop         # Stop Podman VM (saves resources)
```

### Serial ports on Windows

The installer will detect USB serial devices and offer to configure them automatically using `usbipd-win`.

**Automatic re-attach:** The installer creates a scheduled task (`SignalK-USB-Attach`) that automatically re-attaches your USB devices when you log in to Windows. No manual action required!

To check the scheduled task:
```powershell
Get-ScheduledTask -TaskName "SignalK-USB-Attach"
```

**Manual re-attach** (if automatic fails):
```powershell
usbipd attach --wsl --busid <BUSID>
```

The BUSID for your devices is shown at the end of installation and can also be found with:
```powershell
usbipd list
```

#### Manual USB setup

If you skipped USB setup during installation or want to add more devices:

1. Install usbipd-win:
   ```powershell
   winget install usbipd
   ```

2. List USB devices to find the BUSID:
   ```powershell
   usbipd list
   ```

3. Bind the device (requires Admin, only needed once):
   ```powershell
   usbipd bind --busid <BUSID>
   ```

4. Attach to WSL (needed after each Windows restart):
   ```powershell
   usbipd attach --wsl --busid <BUSID>
   ```

5. Find the device path in WSL:
   ```powershell
   podman machine ssh "ls /dev/ttyUSB* /dev/ttyACM*"
   ```

6. Restart Signal K with the device:
   ```powershell
   podman stop signalk
   podman rm signalk
   # Then run start-signalk.ps1 or manually with --device /dev/ttyUSB0
   ```

## Data Directory

Your Signal K configuration and plugins are stored in:

- **Linux:** `~/.signalk/`
- **Windows:** `%USERPROFILE%\.signalk\`

This directory persists across container restarts and upgrades.

## Troubleshooting

### Linux: Service fails to start

Check logs:
```bash
journalctl --user -u signalk --no-pager -n 50
```

### Linux: Permission denied errors in appstore

The container needs correct UID mapping. Check that your Quadlet file contains:
```ini
UserNS=keep-id:uid=1000,gid=1000
```

### Windows: Permission issues with Signal K configuration

On Windows, the container runs as root to avoid volume mount permission issues with Podman Machine/WSL2. This is different from Linux where UID mapping is used.

### Windows: Script won't run

Unblock the downloaded file:
```powershell
Unblock-File -Path .\install-signalk.ps1
```

### Windows: WSL2 not available

Run as Administrator:
```powershell
wsl --install --no-distribution
```
Then restart your computer.
