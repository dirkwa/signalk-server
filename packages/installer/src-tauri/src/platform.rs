use crate::PlatformInfo;

pub fn get_info() -> PlatformInfo {
    #[cfg(target_os = "linux")]
    {
        PlatformInfo {
            os: "linux".to_string(),
            service_manager: "systemd (user)".to_string(),
            requires_admin: false, // User-level systemd service
        }
    }

    #[cfg(target_os = "macos")]
    {
        PlatformInfo {
            os: "macos".to_string(),
            service_manager: "launchd (user agent)".to_string(),
            requires_admin: false,
        }
    }

    #[cfg(target_os = "windows")]
    {
        PlatformInfo {
            os: "windows".to_string(),
            service_manager: "Task Scheduler".to_string(),
            requires_admin: false, // Task for current user
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        PlatformInfo {
            os: "unknown".to_string(),
            service_manager: "none".to_string(),
            requires_admin: false,
        }
    }
}

#[cfg(target_os = "linux")]
pub fn create_systemd_service(config_path: &str, node_path: &str, server_path: &str) -> Result<String, String> {
    let service_content = format!(
        r#"[Unit]
Description=SignalK Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={node_path} {server_path} -c {config_path}
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=SIGNALK_MANAGED_INSTALL=true

[Install]
WantedBy=default.target
"#,
        node_path = node_path,
        server_path = server_path,
        config_path = config_path,
    );

    Ok(service_content)
}

#[cfg(target_os = "macos")]
pub fn create_launchd_plist(config_path: &str, node_path: &str, server_path: &str) -> Result<String, String> {
    let plist_content = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>org.signalk.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>{node_path}</string>
        <string>{server_path}</string>
        <string>-c</string>
        <string>{config_path}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>SIGNALK_MANAGED_INSTALL</key>
        <string>true</string>
    </dict>
</dict>
</plist>
"#,
        node_path = node_path,
        server_path = server_path,
        config_path = config_path,
    );

    Ok(plist_content)
}

#[cfg(target_os = "windows")]
pub fn create_task_xml(config_path: &str, node_path: &str, server_path: &str, user: &str) -> Result<String, String> {
    let task_content = format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>SignalK Server</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{user}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{node_path}</Command>
      <Arguments>{server_path} -c {config_path}</Arguments>
    </Exec>
  </Actions>
</Task>
"#,
        user = user,
        node_path = node_path,
        server_path = server_path,
        config_path = config_path,
    );

    Ok(task_content)
}
