// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod installer;
mod platform;
mod serial;
mod updater;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct InstallerConfig {
    #[serde(rename = "vesselName")]
    vessel_name: String,
    mmsi: String,
    #[serde(rename = "httpPort")]
    http_port: u16,
    #[serde(rename = "enableSsl")]
    enable_ssl: bool,
    #[serde(rename = "sslPort")]
    ssl_port: u16,
    #[serde(rename = "adminUser")]
    admin_user: String,
    #[serde(rename = "adminPassword")]
    admin_password: String,
    #[serde(rename = "enableAutoStart")]
    enable_auto_start: bool,
    #[serde(rename = "serialPorts")]
    serial_ports: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ExistingInstall {
    found: bool,
    #[serde(rename = "configPath")]
    config_path: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SerialPortInfo {
    path: String,
    description: String,
    manufacturer: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PlatformInfo {
    os: String,
    #[serde(rename = "serviceManager")]
    service_manager: String,
    #[serde(rename = "requiresAdmin")]
    requires_admin: bool,
}

#[tauri::command]
fn check_existing_install() -> ExistingInstall {
    installer::check_existing_install()
}

#[tauri::command]
fn list_serial_ports() -> Vec<SerialPortInfo> {
    serial::list_ports()
}

#[tauri::command]
fn get_platform_info() -> PlatformInfo {
    platform::get_info()
}

#[tauri::command]
async fn run_installation(app: AppHandle, config: InstallerConfig) -> Result<(), String> {
    installer::run_installation(app, config).await
}

#[tauri::command]
fn open_admin_ui() -> Result<(), String> {
    // Open default browser to SignalK admin UI
    open::that("http://localhost:3000").map_err(|e| e.to_string())
}

#[tauri::command]
fn close_installer(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<updater::UpdateInfo, String> {
    updater::check_for_updates(app).await
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    updater::install_update(app).await
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            check_existing_install,
            list_serial_ports,
            get_platform_info,
            run_installation,
            open_admin_ui,
            close_installer,
            check_for_updates,
            install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
