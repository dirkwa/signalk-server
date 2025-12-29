#Requires -Version 5.1
<#
.SYNOPSIS
    Signal K Server Installation Script for Windows
    https://get.signalk.io

.DESCRIPTION
    Installs Signal K Server using Podman Machine (WSL2 backend, no full distro needed).

.EXAMPLE
    # Run in PowerShell (as regular user, NOT as Administrator):
    irm https://get.signalk.io/windows | iex

    # Or download and run:
    .\install-signalk.ps1
#>

$ErrorActionPreference = "Stop"

# Configuration
$SIGNALK_IMAGE = "ghcr.io/signalk/signalk-server:latest"
$SIGNALK_PORT = 3000
$SIGNALK_DATA_DIR = "$env:USERPROFILE\.signalk"
$MIN_RAM_GB = 6
$script:SELECTED_DEVICES = @()  # Will hold selected USB device BUSIDs

# Colors
function Write-Info { Write-Host "[INFO] $args" -ForegroundColor Blue }
function Write-Success { Write-Host "[OK] $args" -ForegroundColor Green }
function Write-Warn { Write-Host "[WARN] $args" -ForegroundColor Yellow }
function Write-Error { Write-Host "[ERROR] $args" -ForegroundColor Red; exit 1 }

# Check if running as Administrator (we don't want that for most operations)
function Test-NotAdmin {
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isAdmin) {
        Write-Warn "Running as Administrator. Some operations work better as a regular user."
        Write-Warn "Consider re-running without 'Run as Administrator' unless you encounter permission issues."
    }
}

# Check system RAM
function Test-SystemRAM {
    Write-Info "Checking system memory..."

    $totalRAM = [math]::Round((Get-CimInstance -ClassName Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)

    if ($totalRAM -lt $MIN_RAM_GB) {
        Write-Error "Insufficient RAM: ${totalRAM}GB detected, minimum ${MIN_RAM_GB}GB required."
    }

    Write-Success "System RAM: ${totalRAM}GB (minimum: ${MIN_RAM_GB}GB)"
}

# Check if WSL2 is available
function Test-WSL2 {
    Write-Info "Checking WSL2 availability..."

    try {
        $wslStatus = wsl --status 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "WSL not available"
        }

        # Check if default version is 2
        if ($wslStatus -match "Default Version: 2" -or $wslStatus -match "Standardversion: 2") {
            Write-Success "WSL2 is available and set as default"
            return $true
        }

        # WSL exists but might not be version 2
        Write-Info "Setting WSL default version to 2..."
        wsl --set-default-version 2
        Write-Success "WSL2 configured"
        return $true
    }
    catch {
        return $false
    }
}

# Install WSL2 if needed
function Install-WSL2 {
    Write-Info "WSL2 is required for Podman. Installing..."
    Write-Warn "This requires Administrator privileges and a system restart."

    $response = Read-Host "Continue with WSL2 installation? (y/n)"
    if ($response -ne "y") {
        Write-Error "WSL2 is required. Please install manually: wsl --install --no-distribution"
    }

    # Install WSL without a distribution (just the WSL2 kernel)
    Start-Process -FilePath "wsl" -ArgumentList "--install", "--no-distribution" -Verb RunAs -Wait

    Write-Warn "Please restart your computer, then run this script again."
    exit 0
}

# Check if Podman is installed
function Test-Podman {
    Write-Info "Checking for Podman..."

    try {
        $version = podman --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Podman is installed: $version"
            return $true
        }
    }
    catch {}

    return $false
}

# Install Podman via winget
function Install-Podman {
    Write-Info "Installing Podman..."

    # Check if winget is available
    try {
        winget --version | Out-Null
    }
    catch {
        Write-Error "winget is not available. Please install Podman manually from https://podman.io/getting-started/installation#windows"
    }

    # Install Podman (silent install)
    winget install -e --id RedHat.Podman --accept-package-agreements --accept-source-agreements --silent

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install Podman. Please install manually from https://podman.io"
    }

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    Write-Success "Podman installed"
}

# Initialize Podman Machine
function Initialize-PodmanMachine {
    Write-Info "Checking Podman Machine..."

    # Check if machine exists
    $machines = podman machine list --format "{{.Name}}" 2>&1
    $machineExists = $machines -match "podman-machine-default"

    if (-not $machineExists) {
        Write-Info "Initializing Podman Machine (this may take a few minutes)..."

        # Initialize with reasonable defaults for Signal K
        # Mount user profile directory so volume mounts work correctly
        $userProfile = $env:USERPROFILE -replace '\\', '/'
        podman machine init --cpus 2 --memory 2048 --disk-size 20 -v "${userProfile}:${userProfile}"

        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to initialize Podman Machine"
        }

        Write-Success "Podman Machine initialized"
    }
    else {
        Write-Success "Podman Machine already exists"
    }

    # Verify the user profile mount exists (for existing machines)
    $userProfile = $env:USERPROFILE -replace '\\', '/'
    $mounts = podman machine inspect podman-machine-default 2>&1 | ConvertFrom-Json | Select-Object -ExpandProperty Mounts -ErrorAction SilentlyContinue
    $hasUserMount = $mounts | Where-Object { $_.Source -eq $userProfile }

    if (-not $hasUserMount -and $machineExists) {
        Write-Warn "Podman Machine is missing user profile mount."
        Write-Warn "For data persistence, you may need to recreate the machine:"
        Write-Warn "  podman machine stop"
        Write-Warn "  podman machine rm podman-machine-default"
        Write-Warn "  Then run this installer again."
    }

    # Check if machine is running
    $machineInfo = podman machine inspect podman-machine-default 2>&1 | ConvertFrom-Json

    if ($machineInfo.State -ne "running") {
        Write-Info "Starting Podman Machine..."
        podman machine start

        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to start Podman Machine"
        }

        Write-Success "Podman Machine started"
    }
    else {
        Write-Success "Podman Machine is running"
    }
}

# Check if usbipd is installed
function Test-Usbipd {
    try {
        $version = usbipd --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            return $true
        }
    }
    catch {}
    return $false
}

# Install usbipd-win for USB passthrough to WSL2
function Install-Usbipd {
    Write-Info "Installing usbipd-win for USB device passthrough..."

    winget install -e --id dorssel.usbipd-win --accept-package-agreements --accept-source-agreements --silent

    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Failed to install usbipd-win automatically."
        Write-Warn "You can install it manually from: https://github.com/dorssel/usbipd-win/releases"
        return $false
    }

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    Write-Success "usbipd-win installed"
    return $true
}

# Scan for USB serial devices
function Find-SerialDevices {
    Write-Info "Scanning for serial devices..."

    # Get serial devices from Windows
    $serialDevices = @()

    # Query WMI for serial ports (COM ports)
    # Include USB, FTDI, and other common serial adapters
    $serialPorts = Get-CimInstance -ClassName Win32_PnPEntity | Where-Object {
        $_.Name -match "COM\d+" -and (
            $_.DeviceID -match "USB" -or
            $_.DeviceID -match "FTDI" -or
            $_.DeviceID -match "VID_" -or      # Any USB Vendor ID
            $_.Name -match "Actisense" -or
            $_.Name -match "NGT" -or
            $_.Name -match "Serial" -or
            $_.Name -match "NMEA"
        )
    }

    if ($serialPorts) {
        foreach ($port in $serialPorts) {
            # Extract COM port number from name
            if ($port.Name -match "(COM\d+)") {
                $comPort = $Matches[1]
                $serialDevices += [PSCustomObject]@{
                    Name = $port.Name
                    ComPort = $comPort
                    DeviceID = $port.DeviceID
                }
            }
        }
    }

    if ($serialDevices.Count -eq 0) {
        Write-Info "No serial devices found"
        return @()
    }

    Write-Host ""
    Write-Host "Found serial devices:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $serialDevices.Count; $i++) {
        Write-Host "  [$i] $($serialDevices[$i].Name)"
    }
    Write-Host ""

    return $serialDevices
}

# Setup USB device passthrough with usbipd
function Setup-UsbPassthrough {
    # First, check if there are any USB serial devices
    # Force array context to ensure .Count works correctly
    $serialDevices = @(Find-SerialDevices)

    if ($serialDevices.Count -eq 0) {
        # No Windows COM ports found - check if devices are already attached to WSL
        # (when attached to WSL, they don't show as COM ports in Windows)
        if (Test-Usbipd) {
            $usbipdOutput = usbipd list 2>&1
            $attachedDevices = @($usbipdOutput | Where-Object {
                $_ -match "Attached" -and ($_ -match "Actisense|NGT|NMEA|Serial|FTDI|0403:")
            })

            if ($attachedDevices.Count -gt 0) {
                Write-Host ""
                Write-Success "USB device already attached to WSL:"
                foreach ($line in $attachedDevices) {
                    if ($line -match "^(\d+-\d+)\s+\S+\s+(.+?)\s+Attached") {
                        $busId = $Matches[1]
                        $deviceName = $Matches[2].Trim()
                        Write-Host "  $deviceName (BUSID: $busId)" -ForegroundColor Cyan

                        # Store for later use
                        $script:SELECTED_DEVICES += [PSCustomObject]@{
                            BusId = $busId
                            Name = $deviceName
                            ComPort = "N/A"
                        }
                    }
                }

                # Ensure scheduled task exists for auto-attach
                New-UsbAutoAttachTask
                return
            }
        }

        # No devices found at all
        Write-Host ""
        $response = Read-Host "Do you have a USB device for NMEA 2000 / NMEA 0183 (e.g., Actisense NGT-1)? (y/n)"
        if ($response -eq "y") {
            Write-Info "Connect your device and run the installer again, or see README for manual setup."
        }
        return
    }

    # Devices found - ask user-friendly question
    Write-Host ""
    Write-Host "USB serial device detected! This could be used for NMEA 2000 / NMEA 0183 data." -ForegroundColor Cyan
    $response = Read-Host "Configure this device for Signal K? (y/n)"

    if ($response -ne "y") {
        Write-Info "Skipping USB device setup. See README for manual configuration later."
        return
    }

    # Determine which devices to use
    $selectedIndices = @()

    if ($serialDevices.Count -eq 1) {
        # Single device - just use it automatically
        $selectedIndices = @(0)
    }
    else {
        # Multiple devices - ask user which ones
        $selection = Read-Host "Enter device numbers to use (comma-separated, e.g., 0,1) or 'all' or 'none'"

        if ($selection -eq "none" -or [string]::IsNullOrWhiteSpace($selection)) {
            Write-Info "No devices selected"
            return
        }

        if ($selection -eq "all") {
            $selectedIndices = 0..($serialDevices.Count - 1)
        }
        else {
            $selectedIndices = $selection -split ',' | ForEach-Object { [int]$_.Trim() }
        }
    }

    # Check if usbipd is available, install if needed
    if (-not (Test-Usbipd)) {
        Write-Info "Installing required USB passthrough software..."
        if (-not (Install-Usbipd)) {
            Write-Warn "Could not install USB passthrough software. See README for manual setup."
            return
        }
        Write-Info "USB passthrough software ready."
    }

    # Get usbipd device list to match with selected serial devices
    Write-Info "Matching USB devices with usbipd..."
    $usbipdOutput = usbipd list 2>&1

    # Store selected BUSIDs for later use
    $script:SELECTED_DEVICES = @()

    foreach ($idx in $selectedIndices) {
        if ($idx -lt $serialDevices.Count) {
            $device = $serialDevices[$idx]
            Write-Host "  Selected: $($device.Name)" -ForegroundColor Green

            # Try to find matching usbipd device
            # usbipd list format: "1-3    0403:d9aa  Actisense NGT (COM3)"
            $found = $false
            foreach ($line in $usbipdOutput) {
                # Match by COM port or device name keywords
                $nameKeywords = ($device.Name -split '\s+') | Where-Object { $_.Length -gt 3 -and $_ -notmatch "COM\d+" }
                $matchesName = $false
                foreach ($keyword in $nameKeywords) {
                    if ($line -match [regex]::Escape($keyword)) {
                        $matchesName = $true
                        break
                    }
                }

                if ($line -match "^(\d+-\d+)\s+" -and ($line -match $device.ComPort -or $matchesName)) {
                    $busId = $Matches[1]
                    $script:SELECTED_DEVICES += [PSCustomObject]@{
                        BusId = $busId
                        Name = $device.Name
                        ComPort = $device.ComPort
                    }
                    Write-Info "  Found USB device at BUSID: $busId"
                    $found = $true
                    break
                }
            }

            if (-not $found) {
                Write-Warn "  Could not find BUSID for $($device.Name). You may need to configure manually."
            }
        }
    }

    if ($script:SELECTED_DEVICES.Count -gt 0) {
        Write-Host ""
        Write-Warn "USB device binding requires Administrator privileges."
        $response = Read-Host "Bind selected USB devices now? (y/n)"

        if ($response -eq "y") {
            foreach ($dev in $script:SELECTED_DEVICES) {
                Write-Info "Binding device $($dev.BusId) ($($dev.Name))..."
                # Run usbipd bind as admin
                Start-Process -FilePath "usbipd" -ArgumentList "bind", "--busid", $dev.BusId -Verb RunAs -Wait
            }
            Write-Success "USB devices bound"

            # Attach devices to WSL
            Write-Info "Attaching USB devices to WSL..."
            foreach ($dev in $script:SELECTED_DEVICES) {
                $ErrorActionPreference = "SilentlyContinue"
                usbipd attach --wsl --busid $dev.BusId *>&1 | Out-Null
                $ErrorActionPreference = "Stop"
            }
            Write-Success "USB devices attached to WSL"

            # Show the Linux device paths
            Start-Sleep -Seconds 2  # Give WSL a moment to recognize devices
            $wslDevices = podman machine ssh "ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null" 2>&1
            if ($wslDevices -and $LASTEXITCODE -eq 0) {
                Write-Host ""
                Write-Host "Device paths in Signal K (use these when configuring connections):" -ForegroundColor Cyan
                foreach ($dev in ($wslDevices -split "`n")) {
                    if ($dev -match "^/dev/tty") {
                        Write-Host "  $($dev.Trim())" -ForegroundColor Green
                    }
                }
            }

            # Create auto-attach script and scheduled task
            New-UsbAutoAttachTask
        }
    }
}

# Create scheduled task to auto-attach USB devices on login
function New-UsbAutoAttachTask {
    if ($script:SELECTED_DEVICES.Count -eq 0) {
        return
    }

    Write-Info "Setting up automatic USB re-attach on Windows startup..."

    # Create the auto-attach script
    $attachScriptPath = "$SIGNALK_DATA_DIR\attach-usb.ps1"
    $busIds = ($script:SELECTED_DEVICES | ForEach-Object { $_.BusId }) -join ","

    $attachScript = @"
# Signal K USB Auto-Attach Script
# This script is run at login to re-attach USB devices to WSL

`$busIds = "$busIds" -split ","

foreach (`$busId in `$busIds) {
    # Check if device is available and not already attached
    `$status = usbipd list 2>&1 | Where-Object { `$_ -match "^`$busId\s+" }
    if (`$status -and `$status -notmatch "Attached") {
        usbipd attach --wsl --busid `$busId 2>&1 | Out-Null
    }
}
"@

    $attachScript | Out-File -FilePath $attachScriptPath -Encoding UTF8
    Write-Success "Created USB attach script: $attachScriptPath"

    # Create scheduled task
    $taskName = "SignalK-USB-Attach"

    # Remove existing task if present
    $ErrorActionPreference = "SilentlyContinue"
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false 2>&1 | Out-Null
    $ErrorActionPreference = "Stop"

    # Scheduled task creation requires admin privileges
    # Create a helper script to register the task, then run it elevated
    $registerScript = @"
`$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-WindowStyle Hidden -ExecutionPolicy Bypass -File "$attachScriptPath"'
`$trigger = New-ScheduledTaskTrigger -AtLogon
`$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName '$taskName' -Action `$action -Trigger `$trigger -Settings `$settings -Description 'Attach USB devices to WSL for Signal K' | Out-Null
"@

    $registerScriptPath = "$env:TEMP\register-signalk-task.ps1"
    $registerScript | Out-File -FilePath $registerScriptPath -Encoding UTF8

    try {
        Write-Info "Creating scheduled task (requires Admin)..."
        $process = Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$registerScriptPath`"" -Verb RunAs -Wait -PassThru
        Remove-Item $registerScriptPath -Force -ErrorAction SilentlyContinue

        if ($process.ExitCode -eq 0) {
            Write-Success "Created scheduled task: $taskName"
            Write-Info "USB devices will auto-attach when you log in to Windows"
        } else {
            throw "Task registration failed"
        }
    }
    catch {
        Remove-Item $registerScriptPath -Force -ErrorAction SilentlyContinue
        Write-Warn "Could not create scheduled task. You'll need to manually re-attach USB devices after restart."
        Write-Warn "Run: usbipd attach --wsl --busid <BUSID>"
    }
}

# Create data directory
function New-DataDirectory {
    if (-not (Test-Path $SIGNALK_DATA_DIR)) {
        Write-Info "Creating data directory: $SIGNALK_DATA_DIR"
        New-Item -ItemType Directory -Path $SIGNALK_DATA_DIR -Force | Out-Null
    }
    Write-Success "Data directory ready: $SIGNALK_DATA_DIR"
}

# Pull Signal K image
function Get-SignalKImage {
    Write-Info "Pulling Signal K Server image (~500MB, this may take several minutes)..."
    Write-Host "         Downloading container image - please wait..." -ForegroundColor Gray
    podman pull $SIGNALK_IMAGE

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to pull image"
    }

    Write-Success "Image pulled successfully"
}

# Create startup script
function New-StartupScript {
    $scriptPath = "$SIGNALK_DATA_DIR\start-signalk.ps1"

    Write-Info "Creating startup script..."

    $scriptContent = @"
# Signal K Server Startup Script
# Run this to start Signal K Server

`$SIGNALK_IMAGE = "$SIGNALK_IMAGE"
`$SIGNALK_DATA_DIR = "$SIGNALK_DATA_DIR"
`$SIGNALK_PORT = $SIGNALK_PORT

# Ensure Podman Machine is running
`$machineState = (podman machine inspect podman-machine-default 2>`$null | ConvertFrom-Json).State
if (`$machineState -ne "running") {
    Write-Host "Starting Podman Machine..."
    podman machine start
}

# Stop existing container if running
podman stop signalk 2>`$null
podman rm signalk 2>`$null

# Check if USB devices are available in WSL
# Note: Don't check `$LASTEXITCODE - ls returns non-zero if one glob pattern has no matches
`$wslDevices = podman machine ssh "ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null" 2>&1
`$hasUsbDevices = `$wslDevices -and (`$wslDevices -split "``n" | Where-Object { `$_ -match "^/dev/tty" }).Count -gt 0

# Build run arguments
# Use --privileged when USB devices are present (--device doesn't work with Podman Machine)
`$runArgs = @(
    "run", "-d", "--name", "signalk",
    "--restart", "always",
    "-p", "`${SIGNALK_PORT}:3000",
    "-v", "`${SIGNALK_DATA_DIR}:/home/node/.signalk",
    "-e", "SIGNALK_NODE_CONFIG_DIR=/home/node/.signalk",
    "--user", "root",
    "--entrypoint", "/bin/bash"
)

if (`$hasUsbDevices) {
    `$runArgs += "--privileged"
    Write-Host "USB devices detected - running with --privileged for device access"
}

`$runArgs += @(`$SIGNALK_IMAGE, "-c", "setcap -r /usr/bin/node 2>/dev/null; exec /home/node/signalk/startup.sh")

Write-Host "Starting Signal K Server..."
& podman @runArgs

# Fix device permissions on WSL2 host (must be done after container starts)
if (`$hasUsbDevices) {
    Write-Host "Setting device permissions..."
    podman machine ssh "sudo chmod 666 /dev/ttyUSB* /dev/ttyACM* 2>/dev/null" 2>&1 | Out-Null
}

Write-Host ""
Write-Host "Signal K Server is starting..."
Write-Host "Access at: http://localhost:${SIGNALK_PORT}"
Write-Host ""
Write-Host "Commands:"
Write-Host "  podman logs -f signalk    # View logs"
Write-Host "  podman stop signalk       # Stop server"
Write-Host "  podman start signalk      # Start server"
"@

    $scriptContent | Out-File -FilePath $scriptPath -Encoding UTF8
    Write-Success "Startup script created: $scriptPath"
}

# Create stop script
function New-StopScript {
    $scriptPath = "$SIGNALK_DATA_DIR\stop-signalk.ps1"

    $scriptContent = @"
# Signal K Server Stop Script
podman stop signalk
Write-Host "Signal K Server stopped"
"@

    $scriptContent | Out-File -FilePath $scriptPath -Encoding UTF8
}

# Start Signal K
function Start-SignalK {
    Write-Info "Starting Signal K Server..."

    # Stop existing container if any (ignore errors if doesn't exist)
    $ErrorActionPreference = "SilentlyContinue"
    podman stop signalk 2>&1 | Out-Null
    podman rm signalk 2>&1 | Out-Null
    $ErrorActionPreference = "Stop"

    # Podman Machine on Windows supports Windows paths directly
    # No conversion needed - just use the Windows path as-is
    $dataVolume = $SIGNALK_DATA_DIR

    # Check if USB devices are available in WSL (for --privileged flag)
    # Note: Don't check $LASTEXITCODE - ls returns non-zero if one glob pattern has no matches
    $wslDevices = podman machine ssh "ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null" 2>&1
    $hasUsbDevices = $wslDevices -and ($wslDevices -split "`n" | Where-Object { $_ -match "^/dev/tty" }).Count -gt 0

    # Run the container
    # On Windows/Podman Machine, we run as root because:
    # 1. Volume mounts from Windows don't have the same UID mapping as Linux
    # 2. The node user in the container may not have write access to mounted volumes
    # 3. We still need to remove cap_net_raw from node binary
    # We set SIGNALK_NODE_CONFIG_DIR to point to the mounted volume since root's home is /root
    # We use --privileged when USB devices are present because --device doesn't work reliably with Podman Machine
    # We use --restart=always so the container restarts when Signal K GUI restart is clicked
    $runArgs = @(
        "run", "-d", "--name", "signalk",
        "--restart", "always",
        "-p", "${SIGNALK_PORT}:3000",
        "-v", "${dataVolume}:/home/node/.signalk",
        "-e", "SIGNALK_NODE_CONFIG_DIR=/home/node/.signalk",
        "--user", "root",
        "--entrypoint", "/bin/bash"
    )

    if ($hasUsbDevices) {
        $runArgs += "--privileged"
        Write-Info "USB devices detected - running with --privileged for device access"
    }
    $runArgs += @($SIGNALK_IMAGE, "-c", "setcap -r /usr/bin/node 2>/dev/null; exec /home/node/signalk/startup.sh")

    & podman @runArgs

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to start Signal K Server"
    }

    # Fix device permissions on WSL2 host (must be done after container starts)
    if ($hasUsbDevices) {
        Write-Info "Setting device permissions..."
        podman machine ssh "sudo chmod 666 /dev/ttyUSB* /dev/ttyACM* 2>/dev/null" 2>&1 | Out-Null
    }

    # Wait for startup
    Start-Sleep -Seconds 5

    $containerState = podman inspect signalk --format "{{.State.Status}}" 2>&1
    if ($containerState -eq "running") {
        Write-Success "Signal K Server is running"
    }
    else {
        Write-Warn "Container may still be starting. Check with: podman logs signalk"
    }
}

# Create systemd service inside Podman Machine to supervise the container
# This enables the restart button in Signal K to work properly
function Enable-ContainerSupervision {
    # Check if supervision is already active (skip if so - much faster)
    $status = podman machine ssh "systemctl --user is-active signalk-supervisor.service 2>/dev/null" 2>&1
    if ($status -match "^active") {
        Write-Success "Container supervision already enabled"
        return $true
    }

    Write-Info "Enabling container supervision (for restart button support)..."

    # Stop container first (systemd will manage it)
    $ErrorActionPreference = "SilentlyContinue"
    podman stop signalk 2>&1 | Out-Null
    $ErrorActionPreference = "Stop"

    # Create service file and enable it in a single SSH call
    $serviceContent = "[Unit]\nDescription=Signal K Server Container\nAfter=network-online.target\n\n[Service]\nType=simple\nRestart=always\nRestartSec=3\nExecStart=/usr/bin/podman start -a signalk\nExecStop=/usr/bin/podman stop signalk\n\n[Install]\nWantedBy=default.target\n"
    $setupCmd = "mkdir -p ~/.config/systemd/user && sudo chown -R user:user ~/.config/systemd && printf '$serviceContent' > ~/.config/systemd/user/signalk-supervisor.service && systemctl --user daemon-reload && systemctl --user enable --now signalk-supervisor.service"
    podman machine ssh $setupCmd 2>&1 | Out-Null

    # Verify it worked
    Start-Sleep -Seconds 2
    $status = podman machine ssh "systemctl --user is-active signalk-supervisor.service" 2>&1
    if ($status -match "active") {
        Write-Success "Container supervision enabled (restart button will work)"
        return $true
    }
    else {
        Write-Warn "Could not enable container supervision. Restart button may not work as expected."
        Write-Warn "You can manually restart with: podman start signalk"
        # Start container directly as fallback
        podman start signalk 2>&1 | Out-Null
        return $false
    }
}

# Print summary
function Write-Summary {
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Green
    Write-Host "Signal K Server Installation Complete!" -ForegroundColor Green
    Write-Host "==============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Access the server at:"
    Write-Host "  http://localhost:$SIGNALK_PORT"
    Write-Host ""
    Write-Host "Useful commands:"
    Write-Host "  podman logs -f signalk       # View logs"
    Write-Host "  podman stop signalk          # Stop server"
    Write-Host "  podman start signalk         # Start server"
    Write-Host "  podman machine stop          # Stop Podman VM (saves resources)"
    Write-Host ""
    Write-Host "Auto-start: Enabled (Signal K starts when you log in)" -ForegroundColor Green
    Write-Host ""
    Write-Host "Startup scripts:"
    Write-Host "  $SIGNALK_DATA_DIR\start-signalk.ps1"
    Write-Host "  $SIGNALK_DATA_DIR\stop-signalk.ps1"
    Write-Host ""
    Write-Host "Data directory: $SIGNALK_DATA_DIR"
    Write-Host ""
    Write-Host "Uninstall:"
    Write-Host "  .\install-signalk.ps1 --uninstall"
    Write-Host ""

    if ($script:SELECTED_DEVICES.Count -gt 0) {
        Write-Host "Serial devices configured:" -ForegroundColor Cyan
        foreach ($dev in $script:SELECTED_DEVICES) {
            Write-Host "  $($dev.Name) (BUSID: $($dev.BusId))"
        }
        Write-Host ""
        Write-Host "USB auto-attach: Enabled (via scheduled task 'SignalK-USB-Attach')" -ForegroundColor Green
        Write-Host "  USB devices will automatically connect when you log in to Windows."
        Write-Host ""
        Write-Host "Manual re-attach if needed:" -ForegroundColor Gray
        foreach ($dev in $script:SELECTED_DEVICES) {
            Write-Host "  usbipd attach --wsl --busid $($dev.BusId)" -ForegroundColor Gray
        }
        Write-Host ""
    }
    else {
        Write-Host "Note: To add serial ports later, see README for USB passthrough setup."
        Write-Host ""
    }
}

# Main installation flow
function Main {
    Write-Host ""
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "  Signal K Server Installer (Windows)" -ForegroundColor Cyan
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host ""

    Test-NotAdmin
    Test-SystemRAM

    if (-not (Test-WSL2)) {
        Install-WSL2
    }

    if (-not (Test-Podman)) {
        Install-Podman
    }

    Initialize-PodmanMachine
    New-DataDirectory
    Setup-UsbPassthrough
    Get-SignalKImage
    New-StartupScript
    New-StopScript
    New-AutoStartTask
    Start-SignalK
    Enable-ContainerSupervision
    Write-Summary
}

# Create scheduled task to auto-start Signal K on login
function New-AutoStartTask {
    Write-Info "Setting up Signal K auto-start on login..."

    $taskName = "SignalK-Server-Start"
    $startScript = "$SIGNALK_DATA_DIR\start-signalk.ps1"

    # Create a helper script to register the task (requires admin)
    $registerScript = @"
`$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-WindowStyle Hidden -ExecutionPolicy Bypass -File "$startScript"'
`$trigger = New-ScheduledTaskTrigger -AtLogon
`$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName '$taskName' -Action `$action -Trigger `$trigger -Settings `$settings -Description 'Start Signal K Server on login' | Out-Null
"@

    $registerScriptPath = "$env:TEMP\register-signalk-autostart.ps1"
    $registerScript | Out-File -FilePath $registerScriptPath -Encoding UTF8

    try {
        Write-Info "Creating scheduled task (requires Admin)..."
        $process = Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$registerScriptPath`"" -Verb RunAs -Wait -PassThru
        Remove-Item $registerScriptPath -Force -ErrorAction SilentlyContinue

        if ($process.ExitCode -eq 0) {
            Write-Success "Auto-start enabled (scheduled task: $taskName)"
        } else {
            throw "Task registration failed"
        }
    }
    catch {
        Remove-Item $registerScriptPath -Force -ErrorAction SilentlyContinue
        Write-Warn "Could not create auto-start task. You can start manually with: ~\.signalk\start-signalk.ps1"
    }
}

# Uninstall Signal K
function Uninstall-SignalK {
    Write-Host ""
    Write-Host "=========================================" -ForegroundColor Yellow
    Write-Host "  Signal K Server Uninstaller (Windows)" -ForegroundColor Yellow
    Write-Host "=========================================" -ForegroundColor Yellow
    Write-Host ""

    # Stop and remove container
    Write-Info "Stopping Signal K Server..."
    $ErrorActionPreference = "SilentlyContinue"
    podman stop signalk 2>&1 | Out-Null
    podman rm signalk 2>&1 | Out-Null
    $ErrorActionPreference = "Stop"
    Write-Success "Container stopped and removed"

    # Remove scheduled tasks
    Write-Info "Removing scheduled tasks..."
    $ErrorActionPreference = "SilentlyContinue"
    Unregister-ScheduledTask -TaskName "SignalK-Server-Start" -Confirm:$false 2>&1 | Out-Null
    Unregister-ScheduledTask -TaskName "SignalK-USB-Attach" -Confirm:$false 2>&1 | Out-Null
    $ErrorActionPreference = "Stop"
    Write-Success "Scheduled tasks removed"

    # Ask about image removal
    Write-Host ""
    $removeImage = Read-Host "Remove Signal K container image? [Y/n]"
    if ($removeImage -eq "" -or $removeImage -eq "y" -or $removeImage -eq "Y") {
        Write-Info "Removing container image..."
        $ErrorActionPreference = "SilentlyContinue"
        podman rmi $SIGNALK_IMAGE 2>&1 | Out-Null
        $ErrorActionPreference = "Stop"
        Write-Success "Image removed"
    }

    # Ask about data directory
    Write-Host ""
    Write-Warn "Data directory: $SIGNALK_DATA_DIR"
    $removeData = Read-Host "Remove data directory? This will DELETE all your Signal K data! [y/N]"
    if ($removeData -eq "y" -or $removeData -eq "Y") {
        $confirm = Read-Host "Are you SURE? Type 'yes' to confirm"
        if ($confirm -eq "yes") {
            Write-Info "Removing data directory..."
            Remove-Item -Recurse -Force $SIGNALK_DATA_DIR -ErrorAction SilentlyContinue
            Write-Success "Data directory removed"
        }
        else {
            Write-Info "Data directory preserved"
        }
    }
    else {
        Write-Info "Data directory preserved at: $SIGNALK_DATA_DIR"
    }

    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Green
    Write-Host "Signal K Server Uninstalled" -ForegroundColor Green
    Write-Host "==============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Podman was NOT removed (you may have other containers)."
    Write-Host "To remove Podman: winget uninstall RedHat.Podman"
    Write-Host ""
}

# Parse arguments
if ($args.Count -gt 0) {
    switch ($args[0]) {
        "--uninstall" { Uninstall-SignalK; exit 0 }
        "-u" { Uninstall-SignalK; exit 0 }
        "--help" {
            Write-Host "Signal K Server Installer (Windows)"
            Write-Host ""
            Write-Host "Usage:"
            Write-Host "  .\install-signalk.ps1              Install Signal K Server"
            Write-Host "  .\install-signalk.ps1 --uninstall  Uninstall Signal K Server"
            Write-Host "  .\install-signalk.ps1 --help       Show this help"
            exit 0
        }
        "-h" {
            Write-Host "Signal K Server Installer (Windows)"
            Write-Host ""
            Write-Host "Usage:"
            Write-Host "  .\install-signalk.ps1              Install Signal K Server"
            Write-Host "  .\install-signalk.ps1 --uninstall  Uninstall Signal K Server"
            Write-Host "  .\install-signalk.ps1 --help       Show this help"
            exit 0
        }
    }
}

# Run main installation
Main
