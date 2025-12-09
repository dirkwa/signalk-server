---
title: Best Practices
---

# Best Practices

## Hot Reload

WASM plugins support hot-reload without server restart:

### Manual Reload

1. Build new WASM binary: `cargo build --target wasm32-wasip1 --release`
2. Copy to plugin directory: `cp target/wasm32-wasip1/release/*.wasm ~/.signalk/...`
3. In Admin UI: **Server** → **Plugin Config** → Click **Reload** button

### Automatic Reload

Server can watch for `.wasm` file changes and auto-reload (coming soon).

### Reload Behavior

During reload:

- `stop()` is called on old instance
- Subscriptions are preserved
- Deltas are buffered (not lost)
- New instance is loaded
- `start()` is called with saved config
- Buffered deltas are replayed

## Error Handling

### Crash Recovery

If a WASM plugin crashes:

1. **First crash**: Automatic restart after 1 second
2. **Second crash**: Restart after 2 seconds
3. **Third crash**: Restart after 4 seconds
4. **After 3 crashes**: Plugin disabled, admin notification

### Error Reporting

Report errors to admin UI:

```rust
fn handle_error(err: &str) {
    sk_set_error(&format!("Error: {}", err));
}
```

## Optimization

### 1. Minimize Binary Size

```toml
[profile.release]
opt-level = "z"     # Optimize for size
lto = true          # Enable link-time optimization
strip = true        # Strip debug symbols
```

Use `wasm-opt` for further optimization:

```bash
wasm-opt -Oz plugin.wasm -o plugin.wasm
```

### 2. Handle Errors Gracefully

```rust
fn start(config_ptr: *const u8, config_len: usize) -> i32 {
    match initialize_plugin(config_ptr, config_len) {
        Ok(_) => {
            sk_set_status("Started");
            0 // Success
        }
        Err(e) => {
            sk_set_error(&format!("Failed to start: {}", e));
            1 // Error
        }
    }
}
```

### 3. Use Efficient JSON Parsing

```rust
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct Config {
    #[serde(default)]
    enabled: bool,
}

fn parse_config(json: &str) -> Result<Config, serde_json::Error> {
    serde_json::from_str(json)
}
```

### 4. Limit Memory Usage

- Avoid large allocations
- Clear buffers after use
- Use streaming for large data

### 5. Provide Good UX

- Clear status messages
- Descriptive error messages
- Comprehensive JSON schema for configuration

## Debugging

### Logging

```rust
fn debug_log(message: &str) {
    unsafe {
        sk_debug(message.as_ptr(), message.len());
    }
}
```

### Testing Locally

1. Build with debug symbols: `cargo build --target wasm32-wasip1`
2. Use `wasmtime` for local testing:

```bash
wasmtime --dir /tmp::/ plugin.wasm
```

### Enable Server Debug Logging

```bash
# Linux/macOS
DEBUG=signalk:wasm:* signalk-server

# Or with systemd
journalctl -u signalk -f | grep wasm
```

### Common Issues

**Issue**: Plugin doesn't load
**Solution**: Check `wasmManifest` path in package.json

**Issue**: Capability errors
**Solution**: Ensure required capabilities declared in package.json

**Issue**: Crashes on start
**Solution**: Check server logs for error details

## Migration from Node.js

### 1. Assess Compatibility

Check if your plugin:

- ✅ Processes deltas
- ✅ Reads/writes configuration
- ✅ Uses data model APIs
- ✅ Registers REST endpoints
- ❌ Uses serial ports (wait for Phase 3)
- ✅ Makes network requests

### 2. Port Logic to Rust

Convert TypeScript/JavaScript logic to Rust:

**Before (Node.js):**

```javascript
plugin.start = function (config) {
  app.handleMessage('my-plugin', {
    updates: [{ values: [{ path: 'foo', value: 'bar' }] }]
  })
}
```

**After (WASM/Rust):**

```rust
fn start(config_ptr: *const u8, config_len: usize) -> i32 {
    let delta = json!({
        "updates": [{ "values": [{ "path": "foo", "value": "bar" }] }]
    });
    sk_emit_delta(&delta.to_string());
    0
}
```

### 3. Migrate Data

Use migration helper to copy existing data to VFS:

```rust
fn first_run_migration() {
    // Server provides migration API
    // Copies files from ~/.signalk/plugin-config-data/{id}/
    // to ~/.signalk/plugin-config-data/{id}/vfs/data/
}
```

## Example Plugins

### Hello World

Minimal example that emits a delta on start - see the [AssemblyScript guide](assemblyscript.md) Step 3.

### Data Logger

Logs vessel data to VFS:

```rust
use std::fs::OpenOptions;
use std::io::Write;

fn log_data(path: &str, value: &str) {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open("/data/log.csv")
        .unwrap();

    let timestamp = get_current_timestamp();
    writeln!(file, "{},{},{}", timestamp, path, value).unwrap();
}
```

### Derived Data Calculator

Calculates derived values from sensor data:

```rust
fn calculate_true_wind() {
    let aws = get_self_path("environment.wind.speedApparent");
    let awa = get_self_path("environment.wind.angleApparent");
    let sog = get_self_path("navigation.speedOverGround");
    let cog = get_self_path("navigation.courseOverGroundTrue");

    if let (Some(aws), Some(awa), Some(sog), Some(cog)) = (aws, awa, sog, cog) {
        let (tws, twa) = calculate_true_wind_values(aws, awa, sog, cog);
        emit_true_wind_delta(tws, twa);
    }
}
```

## Advanced Features

### Static File Serving

Plugins can serve HTML, CSS, JavaScript and other static files:

**Structure:**

```
@signalk/my-plugin/
├── public/           # Automatically served at /plugins/my-plugin/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── plugin.wasm
└── package.json
```

**Access:** `http://localhost:3000/plugins/my-plugin/` serves `public/index.html`

### Privileged Operations (Optional)

**⚠️ Only required if your plugin needs to execute shell commands**

If your plugin needs to read logs or execute system commands, follow these steps:

#### 1. Add FFI Declaration

Add this **at the top** of your AssemblyScript plugin file:

```typescript
// FFI import from Signal K server (only if you need shell commands)
@external("env", "sk_exec_command")
declare function sk_exec_command_ffi(
  cmdPtr: usize,
  cmdLen: usize,
  outPtr: usize,
  outMaxLen: usize
): i32
```

#### 2. Create Helper Function

Add a helper to call the FFI function safely:

```typescript
function execCommand(command: string, maxOutput: i32 = 102400): string {
  const cmdBuffer = String.UTF8.encode(command)
  const outputBuffer = new ArrayBuffer(maxOutput)

  const bytesRead = sk_exec_command_ffi(
    changetype<usize>(cmdBuffer),
    cmdBuffer.byteLength,
    changetype<usize>(outputBuffer),
    maxOutput
  )

  if (bytesRead === 0) {
    return '' // Command failed or not allowed
  }

  return String.UTF8.decode(outputBuffer, bytesRead)
}
```

#### 3. Use It

```typescript
// Example: Read logs with journalctl
function readSystemLogs(lines: i32 = 100): string {
  return execCommand(`journalctl -u signalk -n ${lines}`)
}
```

#### 4. Recompile

After adding the FFI declaration, **recompile your WASM module**:

```bash
npm run asbuild
```

**Allowed Commands (Whitelisted for Security):**

- `journalctl -u signalk*` - Read SignalK service logs
- `cat /var/log/*` - Read log files
- `tail -n <N> /*` - Tail log files

⚠️ Other commands return empty string for security. If you need additional commands, request them via GitHub issue.

## Resource Providers

WASM plugins can act as **resource providers** for Signal K resources like weather data, routes, waypoints, or custom resource types.

### Enabling Resource Provider Capability

Add `resourceProvider: true` to your package.json:

```json
{
  "wasmCapabilities": {
    "network": true,
    "dataRead": true,
    "dataWrite": true,
    "resourceProvider": true
  }
}
```

### Registering as a Resource Provider

#### AssemblyScript

```typescript
import { registerResourceProvider } from 'signalk-assemblyscript-plugin-sdk/assembly/resources'

// In plugin start():
if (!registerResourceProvider('weather-forecasts')) {
  setError('Failed to register as resource provider')
  return 1
}
```

#### Rust

```rust
#[link(wasm_import_module = "env")]
extern "C" {
    fn sk_register_resource_provider(type_ptr: *const u8, type_len: usize) -> i32;
}

pub fn register_resource_provider(resource_type: &str) -> bool {
    let bytes = resource_type.as_bytes();
    unsafe { sk_register_resource_provider(bytes.as_ptr(), bytes.len()) == 1 }
}

// In plugin_start():
if !register_resource_provider("weather-forecasts") {
    // Registration failed
    return 1;
}
```

### Implementing Resource Handlers

After registering, your plugin must export these handler functions:

#### `resource_list` - List resources matching a query

**AssemblyScript:**

```typescript
export function resource_list(queryJson: string): string {
  // queryJson: {"bbox": [...], "distance": 1000, ...}
  // Return JSON object: {"resource-id-1": {...}, "resource-id-2": {...}}
  return '{"forecast-1": {"name": "Current Weather", "type": "weather"}}'
}
```

**Rust:**

```rust
#[no_mangle]
pub extern "C" fn resource_list(
    request_ptr: *const u8, request_len: usize,
    response_ptr: *mut u8, response_max_len: usize,
) -> i32 {
    // Parse query, build response
    let response = r#"{"forecast-1": {"name": "Current Weather"}}"#;
    write_string(response, response_ptr, response_max_len)
}
```

#### `resource_get` - Get a single resource

**AssemblyScript:**

```typescript
export function resource_get(requestJson: string): string {
  // requestJson: {"id": "forecast-1", "property": null}
  return '{"name": "Current Weather", "temperature": 20.5, "humidity": 0.65}'
}
```

#### `resource_set` - Create or update a resource

**AssemblyScript:**

```typescript
export function resource_set(requestJson: string): string {
  // requestJson: {"id": "forecast-1", "value": {...}}
  // Return empty string on success, or error message
  return ''
}
```

#### `resource_delete` - Delete a resource

**AssemblyScript:**

```typescript
export function resource_delete(requestJson: string): string {
  // requestJson: {"id": "forecast-1"}
  return ''
}
```

### Accessing Resources via HTTP

Once registered, resources are available at:

```
GET  /signalk/v2/api/resources/{type}           # List all
GET  /signalk/v2/api/resources/{type}/{id}      # Get one
POST /signalk/v2/api/resources/{type}/{id}      # Create/update
DELETE /signalk/v2/api/resources/{type}/{id}    # Delete
```

### Standard vs Custom Resource Types

Signal K defines standard resource types with validation:

- `routes` - Navigation routes
- `waypoints` - Navigation waypoints
- `notes` - Freeform notes
- `regions` - Geographic regions
- `charts` - Chart metadata

Custom types (like `weather-forecasts`) have no schema validation and can contain any JSON structure.

## Weather Providers

WASM plugins can act as **weather providers** for Signal K's specialized Weather API.

### Weather Provider vs Resource Provider

| Feature    | Weather Provider                           | Resource Provider                  |
| ---------- | ------------------------------------------ | ---------------------------------- |
| API Path   | `/signalk/v2/api/weather/*`                | `/signalk/v2/api/resources/{type}` |
| Methods    | getObservations, getForecasts, getWarnings | list, get, set, delete             |
| Use Case   | Standardized weather data                  | Generic data storage               |
| Capability | `weatherProvider: true`                    | `resourceProvider: true`           |
| FFI        | `sk_register_weather_provider`             | `sk_register_resource_provider`    |

### Enabling Weather Provider Capability

```json
{
  "wasmCapabilities": {
    "network": true,
    "dataWrite": true,
    "weatherProvider": true
  }
}
```

### Implementing Weather Handler Exports

Your plugin must export these handler functions:

#### `weather_get_observations` - Get current weather observations

```typescript
export function weather_get_observations(requestJson: string): string {
  // requestJson: {"position": {"latitude": 60.17, "longitude": 24.94}, "options": {...}}
  return (
    '[{"date":"2025-01-01T00:00:00Z","type":"observation","description":"Clear sky",' +
    '"outside":{"temperature":280.15,"relativeHumidity":0.65,"pressure":101300,"cloudCover":0.1},' +
    '"wind":{"speedTrue":5.0,"directionTrue":1.57}}]'
  )
}
```

#### `weather_get_forecasts` - Get weather forecasts

```typescript
export function weather_get_forecasts(requestJson: string): string {
  // requestJson: {"position": {...}, "type": "daily"|"point", "options": {"maxCount": 7}}
  return '[{"date":"...","type":"daily","outside":{...},"wind":{...}}]'
}
```

#### `weather_get_warnings` - Get weather warnings/alerts

```typescript
export function weather_get_warnings(requestJson: string): string {
  // requestJson: {"position": {...}}
  return '[]'
}
```

### Weather Data Format

#### Observation/Forecast Object

```json
{
  "date": "2025-12-05T10:00:00.000Z",
  "type": "observation",
  "description": "light rain",
  "outside": {
    "temperature": 275.15,
    "minTemperature": 273.0,
    "maxTemperature": 278.0,
    "feelsLikeTemperature": 272.0,
    "relativeHumidity": 0.85,
    "pressure": 101300,
    "cloudCover": 0.75
  },
  "wind": {
    "speedTrue": 5.2,
    "directionTrue": 3.14,
    "gust": 8.0
  }
}
```

Units:

- Temperature: Kelvin
- Humidity: Ratio (0-1)
- Pressure: Pascals
- Wind speed: m/s
- Wind direction: Radians

#### Warning Object

```json
{
  "startTime": "2025-12-05T10:00:00.000Z",
  "endTime": "2025-12-05T18:00:00.000Z",
  "details": "Strong wind warning",
  "source": "Weather Service",
  "type": "Warning"
}
```

### Accessing Weather Data via HTTP

```bash
# List providers
curl http://localhost:3000/signalk/v2/api/weather/_providers

# Get observations for a location
curl "http://localhost:3000/signalk/v2/api/weather/observations?lat=60.17&lon=24.94"

# Get daily forecasts
curl "http://localhost:3000/signalk/v2/api/weather/forecasts/daily?lat=60.17&lon=24.94"

# Get point-in-time forecasts
curl "http://localhost:3000/signalk/v2/api/weather/forecasts/point?lat=60.17&lon=24.94"

# Get weather warnings
curl "http://localhost:3000/signalk/v2/api/weather/warnings?lat=60.17&lon=24.94"
```

## Radar Providers

WASM plugins can act as **radar providers** for Signal K's Radar API at `/signalk/v2/api/vessels/self/radars`.

### Enabling Radar Provider Capability

```json
{
  "signalk": {
    "wasmCapabilities": {
      "radarProvider": true,
      "network": true
    }
  }
}
```

### Registering as a Radar Provider

```typescript
// Declare the host function
@external("env", "sk_register_radar_provider")
declare function sk_register_radar_provider(namePtr: usize, nameLen: i32): i32;

export function start(configJson: string): i32 {
  const name = "My Radar Plugin";
  const nameBytes = String.UTF8.encode(name);
  const result = sk_register_radar_provider(
    changetype<usize>(nameBytes),
    nameBytes.byteLength
  );

  if (result === 0) {
    sk_set_plugin_error("Failed to register as radar provider", 38);
    return 1;
  }

  return 0;
}
```

### Required Handler Exports

```typescript
// Return JSON array of radar IDs this provider manages
export function radar_get_radars(): string {
  return JSON.stringify(['radar-0', 'radar-1'])
}

// Return RadarInfo JSON for a specific radar
export function radar_get_info(requestJson: string): string {
  const info = {
    id: 'radar-0',
    name: 'Furuno DRS4D-NXT',
    brand: 'Furuno',
    status: 'transmit',
    spokesPerRevolution: 2048,
    maxSpokeLen: 1024,
    range: 2000,
    controls: {
      gain: { auto: false, value: 50 },
      sea: { auto: true, value: 30 }
    }
  }
  return JSON.stringify(info)
}
```

### RadarInfo Interface

```typescript
interface RadarInfo {
  id: string // Unique radar ID
  name: string // Display name
  brand?: string // Manufacturer
  status: 'off' | 'standby' | 'transmit' | 'warming'
  spokesPerRevolution: number // Spokes per rotation
  maxSpokeLen: number // Max spoke samples
  range: number // Current range (meters)
  controls: RadarControls // Current control values
  legend?: LegendEntry[] // Color legend for display
  streamUrl?: string // Optional external WebSocket URL
}
```

### Streaming Radar Spokes

Radar spoke data arrives at ~60Hz (2048 spokes/rotation × 30-60 RPM). Plugins stream binary protobuf data directly to clients:

```typescript
import { sk_radar_emit_spokes } from './signalk-api'

// Called when spoke data received via UDP multicast
function processSpokeData(radarId: string, spokeProtobuf: Uint8Array): void {
  sk_radar_emit_spokes(radarId, spokeProtobuf.buffer, spokeProtobuf.byteLength)
}
```

Clients connect to the WebSocket stream:

```javascript
const wsUrl = `ws://${location.host}/signalk/v2/api/vessels/self/radars/radar-0/stream`
const ws = new WebSocket(wsUrl)
ws.binaryType = 'arraybuffer'

ws.onmessage = (event) => {
  const spokeData = new Uint8Array(event.data)
  // Decode and render spoke
}
```

## Resources

- **WIT Interface**: `packages/server-api/wit/signalk.wit`
- **Example Plugins**: `examples/wasm-plugins/`
- **Rust WASM Book**: https://rustwasm.github.io/docs/book/
- **Signal K Documentation**: https://signalk.org/

## Support

- GitHub Issues: https://github.com/SignalK/signalk-server/issues
- Slack: #developers channel
- Forum: https://github.com/SignalK/signalk-server/discussions

## Next Steps

1. Build your first WASM plugin
2. Test hot-reload functionality
3. Optimize for size and performance
4. Publish to NPM with `signalk-wasm-plugin` keyword
5. Share with the community!
