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
5. Detects USB serial devices (e.g., Actisense NGT-1) and configures passthrough
6. Creates scheduled task for automatic USB re-attach on login
7. Pulls the Signal K Server container image
8. Creates start/stop scripts in `~\.signalk\`
9. Creates scheduled task for auto-start on login
10. Starts Signal K Server with systemd supervision (enables restart button)

### Managing the server

```powershell
podman logs -f signalk                                        # View logs
podman machine ssh "systemctl --user stop signalk-supervisor" # Stop server
podman machine ssh "systemctl --user start signalk-supervisor" # Start server
podman machine stop                                           # Stop Podman VM (saves resources)
```

**Auto-restart:** The installer creates a systemd supervisor service inside Podman Machine. This means the "Restart" button in Signal K's web interface works as expected - the server will automatically restart after a few seconds.

**Note:** Using `podman stop signalk` alone won't work because the supervisor service will immediately restart the container. Use the `systemctl` commands above to properly stop/start the server.

### Serial ports on Windows

The installer will detect USB serial devices and offer to configure them automatically using `usbipd-win`.

**Device paths:** After USB setup, the installer shows the Linux device path (e.g., `/dev/ttyUSB0`). Use this path when configuring Signal K connections. You can also find it with:
```powershell
podman machine ssh "ls /dev/ttyUSB* /dev/ttyACM*"
```

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

### Uninstall (Windows)

```powershell
# Stop and remove the container
podman stop signalk
podman rm signalk

# Remove the scheduled task (if USB devices were configured)
Unregister-ScheduledTask -TaskName "SignalK-USB-Attach" -Confirm:$false

# Optional: Remove Podman Machine and image
podman machine stop
podman machine rm podman-machine-default
podman rmi ghcr.io/signalk/signalk-server:latest
```

Your data in `%USERPROFILE%\.signalk\` is preserved unless you delete it manually.

## Hardware Access

### Linux: D-Bus and SocketCAN

On Linux, the container has access to:

- **D-Bus** (`/run/dbus/system_bus_socket`) - Enables Bluetooth/BLE device support for sensors like Ruuvi tags
- **SocketCAN** (`NET_ADMIN` capability) - Allows configuration and use of CAN bus interfaces (e.g., for NMEA 2000 via can-utils)
- **Host networking** - Direct access to all network interfaces

These are configured automatically by the installer.

### Windows/macOS: Bluetooth

Bluetooth passthrough to containers is not reliably supported on Windows or macOS. For BLE sensor support (e.g., Ruuvi tags), we recommend using a dedicated USB Bluetooth dongle that can be passed through to the container, or running a separate BLE gateway that forwards data via MQTT or HTTP.

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

### Windows: USB device not detected during install

Make sure your device is plugged in before running the installer. If it still doesn't appear:

1. Check Windows Device Manager for the COM port
2. Run manually:
   ```powershell
   usbipd list
   ```
3. Follow the "Manual USB setup" section above

### Windows: USB device not working after restart

Check if the scheduled task ran:
```powershell
Get-ScheduledTask -TaskName "SignalK-USB-Attach" | Select-Object State, LastRunTime
```

Manually attach the device:
```powershell
usbipd attach --wsl --busid <BUSID>
```

Then restart Signal K:
```powershell
~\.signalk\start-signalk.ps1
```
