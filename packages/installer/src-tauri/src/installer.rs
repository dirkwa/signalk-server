use crate::{ExistingInstall, InstallerConfig};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

/// Recursively copy a directory
fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

/// Get the SignalK configuration directory
fn get_config_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".signalk"))
        .unwrap_or_else(|| PathBuf::from(".signalk"))
}

/// Get the SignalK installation directory (user-level)
fn get_install_dir() -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        dirs::home_dir()
            .map(|h| h.join(".local").join("signalk"))
            .unwrap_or_else(|| PathBuf::from("signalk"))
    }

    #[cfg(target_os = "macos")]
    {
        dirs::home_dir()
            .map(|h| h.join("Library").join("SignalK"))
            .unwrap_or_else(|| PathBuf::from("SignalK"))
    }

    #[cfg(target_os = "windows")]
    {
        dirs::data_local_dir()
            .map(|d| d.join("SignalK"))
            .unwrap_or_else(|| PathBuf::from("SignalK"))
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        PathBuf::from("signalk")
    }
}

/// Check if there's an existing SignalK installation
pub fn check_existing_install() -> ExistingInstall {
    let config_dir = get_config_dir();
    let settings_path = config_dir.join("settings.json");

    if settings_path.exists() {
        // Try to read version from package.json
        let package_path = config_dir.join("package.json");
        let version = fs::read_to_string(&package_path)
            .ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .and_then(|json| json.get("version").and_then(|v| v.as_str().map(String::from)));

        ExistingInstall {
            found: true,
            config_path: Some(config_dir.to_string_lossy().to_string()),
            version,
        }
    } else {
        ExistingInstall {
            found: false,
            config_path: None,
            version: None,
        }
    }
}

/// Emit installation progress event
fn emit_progress(app: &AppHandle, step: &str, status: &str, message: Option<&str>) {
    let _ = app.emit(
        "install-progress",
        json!({
            "step": step,
            "status": status,
            "message": message
        }),
    );
}

/// Run the installation process
pub async fn run_installation(app: AppHandle, config: InstallerConfig) -> Result<(), String> {
    let config_dir = get_config_dir();
    let install_dir = get_install_dir();

    // Step 1: Extract files
    emit_progress(&app, "extract", "in_progress", Some("Preparing installation directory..."));

    fs::create_dir_all(&config_dir).map_err(|e| format!("Failed to create config directory: {}", e))?;
    fs::create_dir_all(&install_dir).map_err(|e| format!("Failed to create install directory: {}", e))?;

    // Extract bundled Node.js and signalk-server from resources
    emit_progress(&app, "extract", "in_progress", Some("Extracting Node.js and SignalK Server..."));

    // Get the resource directory from Tauri
    let resource_path = app.path().resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    // Copy Node.js binary
    #[cfg(target_os = "windows")]
    let node_binary = "node.exe";
    #[cfg(not(target_os = "windows"))]
    let node_binary = "node";

    let bundled_node = resource_path.join(node_binary);
    let target_node = install_dir.join(node_binary);

    if bundled_node.exists() {
        fs::copy(&bundled_node, &target_node)
            .map_err(|e| format!("Failed to copy Node.js: {}", e))?;

        // Make executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&target_node)
                .map_err(|e| format!("Failed to get node permissions: {}", e))?
                .permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&target_node, perms)
                .map_err(|e| format!("Failed to set node permissions: {}", e))?;
        }
    }

    // Copy signalk-server directory
    let bundled_server = resource_path.join("signalk-server");
    let target_server = install_dir.join("signalk-server");

    if bundled_server.exists() {
        copy_dir_recursive(&bundled_server, &target_server)
            .map_err(|e| format!("Failed to copy SignalK Server: {}", e))?;
    }

    emit_progress(&app, "extract", "completed", None);

    // Step 2: Create configuration
    emit_progress(&app, "config", "in_progress", Some("Writing configuration files..."));

    // Generate UUID if no MMSI provided
    let vessel_uuid = if config.mmsi.is_empty() {
        format!("urn:mrn:signalk:uuid:{}", Uuid::new_v4())
    } else {
        format!("urn:mrn:imo:mmsi:{}", config.mmsi)
    };

    // Create settings.json
    let settings = json!({
        "interfaces": {
            "admin-ui": true,
            "appstore": true,
            "nmea-tcp": true,
            "plugins": true,
            "providers": true,
            "rest": true,
            "tcp": true,
            "webapps": true,
            "ws": true
        },
        "ssl": config.enable_ssl,
        "port": config.http_port,
        "sslport": config.ssl_port,
        "security": {
            "strategy": "./tokensecurity"
        },
        "pipedProviders": [],
        "enableLogging": true
    });

    let settings_path = config_dir.join("settings.json");
    fs::write(&settings_path, serde_json::to_string_pretty(&settings).unwrap())
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;

    // Create baseDeltas.json
    let base_deltas = json!([
        {
            "context": "vessels.self",
            "updates": [
                {
                    "values": [
                        {
                            "path": "",
                            "value": {
                                "name": config.vessel_name,
                                "uuid": vessel_uuid
                            }
                        }
                    ]
                }
            ]
        }
    ]);

    let base_deltas_path = config_dir.join("baseDeltas.json");
    fs::write(&base_deltas_path, serde_json::to_string_pretty(&base_deltas).unwrap())
        .map_err(|e| format!("Failed to write baseDeltas.json: {}", e))?;

    // Create package.json for plugins
    let package_json = json!({
        "name": "signalk-config",
        "version": "0.0.1",
        "description": "SignalK Server Configuration",
        "dependencies": {}
    });

    let package_path = config_dir.join("package.json");
    if !package_path.exists() {
        fs::write(&package_path, serde_json::to_string_pretty(&package_json).unwrap())
            .map_err(|e| format!("Failed to write package.json: {}", e))?;
    }

    // Create .npmrc
    let npmrc_path = config_dir.join(".npmrc");
    if !npmrc_path.exists() {
        fs::write(&npmrc_path, "package-lock=false\n")
            .map_err(|e| format!("Failed to write .npmrc: {}", e))?;
    }

    emit_progress(&app, "config", "completed", None);

    // Step 3: Set up service
    emit_progress(&app, "service", "in_progress", Some("Configuring auto-start..."));

    if config.enable_auto_start {
        setup_service(&config_dir, &install_dir)?;
    }

    emit_progress(&app, "service", "completed", None);

    // Step 4: Verify installation
    emit_progress(&app, "verify", "in_progress", Some("Verifying installation..."));

    // Check that configuration files exist
    if !settings_path.exists() {
        return Err("Installation verification failed: settings.json not found".to_string());
    }

    emit_progress(&app, "verify", "completed", None);

    Ok(())
}

/// Set up the system service for auto-start
fn setup_service(config_dir: &PathBuf, install_dir: &PathBuf) -> Result<(), String> {
    let config_path = config_dir.to_string_lossy().to_string();
    let node_path = install_dir.join("node").to_string_lossy().to_string();
    let server_path = install_dir.join("signalk-server").join("bin").join("signalk-server").to_string_lossy().to_string();

    #[cfg(target_os = "linux")]
    {
        use crate::platform::create_systemd_service;

        let service_content = create_systemd_service(&config_path, &node_path, &server_path)?;

        // Write to ~/.config/systemd/user/signalk.service
        let systemd_dir = dirs::config_dir()
            .map(|c| c.join("systemd").join("user"))
            .ok_or("Could not determine systemd user directory")?;

        fs::create_dir_all(&systemd_dir)
            .map_err(|e| format!("Failed to create systemd directory: {}", e))?;

        let service_path = systemd_dir.join("signalk.service");
        fs::write(&service_path, service_content)
            .map_err(|e| format!("Failed to write systemd service: {}", e))?;

        // Enable the service (user would need to run systemctl --user daemon-reload && systemctl --user enable signalk)
        // We'll document this or run it via a shell command
    }

    #[cfg(target_os = "macos")]
    {
        use crate::platform::create_launchd_plist;

        let plist_content = create_launchd_plist(&config_path, &node_path, &server_path)?;

        let launch_agents_dir = dirs::home_dir()
            .map(|h| h.join("Library").join("LaunchAgents"))
            .ok_or("Could not determine LaunchAgents directory")?;

        fs::create_dir_all(&launch_agents_dir)
            .map_err(|e| format!("Failed to create LaunchAgents directory: {}", e))?;

        let plist_path = launch_agents_dir.join("org.signalk.server.plist");
        fs::write(&plist_path, plist_content)
            .map_err(|e| format!("Failed to write launchd plist: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        use crate::platform::create_task_xml;

        let user = std::env::var("USERNAME").unwrap_or_else(|_| "User".to_string());
        let task_content = create_task_xml(&config_path, &node_path, &server_path, &user)?;

        // Write task XML to temp and register it
        let temp_dir = std::env::temp_dir();
        let task_path = temp_dir.join("signalk-task.xml");
        fs::write(&task_path, task_content)
            .map_err(|e| format!("Failed to write task XML: {}", e))?;

        // Task would be registered via: schtasks /create /xml task_path /tn "SignalK Server"
    }

    Ok(())
}
