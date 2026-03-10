/**
 * Bluetooth SIG assigned company identifiers (16-bit).
 * Focused on manufacturers relevant to marine/IoT use.
 * Full list: https://www.bluetooth.com/specifications/assigned-numbers/
 */
const BLE_COMPANY_IDS: Record<number, string> = {
  0x0006: 'Microsoft',
  0x004c: 'Apple',
  0x0059: 'Nordic Semiconductor',
  0x0075: 'Samsung',
  0x00e0: 'Google',
  0x01d3: 'Garmin',
  0x01f5: 'FLIR Systems',
  0x0499: 'Ruuvi Innovations', // RuuviTag environmental sensor
  0x059d: 'Mopeka Products', // Mopeka tank sensors
  0x02e1: 'Victron Energy', // Victron solar, battery, inverter, DCDC
  0x06d5: 'Shelly', // Shelly BLE devices
  0x0ba7: 'Govee', // Govee sensors
  0x0dbb: 'Calypso Instruments', // Calypso ultrasonic wind sensor
  0x0222: 'Sominex', // Aranet sensors
  0x0822: 'Aranet',
  0x08d3: 'Xiaomi',
  0x048f: 'Switchbot',
  0x0969: 'Switchbot', // SwitchBot T&H (company ID used in advertisements)
  0x094f: 'Mikrotik' // MikroTik asset tags
}

/**
 * Returns a vendor name for the given 16-bit Bluetooth company ID,
 * or undefined if unknown.
 */
export function bleVendorName(companyId: number): string | undefined {
  return BLE_COMPANY_IDS[companyId]
}
