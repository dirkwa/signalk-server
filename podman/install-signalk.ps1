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
        podman machine init --cpus 2 --memory 2048 --disk-size 20

        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to initialize Podman Machine"
        }

        Write-Success "Podman Machine initialized"
    }
    else {
        Write-Success "Podman Machine already exists"
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

# Convert path for Podman Machine
`$dataVolume = `$SIGNALK_DATA_DIR -replace '\\', '/'
if (`$dataVolume -match '^([A-Za-z]):(.*)$') {
    `$dataVolume = "/mnt/`$(`$Matches[1].ToLower())`$(`$Matches[2])"
}

# Run Signal K Server
Write-Host "Starting Signal K Server..."
podman run -d --name signalk ``
    -p ${SIGNALK_PORT}:3000 ``
    -v "`${dataVolume}:/home/node/.signalk" ``
    --user root ``
    --entrypoint /bin/bash ``
    `$SIGNALK_IMAGE ``
    -c "setcap -r /usr/bin/node 2>/dev/null; exec /home/node/signalk/startup.sh"

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

    # Convert Windows path to a format Podman can use (e.g., C:\Users\... -> /mnt/c/Users/...)
    $dataVolume = $SIGNALK_DATA_DIR -replace '\\', '/'
    if ($dataVolume -match '^([A-Za-z]):(.*)$') {
        $dataVolume = "/mnt/$($Matches[1].ToLower())$($Matches[2])"
    }

    # Run the container
    # On Windows/Podman Machine, we run as root because:
    # 1. Volume mounts from Windows don't have the same UID mapping as Linux
    # 2. The node user in the container may not have write access to mounted volumes
    # 3. We still need to remove cap_net_raw from node binary
    podman run -d --name signalk `
        -p ${SIGNALK_PORT}:3000 `
        -v "${dataVolume}:/home/node/.signalk" `
        --user root `
        --entrypoint /bin/bash `
        $SIGNALK_IMAGE `
        -c "setcap -r /usr/bin/node 2>/dev/null; exec /home/node/signalk/startup.sh"

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to start Signal K Server"
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
    Write-Host "Startup scripts:"
    Write-Host "  $SIGNALK_DATA_DIR\start-signalk.ps1"
    Write-Host "  $SIGNALK_DATA_DIR\stop-signalk.ps1"
    Write-Host ""
    Write-Host "Data directory: $SIGNALK_DATA_DIR"
    Write-Host ""
    Write-Host "Note: Serial port access on Windows requires additional setup."
    Write-Host "See: https://signalk.org/docs/windows-serial"
    Write-Host ""
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
    Get-SignalKImage
    New-StartupScript
    New-StopScript
    Start-SignalK
    Write-Summary
}

# Run main
Main
