use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    #[serde(rename = "updateAvailable")]
    pub update_available: bool,
    #[serde(rename = "currentVersion")]
    pub current_version: String,
    #[serde(rename = "latestVersion")]
    pub latest_version: Option<String>,
    #[serde(rename = "releaseNotes")]
    pub release_notes: Option<String>,
    #[serde(rename = "downloadUrl")]
    pub download_url: Option<String>,
}

/// Check if a new version of SignalK Installer is available
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let updater = app.updater().map_err(|e| format!("Failed to get updater: {}", e))?;

    match updater.check().await {
        Ok(Some(update)) => {
            Ok(UpdateInfo {
                update_available: true,
                current_version,
                latest_version: Some(update.version.clone()),
                release_notes: update.body.clone(),
                download_url: Some(update.download_url.to_string()),
            })
        }
        Ok(None) => {
            Ok(UpdateInfo {
                update_available: false,
                current_version,
                latest_version: None,
                release_notes: None,
                download_url: None,
            })
        }
        Err(e) => {
            // Return current version info even if check fails
            Ok(UpdateInfo {
                update_available: false,
                current_version,
                latest_version: None,
                release_notes: Some(format!("Update check failed: {}", e)),
                download_url: None,
            })
        }
    }
}

/// Download and install an available update
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| format!("Failed to get updater: {}", e))?;

    match updater.check().await {
        Ok(Some(update)) => {
            // Download the update
            let mut downloaded = 0;
            let mut total = 0;

            update
                .download_and_install(
                    |chunk_length, content_length| {
                        downloaded += chunk_length;
                        total = content_length.unwrap_or(0);
                        // Progress could be emitted here if needed
                        let _ = (downloaded, total);
                    },
                    || {
                        // Called before install - app will restart
                    },
                )
                .await
                .map_err(|e| format!("Failed to download and install update: {}", e))?;

            Ok(())
        }
        Ok(None) => Err("No update available".to_string()),
        Err(e) => Err(format!("Failed to check for updates: {}", e)),
    }
}
