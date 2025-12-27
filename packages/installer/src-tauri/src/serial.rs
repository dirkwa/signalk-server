use crate::SerialPortInfo;

pub fn list_ports() -> Vec<SerialPortInfo> {
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        match serialport::available_ports() {
            Ok(ports) => ports
                .into_iter()
                .map(|p| {
                    let (description, manufacturer) = match p.port_type {
                        serialport::SerialPortType::UsbPort(info) => {
                            let desc = info.product.unwrap_or_else(|| "USB Serial Device".to_string());
                            let mfr = info.manufacturer;
                            (desc, mfr)
                        }
                        serialport::SerialPortType::PciPort => {
                            ("PCI Serial Device".to_string(), None)
                        }
                        serialport::SerialPortType::BluetoothPort => {
                            ("Bluetooth Serial Device".to_string(), None)
                        }
                        serialport::SerialPortType::Unknown => {
                            ("Serial Device".to_string(), None)
                        }
                    };
                    SerialPortInfo {
                        path: p.port_name,
                        description,
                        manufacturer,
                    }
                })
                .collect()
        }
        Err(_) => Vec::new(),
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    Vec::new()
}
