# SignalK Installer

The SignalK Installer is a cross-platform GUI application that provides the easiest way to install and set up Signal K Server on your computer. It bundles everything you need - Node.js, native modules, and the server itself - so you don't need to install any prerequisites.

## Download

Download the installer for your platform from the [SignalK Releases page](https://github.com/SignalK/signalk-server/releases):

| Platform | File |
|----------|------|
| Windows | `SignalK Installer_x.x.x_x64-setup.exe` or `.msi` |
| macOS (Intel) | `SignalK Installer_x.x.x_x64.dmg` |
| macOS (Apple Silicon) | `SignalK Installer_x.x.x_aarch64.dmg` |
| Linux (x64) | `SignalK Installer_x.x.x_amd64.deb` or `.AppImage` |
| Linux (ARM64/Pi) | `SignalK Installer_x.x.x_arm64.deb` |

## Installation Steps

### Windows

1. Download the `.exe` or `.msi` installer
2. Run the installer (you may need to click "More info" → "Run anyway" if Windows SmartScreen appears)
3. Follow the setup wizard

### macOS

1. Download the `.dmg` file for your Mac (Intel or Apple Silicon)
2. Open the DMG and drag SignalK Installer to Applications
3. Right-click and select "Open" the first time (to bypass Gatekeeper)
4. Follow the setup wizard

### Linux

**Debian/Ubuntu (recommended):**
```bash
sudo dpkg -i signalk-installer_*_amd64.deb
# or for ARM64/Raspberry Pi:
sudo dpkg -i signalk-installer_*_arm64.deb
```

**AppImage (any distro):**
```bash
chmod +x SignalK_Installer_*.AppImage
./SignalK_Installer_*.AppImage
```

## Setup Wizard

When you run the installer, it will guide you through:

1. **Vessel Configuration** - Enter your boat's name and MMSI (optional)
2. **Network Settings** - Configure HTTP port (default: 3000) and SSL
3. **Admin Account** - Create an admin username and password
4. **Serial Ports** - Select which serial ports to configure for NMEA data
5. **Auto-Start** - Optionally configure Signal K to start automatically at boot

## What Gets Installed

The installer creates a self-contained Signal K installation:

| Platform | Installation Location |
|----------|----------------------|
| Linux | `~/.local/signalk/` |
| macOS | `~/Library/SignalK/` |
| Windows | `%LOCALAPPDATA%\SignalK\` |

Your configuration is stored in `~/.signalk/` (all platforms).

## Auto-Start Service

If you enable auto-start during setup:

- **Linux**: Creates a systemd user service (`~/.config/systemd/user/signalk.service`)
- **macOS**: Creates a launchd agent (`~/Library/LaunchAgents/org.signalk.server.plist`)
- **Windows**: Creates a scheduled task that runs at login

### Managing the Service

**Linux:**
```bash
# Check status
systemctl --user status signalk

# Stop/Start/Restart
systemctl --user stop signalk
systemctl --user start signalk
systemctl --user restart signalk

# Disable auto-start
systemctl --user disable signalk
```

**macOS:**
```bash
# Stop
launchctl unload ~/Library/LaunchAgents/org.signalk.server.plist

# Start
launchctl load ~/Library/LaunchAgents/org.signalk.server.plist
```

## Automatic Updates

The installer includes automatic update checking. When a new version is available:

1. You'll see a notification in the installer app
2. Click "Update" to download and install the new version
3. Your configuration in `~/.signalk/` is preserved

Note: Server updates are handled by the installer, not the web admin UI. The admin UI will show "Managed Installation" on the Server Update page.

## Uninstalling

### Linux (deb)
```bash
sudo dpkg -r signalk-installer
# Remove config (optional):
rm -rf ~/.signalk ~/.local/signalk
```

### macOS
1. Delete SignalK Installer from Applications
2. Remove the launch agent: `rm ~/Library/LaunchAgents/org.signalk.server.plist`
3. Remove config (optional): `rm -rf ~/.signalk ~/Library/SignalK`

### Windows
1. Use "Add or Remove Programs" in Windows Settings
2. Remove config (optional): Delete `%LOCALAPPDATA%\SignalK` and `%USERPROFILE%\.signalk`

## Troubleshooting

### "Signal K won't start"
- Check if port 3000 is already in use
- Look at the service logs:
  - Linux: `journalctl --user -u signalk -f`
  - macOS: `log show --predicate 'subsystem == "org.signalk.server"' --last 1h`

### "Serial port access denied" (Linux)
Add your user to the `dialout` group:
```bash
sudo usermod -a -G dialout $USER
# Log out and back in for changes to take effect
```

### "Can't connect to http://localhost:3000"
- Ensure the service is running (see Managing the Service above)
- Check your firewall settings
- Try accessing via your machine's IP address instead of localhost

## Comparison with Other Installation Methods

| Feature | Installer | npm | Docker |
|---------|-----------|-----|--------|
| Prerequisites | None | Node.js 22 | Docker |
| Native modules | Pre-built | May need build tools | Pre-built |
| Updates | One-click | `npm update` | Pull new image |
| Service setup | Automatic | Manual | Docker manages |
| Best for | End users | Developers | Containers |

For development or if you prefer manual installation, see [npm installation](npm.md) or [Docker installation](docker.md).
