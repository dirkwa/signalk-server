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

### Current Capabilities (Phase 2)

✅ **Delta Emission**: Send SignalK deltas to update vessel data
✅ **Status & Error Reporting**: Set plugin status and error messages
✅ **Configuration**: JSON schema-based configuration
✅ **Data Storage**: VFS-isolated file storage
✅ **HTTP Endpoints**: Register custom REST API endpoints
✅ **Static Files**: Serve web UI from `public/` directory
✅ **Command Execution**: Whitelisted shell commands (logs only)

### Upcoming Features

⏳ **Direct Serial Ports**: Serial device access (Phase 3)
⏳ **Network Access**: HTTP client for external APIs (Phase 3)
⏳ **Resource Providers**: Serve SignalK resources (Phase 3)

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
      "shrinkLevel": 2,
      "converge": true,
      "noAssert": true,
      "runtime": "incremental",
      "exportRuntime": true
    },
    "debug": {
      "outFile": "build/plugin.debug.wasm",
      "sourceMap": true,
      "debug": true,
      "runtime": "incremental",
      "exportRuntime": true
    }
  },
  "options": {
    "bindings": "esm"
  }
}
```

**Important**: `exportRuntime: true` is **required** for the AssemblyScript loader to work. This exports runtime helper functions like `__newString` and `__getString` that the server uses for automatic string conversions.

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

**Option 1: Direct Copy (Recommended for Development)**
```bash
mkdir -p ~/.signalk/node_modules/@signalk/my-plugin
cp plugin.wasm package.json ~/.signalk/node_modules/@signalk/my-plugin/

# If your plugin has a public/ folder with web UI:
cp -r public ~/.signalk/node_modules/@signalk/my-plugin/
```

**Option 2: NPM Package Install**
```bash
# If you've packaged with `npm pack`
npm install -g ./my-plugin-1.0.0.tgz

# Or install from npm registry
npm install -g @signalk/my-plugin
```

**Note**: For WASM plugins, both methods work identically. Direct copy is faster for development/testing. Use npm install for production deployments or when distributing plugins.

**Important**: If your plugin includes static files (like a web UI in the `public/` folder), make sure to copy that folder as well. Static files are automatically served at `/plugins/your-plugin-id/` when the plugin is loaded.

📚 **See [AssemblyScript SDK README](../packages/assemblyscript-plugin-sdk/README.md) for full API reference**

📁 **See [hello-assemblyscript example](../examples/wasm-plugins/hello-assemblyscript/) for complete working code**

### Step 7: Verify Plugin Configuration in Admin UI

After installing your plugin, verify it appears in the Admin UI:

1. **Navigate to Plugin Configuration**: Open the Admin UI at `http://your-server:3000/@signalk/server-admin-ui/` and go to **Server → Plugin Config**

2. **Check Plugin List**: Your WASM plugin should appear in the list with:
   - Plugin name (from `name()` export)
   - Version (from `package.json`)
   - Enable/Disable toggle
   - Configuration form (based on `schema()` export)

3. **Verify Configuration Persistence**:
   - Configuration is saved to `~/.signalk/plugin-config-data/your-plugin-id.json`
   - Changes are applied immediately (plugin restarts automatically)
   - The file structure is:
     ```json
     {
       "enabled": true,
       "enableDebug": false,
       "configuration": {
         "updateRate": 1000
       }
     }
     ```

4. **Troubleshooting**:
   - If plugin doesn't appear: Check `package.json` has both `signalk-node-server-plugin` and `signalk-wasm-plugin` keywords
   - If configuration form is empty: Verify `schema()` export returns valid JSON Schema
   - If settings don't persist: Check file permissions on `~/.signalk/plugin-config-data/`

**Important**: The Admin UI shows all plugins (both Node.js and WASM) in a unified list. WASM plugins integrate seamlessly with the existing plugin configuration system.

---

## HTTP Endpoints (Phase 2)

WASM plugins can register custom HTTP endpoints to provide REST APIs or serve dynamic content. This is useful for:
- Providing plugin-specific APIs
- Implementing webhook receivers
- Creating custom data queries
- Building interactive dashboards

### Registering HTTP Endpoints

Export an `http_endpoints()` function that returns a JSON array of endpoint definitions:

```typescript
// assembly/index.ts
export function http_endpoints(): string {
  return `[
    {
      "method": "GET",
      "path": "/api/data",
      "handler": "handle_get_data"
    },
    {
      "method": "POST",
      "path": "/api/update",
      "handler": "handle_post_update"
    }
  ]`
}
```

### Implementing HTTP Handlers

Handler functions receive a request context and return an HTTP response:

```typescript
export function handle_get_data(requestPtr: usize, requestLen: usize): string {
  // 1. Decode request from WASM memory
  const requestBytes = new Uint8Array(i32(requestLen))
  for (let i: i32 = 0; i < i32(requestLen); i++) {
    requestBytes[i] = load<u8>(requestPtr + <usize>i)
  }
  const requestJson = String.UTF8.decode(requestBytes.buffer)

  // 2. Parse request (contains method, path, query, params, body, headers)
  // Simple example: extract query parameter
  let filter = ''
  const filterIndex = requestJson.indexOf('"filter"')
  if (filterIndex >= 0) {
    // Extract the filter value from JSON
    // (In production, use proper JSON parsing)
  }

  // 3. Process request and build response data
  const data = {
    "items": [
      {"id": 1, "value": "Item 1"},
      {"id": 2, "value": "Item 2"}
    ],
    "count": 2
  }
  const bodyJson = JSON.stringify(data)

  // 4. Escape JSON for embedding in response string
  const escapedBody = bodyJson
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')

  // 5. Return HTTP response (status, headers, body)
  return `{
    "statusCode": 200,
    "headers": {"Content-Type": "application/json"},
    "body": "${escapedBody}"
  }`
}

export function handle_post_update(requestPtr: usize, requestLen: usize): string {
  const requestBytes = new Uint8Array(i32(requestLen))
  for (let i: i32 = 0; i < i32(requestLen); i++) {
    requestBytes[i] = load<u8>(requestPtr + <usize>i)
  }
  const requestJson = String.UTF8.decode(requestBytes.buffer)

  // Process POST body and update state
  // ...

  return `{
    "statusCode": 200,
    "headers": {"Content-Type": "application/json"},
    "body": "{\\"success\\":true}"
  }`
}
```

### Request Context Format

The request context is a JSON object with:

```json
{
  "method": "GET",
  "path": "/api/logs",
  "query": {
    "lines": "100",
    "filter": "error"
  },
  "params": {},
  "body": null,
  "headers": {
    "user-agent": "Mozilla/5.0...",
    "accept": "application/json"
  }
}
```

### Response Format

Handler functions must return a JSON string with:

```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache"
  },
  "body": "{\"data\": \"value\"}"
}
```

**Important Notes:**
- The `body` field must be a JSON-escaped string
- Use double escaping for quotes: `\\"` not `"`
- Endpoints are mounted at `/plugins/your-plugin-id/api/...`
- From browser, fetch from absolute path: `/plugins/your-plugin-id/api/logs`

### String Memory Management

The server uses the **AssemblyScript loader** for automatic string handling:

**For plugin metadata (id, name, schema, http_endpoints):**
- Return AssemblyScript strings directly
- Server automatically decodes with `__getString()`

**For HTTP handlers:**
- Receive: `(requestPtr: usize, requestLen: usize)` - raw memory pointer
- Manually decode UTF-8 bytes from WASM memory
- Return: AssemblyScript string with escaped JSON
- Server automatically decodes with `__getString()`

**Why manual decoding for handlers?**
The request is passed as raw UTF-8 bytes for efficiency, but the response is returned as an AssemblyScript string (UTF-16LE) which the loader decodes automatically.

### Complete Example

See [signalk-logviewer](../../../signalk-logviewer) for a complete real-world example:
- HTTP endpoint registration
- Shell command execution (journalctl, tail)
- Large response handling
- Web UI integration

### Testing Your Endpoints

```bash
# Test GET endpoint
curl http://localhost:3000/plugins/my-plugin/api/data?filter=test

# Test POST endpoint
curl -X POST http://localhost:3000/plugins/my-plugin/api/update \
  -H "Content-Type: application/json" \
  -d '{"value": 123}'
```

### Security Considerations

- ✅ Endpoints are sandboxed - no direct file system access
- ✅ Shell commands are whitelisted (only journalctl, tail allowed)
- ✅ Memory is isolated - cannot access other plugins
- ⚠️ Validate all input from requests
- ⚠️ Implement authentication if handling sensitive data
- ⚠️ Set appropriate CORS headers if needed

---

## WASM Memory Limitations and Hybrid Architecture

### Understanding WASM Memory Constraints

WASM plugins running in Node.js have **~64KB buffer limitations** for stdin/stdout operations. This is a fundamental limitation of the Node.js WASI implementation, not a Signal K restriction.

**Impact:**
- ✅ Small JSON responses (< 64KB): Work fine in pure WASM
- ⚠️ Medium data (64KB - 1MB): May freeze or fail
- ❌ Large data (> 1MB): Will fail or freeze the server

### Hybrid Architecture Pattern

For plugins that need to handle large data volumes (logs, file streaming, large JSON responses), use a **hybrid approach**:

**Architecture:**
- **WASM Plugin**: Registers HTTP endpoints and provides configuration UI
- **Node.js Handler**: Server intercepts specific endpoints and handles I/O directly in Node.js
- **Result**: Can handle unlimited data without memory constraints

### When to Use Hybrid Architecture

Use this pattern when your plugin needs to:
- Stream large log files (journalctl, syslog)
- Return large JSON responses (> 64KB)
- Process large file uploads
- Handle streaming data

### Implementation Example

**Step 1: Register Endpoint in WASM**

Your WASM plugin registers the endpoint normally:

```typescript
// assembly/index.ts
export function http_endpoints(): string {
  return `[
    {
      "method": "GET",
      "path": "/api/logs",
      "handler": "handle_get_logs"
    }
  ]`
}

export function handle_get_logs(requestPtr: usize, requestLen: usize): string {
  // This handler will be intercepted by Node.js
  // But we need to export it for the WASM module to be valid
  return `{
    "statusCode": 200,
    "headers": {"Content-Type": "application/json"},
    "body": "{\\"error\\":\\"Not implemented\\"}"
  }`
}
```

**Step 2: Node.js Interception in wasm-loader.ts**

The server intercepts the endpoint before it reaches WASM:

```typescript
// In src/wasm/wasm-loader.ts
async function handleLogViewerRequest(req: Request, res: Response): Promise<void> {
  const lines = parseInt(req.query.lines as string) || 2000
  const maxLines = Math.min(lines, 50000)

  // Use Node.js spawn for streaming
  const p = spawn('journalctl', ['-u', 'signalk', '-n', maxLines.toString()])

  const logLines: string[] = []
  const rl = readline.createInterface({
    input: p.stdout,
    crlfDelay: Infinity
  })

  rl.on('line', (line) => {
    logLines.push(line)
  })

  await new Promise<void>((resolve, reject) => {
    rl.on('close', () => resolve())
    p.on('error', reject)
  })

  res.json({ lines: logLines, count: logLines.length })
}

// Add interception logic in endpoint handler
if (plugin.id === 'my-plugin' && endpointPath === '/api/logs' && method === 'GET') {
  debug(`Intercepting /api/logs - handling in Node.js`)
  return handleLogViewerRequest(req, res)
}
```

### Real-World Example

See [signalk-logviewer](https://github.com/dirkwa/signalk-logviewer/tree/WASM) for a complete implementation:

- **WASM Plugin**: Registers `/api/logs` endpoint and serves web UI
- **Node.js Handler**: Intercepts requests and streams 2,000-50,000 log lines
- **No memory issues**: Can handle multi-megabyte responses smoothly

### Key Benefits

✅ **No memory limits**: Node.js handles large I/O operations
✅ **Simple WASM code**: Plugin just registers endpoints
✅ **Best of both worlds**: WASM security + Node.js performance
✅ **Transparent to users**: Works like any other plugin

### When NOT to Use This Pattern

Don't use hybrid architecture for:
- Small responses (< 10KB)
- Simple data processing
- Standard delta emissions
- Configuration handling

Pure WASM is faster and simpler for these cases.

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

**Option 1: Direct Copy (Recommended for Development)**
```bash
mkdir -p ~/.signalk/node_modules/@signalk/example-wasm
cp plugin.wasm package.json ~/.signalk/node_modules/@signalk/example-wasm/

# If your plugin has a public/ folder:
cp -r public ~/.signalk/node_modules/@signalk/example-wasm/
```

**Option 2: NPM Package Install**
```bash
# Package and install
npm pack
npm install -g ./signalk-example-wasm-1.0.0.tgz
```

**Note**: Direct copy is faster for development. Use npm install for production deployments.

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
| `httpEndpoints` | Register custom HTTP endpoints | ✅ |
| `staticFiles` | Serve HTML/CSS/JS from `public/` folder | ✅ |
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

### Custom HTTP Endpoints

Register custom REST API endpoints:

**Important**: Custom endpoints are mounted at `/plugins/your-plugin-id/`. For example:
- Plugin registers: `/api/logs`
- Actual endpoint: `http://localhost:3000/plugins/my-plugin/api/logs`
- In your web UI: Use absolute paths like `/plugins/my-plugin/api/logs` or relative paths will resolve correctly from your plugin's static files

**AssemblyScript Example:**
```typescript
export function http_endpoints(): string {
  return JSON.stringify([
    { method: "GET", path: "/api/logs", handler: "handle_get_logs" },
    { method: "POST", path: "/api/clear", handler: "handle_clear_logs" }
  ])
}

export function handle_get_logs(requestJson: string): string {
  const request = JSON.parse(requestJson)
  const query = request.query

  // Read logs from system
  const logs = readLogs(query.lines || 100)

  // Build body JSON as a string
  const bodyJson = `{"logs":${JSON.stringify(logs)},"count":${logs.length}}`

  // Escape the body string for embedding in JSON
  const escapedBody = bodyJson.replaceAll('"', '\\"')

  // Return HTTP response
  return `{"statusCode":200,"headers":{"Content-Type":"application/json"},"body":"${escapedBody}"}`
}
```

**Rust Example:**
```rust
#[no_mangle]
pub extern "C" fn http_endpoints() -> *const u8 {
    let endpoints = json!([
        { "method": "GET", "path": "/api/status", "handler": "handle_status" }
    ]).to_string() + "\0";
    Box::into_raw(endpoints.into_boxed_str()) as *const u8
}

#[no_mangle]
pub extern "C" fn handle_status(req_ptr: *const u8, req_len: usize) -> *const u8 {
    let response = json!({
        "statusCode": 200,
        "headers": { "Content-Type": "application/json" },
        "body": json!({ "status": "running" }).to_string()
    }).to_string() + "\0";
    Box::into_raw(response.into_boxed_str()) as *const u8
}
```

**Request Context:**
```json
{
  "method": "GET",
  "path": "/api/logs",
  "query": { "lines": "100", "filter": "error" },
  "params": {},
  "body": {},
  "headers": { "user-agent": "..." }
}
```

**Response Format:**
```json
{
  "statusCode": 200,
  "headers": { "Content-Type": "application/json" },
  "body": "{ \"result\": \"success\" }"
}
```

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
