# Signal K WASM Plugin Development Guide

## Overview

This guide covers how to develop WASM/WASIX plugins for Signal K Server 3.0. WASM plugins run in a secure sandbox with isolated storage and capability-based permissions.

## Language Options

Signal K Server 3.0 supports multiple languages for WASM plugin development:

- **AssemblyScript** - TypeScript-like syntax, easiest for JS/TS developers, smallest binaries (3-10 KB)
- **Rust** - Best performance and tooling, medium binaries (50-200 KB)
- **Other languages** - C++, Go, Python support coming in future phases

## Prerequisites

### For AssemblyScript Plugins

- Node.js >= 20
- npm or yarn
- AssemblyScript: `npm install --save-dev assemblyscript`

### For Rust Plugins

- Rust toolchain: `rustup`
- `wasm32-wasi` target: `rustup target add wasm32-wasi`

## Why WASM Plugins?

### Benefits

✅ **Security**: Sandboxed execution with no access to host system
✅ **Hot-reload**: Update plugins without server restart
✅ **Multi-language**: Write plugins in Rust, AssemblyScript, and more
✅ **Crash isolation**: Plugin crashes don't affect server
✅ **Performance**: Near-native performance with WASM
✅ **Small binaries**: 3-200 KB depending on language

### Limitations (Phase 1)

⚠️ **Limited API Surface**: Subset of ServerAPI (delta, config, status, data read)
⚠️ **No REST APIs**: Cannot register custom HTTP endpoints yet (Phase 2)
⚠️ **No Serial Ports**: Direct serial access not available yet (Phase 3)

## Choose Your Language

### AssemblyScript - Recommended for JS/TS Developers

**Best for:**
- Quick prototypes
- Simple data processing
- Migrating existing Node.js plugins
- Developers familiar with TypeScript

**Pros:**
- TypeScript-like syntax
- Fast development
- Smallest binaries (3-10 KB)
- Familiar tooling (npm)

**Cons:**
- Smaller ecosystem than Rust
- Some TypeScript features unavailable
- Manual memory management

👉 **[Jump to AssemblyScript Guide](#creating-assemblyscript-plugins)**

### Rust - Recommended for Performance-Critical Plugins

**Best for:**
- Performance-critical plugins
- Complex algorithms
- Low-level operations
- Production plugins

**Pros:**
- Best performance
- Memory safety
- Rich ecosystem
- Strong typing

**Cons:**
- Steeper learning curve
- Longer compile times
- Larger binaries (50-200 KB)

👉 **[Jump to Rust Guide](#creating-rust-plugins)**

---

## Creating AssemblyScript Plugins

### Step 1: Install SDK

```bash
npm install @signalk/assemblyscript-plugin-sdk
npm install --save-dev assemblyscript
```

### Step 2: Create Plugin File

Create `assembly/index.ts`:

```typescript
import {
  Plugin,
  Delta,
  Update,
  PathValue,
  Source,
  emit,
  setStatus,
  getCurrentTimestamp
} from '@signalk/assemblyscript-plugin-sdk'

export class MyPlugin extends Plugin {
  id(): string {
    return 'my-plugin'
  }

  name(): string {
    return 'My AssemblyScript Plugin'
  }

  schema(): string {
    return `{
      "type": "object",
      "properties": {
        "updateRate": {
          "type": "number",
          "default": 1000
        }
      }
    }`
  }

  start(config: string): i32 {
    setStatus('Started')

    // Emit a test delta
    const source = new Source(this.id(), 'plugin')
    const timestamp = getCurrentTimestamp()
    const pathValue = new PathValue('test.value', '"hello"')
    const update = new Update(source, timestamp, [pathValue])
    const delta = new Delta('vessels.self', [update])
    emit(delta)

    return 0 // Success
  }

  stop(): i32 {
    setStatus('Stopped')
    return 0
  }
}

// Export for Signal K
const plugin = new MyPlugin()
export function plugin_id(): string { return plugin.id() }
export function plugin_name(): string { return plugin.name() }
export function plugin_schema(): string { return plugin.schema() }
export function plugin_start(configPtr: usize, configLen: usize): i32 {
  const configBytes = new Uint8Array(configLen)
  for (let i = 0; i < configLen; i++) {
    configBytes[i] = load<u8>(configPtr + i)
  }
  const configJson = String.UTF8.decode(configBytes.buffer)
  return plugin.start(configJson)
}
export function plugin_stop(): i32 { return plugin.stop() }
```

### Step 3: Configure Build

Create `asconfig.json`:

```json
{
  "targets": {
    "release": {
      "outFile": "plugin.wasm",
      "optimize": true,
      "shrinkLevel": 2
    }
  }
}
```

### Step 4: Build

```bash
npx asc assembly/index.ts --target release
```

### Step 5: Create package.json

```json
{
  "name": "@signalk/my-plugin",
  "version": "0.1.0",
  "keywords": [
    "signalk-node-server-plugin",
    "signalk-wasm-plugin"
  ],
  "wasmManifest": "plugin.wasm",
  "wasmCapabilities": {
    "dataRead": true,
    "dataWrite": true,
    "storage": "vfs-only"
  }
}
```

### Step 6: Install to Signal K

```bash
mkdir -p ~/.signalk/node_modules/@signalk/my-plugin
cp plugin.wasm package.json ~/.signalk/node_modules/@signalk/my-plugin/
```

📚 **See [AssemblyScript SDK README](../packages/assemblyscript-plugin-sdk/README.md) for full API reference**

📁 **See [hello-assemblyscript example](../examples/wasm-plugins/hello-assemblyscript/) for complete working code**

---

## Creating Rust Plugins

### Step 1: Project Structure

Create a new Rust library project:

```bash
cargo new --lib signalk-example-wasm
cd signalk-example-wasm
```

### Step 2: Configure Cargo.toml

```toml
[package]
name = "signalk-example-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

[profile.release]
opt-level = "z"     # Optimize for size
lto = true          # Link-time optimization
strip = true        # Strip symbols
```

### Step 3: Implement Plugin (src/lib.rs)

```rust
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Serialize, Deserialize, Default)]
struct PluginConfig {
    update_rate: u32,
}

static mut CONFIG: Option<PluginConfig> = None;

// Plugin exports (called by Signal K server)

#[no_mangle]
pub extern "C" fn id() -> *const u8 {
    let id = "example-wasm\0";
    id.as_ptr()
}

#[no_mangle]
pub extern "C" fn name() -> *const u8 {
    let name = "Example WASM Plugin\0";
    name.as_ptr()
}

#[no_mangle]
pub extern "C" fn schema() -> *const u8 {
    let schema = json!({
        "type": "object",
        "properties": {
            "updateRate": {
                "type": "number",
                "title": "Update Rate (ms)",
                "default": 1000
            }
        }
    }).to_string() + "\0";

    Box::into_raw(schema.into_boxed_str()) as *const u8
}

#[no_mangle]
pub extern "C" fn start(config_ptr: *const u8, config_len: usize) -> i32 {
    let config_json = unsafe {
        std::slice::from_raw_parts(config_ptr, config_len)
    };

    let config_str = std::str::from_utf8(config_json).unwrap();
    let config: PluginConfig = serde_json::from_str(config_str).unwrap_or_default();

    unsafe {
        CONFIG = Some(config);
    }

    // Plugin initialization logic here
    sk_set_status("Started successfully");

    0 // Success
}

#[no_mangle]
pub extern "C" fn stop() -> i32 {
    // Cleanup logic here
    sk_set_status("Stopped");

    0 // Success
}

// Helper functions to call Signal K APIs

fn sk_set_status(message: &str) {
    unsafe {
        sk_set_status_ffi(message.as_ptr(), message.len());
    }
}

fn sk_emit_delta(delta_json: &str) {
    unsafe {
        sk_handle_message(delta_json.as_ptr(), delta_json.len());
    }
}

// FFI imports from Signal K server
extern "C" {
    fn sk_set_status_ffi(msg_ptr: *const u8, msg_len: usize);
    fn sk_handle_message(delta_ptr: *const u8, delta_len: usize);
}
```

### Step 4: Create package.json

```json
{
  "name": "@signalk/example-wasm",
  "version": "0.1.0",
  "description": "Example WASM plugin for Signal K",
  "keywords": [
    "signalk-node-server-plugin",
    "signalk-wasm-plugin"
  ],
  "wasmManifest": "plugin.wasm",
  "wasmCapabilities": {
    "network": false,
    "storage": "vfs-only",
    "dataRead": true,
    "dataWrite": true,
    "serialPorts": false
  },
  "author": "Your Name",
  "license": "Apache-2.0"
}
```

### Step 5: Build

```bash
cargo build --target wasm32-wasi --release
cp target/wasm32-wasi/release/signalk_example_wasm.wasm plugin.wasm
```

### Step 6: Install

Copy to Signal K plugins directory:

```bash
mkdir -p ~/.signalk/node_modules/@signalk/example-wasm
cp plugin.wasm ~/.signalk/node_modules/@signalk/example-wasm/
cp package.json ~/.signalk/node_modules/@signalk/example-wasm/
```

### Step 7: Enable in Admin UI

1. Navigate to **Server** → **Plugin Config**
2. Find "Example WASM Plugin"
3. Click **Enable**
4. Configure settings
5. Click **Submit**

## Plugin Capabilities

### Capability Types

Declare required capabilities in `package.json`:

| Capability | Description | Phase 1 |
|------------|-------------|---------|
| `dataRead` | Read Signal K data model | ✅ |
| `dataWrite` | Emit delta messages | ✅ |
| `storage` | Write to VFS (`vfs-only`) | ✅ |
| `network` | HTTP requests | ❌ Phase 2 |
| `serialPorts` | Serial port access | ❌ Phase 3 |
| `putHandlers` | Register PUT handlers | ❌ Phase 2 |

### Storage API

Plugins have access to isolated virtual filesystem:

```rust
use std::fs;

fn save_state() {
    // Plugin sees "/" as its VFS root
    fs::write("/data/state.json", state_json).unwrap();
}

fn load_state() -> String {
    fs::read_to_string("/data/state.json").unwrap_or_default()
}
```

**VFS Structure:**
```
/ (VFS root)
├── data/      # Persistent storage
├── config/    # Plugin-managed config
└── tmp/       # Temporary files
```

### Delta Emission

Emit delta messages to update Signal K data:

```rust
fn emit_position_delta() {
    let delta = json!({
        "context": "vessels.self",
        "updates": [{
            "source": {
                "label": "example-wasm",
                "type": "plugin"
            },
            "timestamp": "2025-12-01T10:00:00.000Z",
            "values": [{
                "path": "navigation.position",
                "value": {
                    "latitude": 60.1,
                    "longitude": 24.9
                }
            }]
        }]
    });

    sk_emit_delta(&delta.to_string());
}
```

### Reading Data

Read from Signal K data model:

```rust
fn get_vessel_speed() -> Option<f64> {
    let mut buffer = vec![0u8; 1024];
    let len = unsafe {
        sk_get_self_path(
            "navigation.speedOverGround".as_ptr(),
            "navigation.speedOverGround".len(),
            buffer.as_mut_ptr(),
            buffer.len()
        )
    };

    if len == 0 {
        return None;
    }

    let json_str = std::str::from_utf8(&buffer[..len]).ok()?;
    let value: f64 = serde_json::from_str(json_str).ok()?;
    Some(value)
}
```

## Hot Reload

WASM plugins support hot-reload without server restart:

### Manual Reload

1. Build new WASM binary: `cargo build --target wasm32-wasi --release`
2. Copy to plugin directory: `cp target/.../plugin.wasm ~/.signalk/...`
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

## Best Practices

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

1. Build with debug symbols: `cargo build --target wasm32-wasi`
2. Use `wasmtime` for local testing:

```bash
wasmtime --dir /tmp::/ plugin.wasm
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
- ❌ Registers REST endpoints (wait for Phase 2)
- ❌ Uses serial ports (wait for Phase 3)
- ❌ Makes network requests (wait for Phase 2)

### 2. Port Logic to Rust

Convert TypeScript/JavaScript logic to Rust:

**Before (Node.js):**
```javascript
plugin.start = function(config) {
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

Minimal example that emits a delta on start:

[See Step 3 above]

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

## Resources

- **WIT Interface**: `packages/server-api/wit/signalk.wit`
- **Example Plugins**: `examples/wasm/` (coming soon)
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
