# Signal K WASM Plugin Development Guide

## Overview

This guide covers how to develop WASM/WASIX plugins for Signal K Server 3.0. WASM plugins run in a secure sandbox with isolated storage and capability-based permissions.

## Language Options

Signal K Server 3.0 supports multiple languages for WASM plugin development:

- **AssemblyScript** - TypeScript-like syntax, easiest for JS/TS developers, smallest binaries (3-10 KB)
- **Rust** - Best performance and tooling, medium binaries (50-200 KB)
- **C#/.NET** - 🚧 **NOT WORKING** - .NET 10 with componentize-dotnet produces WASI Component Model (P2/P3) format. Currently incompatible with Node.js/jco runtime. See [Creating C#/.NET Plugins](#creating-cnet-plugins) for details.
- **Other languages** - C++, Go, Python support coming in future phases

## Prerequisites

### For AssemblyScript Plugins

- Node.js >= 20
- npm or yarn
- AssemblyScript: `npm install --save-dev assemblyscript`

### For Rust Plugins

- Rust toolchain: `rustup`
- WASI Preview 1 target: `rustup target add wasm32-wasip1`

> **Note**: Signal K uses WASI Preview 1 (`wasm32-wasip1`), not the older `wasm32-wasi` target. The `wasm32-wasip1` target is the modern Rust target name for WASI Preview 1.

### For C#/.NET Plugins

- .NET 10 SDK: Download from https://dotnet.microsoft.com/download/dotnet/10.0
- componentize-dotnet templates: `dotnet new install BytecodeAlliance.Componentize.DotNet.Templates`
- Windows: Visual Studio 2022 or VS Code with C# extension
- Verify installation: `dotnet --version` should show `10.0.x`

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
✅ **Network Access**: HTTP requests via as-fetch (AssemblyScript)

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

### C#/.NET - NOT CURRENTLY WORKING

> **🚧 Status: Non-functional** - Waiting for better tooling

**The Issue:**
componentize-dotnet only supports **Wasmtime and WAMR** runtimes. Signal K uses Node.js
with jco transpilation, which is NOT a supported configuration. The .NET NativeAOT
function tables fail to initialize properly in V8, causing runtime crashes.

**Error:** `RuntimeError: null function or function signature mismatch`

**What was tried (Dec 2024):**
- jco transpilation with various flags
- Manual `_initialize()` calls
- Removing `[ThreadStatic]` attribute
- Different .NET versions (8, 9, 10)

**What would be needed:**
- Native `@bytecodealliance/wasmtime` npm package (doesn't exist)
- Improved jco support for .NET NativeAOT
- Alternative .NET toolchain for V8-compatible output

**Recommendation:** Use AssemblyScript or Rust instead. The example code is preserved
for future reference when tooling improves.

👉 **[Jump to C#/.NET Guide](#creating-cnet-plugins)** (reference only)

---

## Creating AssemblyScript Plugins

### Step 1: Install SDK

```bash
npm install signalk-assemblyscript-plugin-sdk
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
} from 'signalk-assemblyscript-plugin-sdk/assembly'

class MyPlugin extends Plugin {
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

Rust is excellent for WASM plugins due to its zero-cost abstractions, memory safety, and mature WASM tooling. Signal K Rust plugins use **buffer-based FFI** for string passing, which differs from AssemblyScript's automatic string handling.

### Rust vs AssemblyScript: Key Differences

| Aspect | AssemblyScript | Rust |
|--------|---------------|------|
| String passing | Automatic via AS loader | Manual buffer-based FFI |
| Memory management | AS runtime handles | `allocate`/`deallocate` exports |
| Binary size | 3-10 KB | 50-200 KB |
| Target | `wasm32` (AS compiler) | `wasm32-wasip1` |

### Step 1: Project Structure

Create a new Rust library project:

```bash
cargo new --lib anchor-watch-rust
cd anchor-watch-rust
```

### Step 2: Configure Cargo.toml

```toml
[package]
name = "anchor_watch_rust"
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
use std::cell::RefCell;
use serde::{Deserialize, Serialize};

// =============================================================================
// FFI Imports - These MUST match what the Signal K runtime provides in "env"
// =============================================================================

#[link(wasm_import_module = "env")]
extern "C" {
    fn sk_debug(ptr: *const u8, len: usize);
    fn sk_set_status(ptr: *const u8, len: usize);
    fn sk_set_error(ptr: *const u8, len: usize);
    fn sk_handle_message(ptr: *const u8, len: usize);
    fn sk_register_put_handler(
        context_ptr: *const u8, context_len: usize,
        path_ptr: *const u8, path_len: usize
    ) -> i32;
}

// =============================================================================
// Helper wrappers for FFI functions
// =============================================================================

fn debug(msg: &str) {
    unsafe { sk_debug(msg.as_ptr(), msg.len()); }
}

fn set_status(msg: &str) {
    unsafe { sk_set_status(msg.as_ptr(), msg.len()); }
}

fn set_error(msg: &str) {
    unsafe { sk_set_error(msg.as_ptr(), msg.len()); }
}

fn handle_message(msg: &str) {
    unsafe { sk_handle_message(msg.as_ptr(), msg.len()); }
}

fn register_put_handler(context: &str, path: &str) -> i32 {
    unsafe {
        sk_register_put_handler(
            context.as_ptr(), context.len(),
            path.as_ptr(), path.len()
        )
    }
}

// =============================================================================
// Memory Allocation - REQUIRED for buffer-based string passing
// =============================================================================

/// Allocate memory for string passing from host
#[no_mangle]
pub extern "C" fn allocate(size: usize) -> *mut u8 {
    let mut buf = Vec::with_capacity(size);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Deallocate memory
#[no_mangle]
pub extern "C" fn deallocate(ptr: *mut u8, size: usize) {
    unsafe {
        let _ = Vec::from_raw_parts(ptr, 0, size);
    }
}

// =============================================================================
// Plugin State
// =============================================================================

thread_local! {
    static STATE: RefCell<PluginState> = RefCell::new(PluginState::default());
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PluginConfig {
    #[serde(default)]
    max_radius: f64,
}

#[derive(Debug, Default)]
struct PluginState {
    config: PluginConfig,
    is_running: bool,
}

// =============================================================================
// Plugin Exports - Core plugin interface
// =============================================================================

static PLUGIN_ID: &str = "my-rust-plugin";
static PLUGIN_NAME: &str = "My Rust Plugin";
static PLUGIN_SCHEMA: &str = r#"{
    "type": "object",
    "properties": {
        "maxRadius": {
            "type": "number",
            "title": "Max Radius",
            "default": 50
        }
    }
}"#;

/// Return the plugin ID (buffer-based)
#[no_mangle]
pub extern "C" fn plugin_id(out_ptr: *mut u8, out_max_len: usize) -> i32 {
    write_string(PLUGIN_ID, out_ptr, out_max_len)
}

/// Return the plugin name (buffer-based)
#[no_mangle]
pub extern "C" fn plugin_name(out_ptr: *mut u8, out_max_len: usize) -> i32 {
    write_string(PLUGIN_NAME, out_ptr, out_max_len)
}

/// Return the plugin JSON schema (buffer-based)
#[no_mangle]
pub extern "C" fn plugin_schema(out_ptr: *mut u8, out_max_len: usize) -> i32 {
    write_string(PLUGIN_SCHEMA, out_ptr, out_max_len)
}

/// Start the plugin with configuration
#[no_mangle]
pub extern "C" fn plugin_start(config_ptr: *const u8, config_len: usize) -> i32 {
    // Read config from buffer
    let config_json = unsafe {
        let slice = std::slice::from_raw_parts(config_ptr, config_len);
        String::from_utf8_lossy(slice).to_string()
    };

    // Parse configuration
    let parsed_config: PluginConfig = match serde_json::from_str(&config_json) {
        Ok(c) => c,
        Err(e) => {
            set_error(&format!("Failed to parse config: {}", e));
            return 1;
        }
    };

    // Update state
    STATE.with(|state| {
        let mut s = state.borrow_mut();
        s.config = parsed_config;
        s.is_running = true;
    });

    debug("Plugin started successfully");
    set_status("Running");

    0 // Success
}

/// Stop the plugin
#[no_mangle]
pub extern "C" fn plugin_stop() -> i32 {
    STATE.with(|state| {
        state.borrow_mut().is_running = false;
    });

    debug("Plugin stopped");
    set_status("Stopped");

    0 // Success
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Write string to output buffer, return bytes written
fn write_string(s: &str, ptr: *mut u8, max_len: usize) -> i32 {
    let bytes = s.as_bytes();
    let len = bytes.len().min(max_len);
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, len);
    }
    len as i32
}
```

### Step 4: Create package.json

```json
{
  "name": "@signalk/my-rust-plugin",
  "version": "0.1.0",
  "description": "My Rust WASM plugin for Signal K",
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
    "putHandlers": true
  },
  "author": "Your Name",
  "license": "Apache-2.0"
}
```

### Step 5: Build

```bash
# Build with WASI Preview 1 target (required for Signal K)
cargo build --release --target wasm32-wasip1

# Copy to plugin.wasm
cp target/wasm32-wasip1/release/my_rust_plugin.wasm plugin.wasm
```

> **Important**: Use `wasm32-wasip1` target, NOT `wasm32-wasi`. Signal K requires WASI Preview 1.

### Step 6: Install

**Option 1: Direct Copy (Recommended for Development)**
```bash
mkdir -p ~/.signalk/node_modules/@signalk/my-rust-plugin
cp plugin.wasm package.json ~/.signalk/node_modules/@signalk/my-rust-plugin/
```

**Option 2: NPM Package Install**
```bash
npm pack
npm install -g ./signalk-my-rust-plugin-0.1.0.tgz
```

### Step 7: Enable in Admin UI

1. Navigate to **Server** → **Plugin Config**
2. Find "My Rust Plugin"
3. Click **Enable**
4. Configure settings
5. Click **Submit**

### Rust FFI Interface Reference

Signal K provides these FFI imports in the `env` module:

| Function | Parameters | Description |
|----------|------------|-------------|
| `sk_debug` | `(ptr, len)` | Log debug message |
| `sk_set_status` | `(ptr, len)` | Set plugin status |
| `sk_set_error` | `(ptr, len)` | Set error message |
| `sk_handle_message` | `(ptr, len)` | Emit delta message |
| `sk_register_put_handler` | `(ctx_ptr, ctx_len, path_ptr, path_len)` | Register PUT handler |

Your plugin MUST export:

| Export | Signature | Description |
|--------|-----------|-------------|
| `plugin_id` | `(out_ptr, max_len) -> len` | Return plugin ID |
| `plugin_name` | `(out_ptr, max_len) -> len` | Return plugin name |
| `plugin_schema` | `(out_ptr, max_len) -> len` | Return JSON schema |
| `plugin_start` | `(config_ptr, config_len) -> status` | Start plugin |
| `plugin_stop` | `() -> status` | Stop plugin |
| `allocate` | `(size) -> ptr` | Allocate memory |
| `deallocate` | `(ptr, size)` | Free memory |

📁 **See [anchor-watch-rust example](../examples/wasm-plugins/anchor-watch-rust/) for a complete working plugin with PUT handlers**

---

## Creating C#/.NET Plugins

> 🚧 **NOT WORKING**: .NET WASM plugins cannot run in Signal K's Node.js/jco environment.
> componentize-dotnet only supports Wasmtime and WAMR runtimes. This section is preserved
> for future reference when tooling improves.
>
> **Use AssemblyScript or Rust instead for working WASM plugins.**

### Why C#/.NET Doesn't Work (Dec 2024)

The .NET WASM toolchain (`componentize-dotnet`) produces WASI Component Model output that
requires native Wasmtime or WAMR to execute. When transpiled via jco to JavaScript:

1. The WASM module loads successfully
2. The `$init` promise resolves
3. All functions appear to be exported
4. **Calling any function crashes** with `RuntimeError: null function or function signature mismatch`

This happens because .NET NativeAOT uses indirect call tables that are initialized by
`_initialize()`. In Wasmtime, this works correctly. In V8 (via jco), the table entries
remain null, causing every function call to fail.

**Workarounds attempted:**
- Manual `_initialize()` call - no effect
- `InitializeModules()` call - crashes (already called by `_initialize`)
- Removing `[ThreadStatic]` attribute - fixed build but not runtime
- Various jco flags (`--tla-compat`, `--instantiation sync`) - no effect

**Conclusion:** Wait for better tooling. Both componentize-dotnet and jco are under
active development.

---

### Reference: How It Would Work (Future)

The following documentation describes the **intended** build process for when the
tooling matures. The code compiles and transpiles successfully, but cannot execute.

### Understanding WASI Versions

.NET 10 produces **WASI Component Model** (P2/P3) binaries, not WASI Preview 1 (P1) format:

| Format | Version Magic | Compatible Runtimes |
|--------|--------------|---------------------|
| WASI P1 | `0x01` | Node.js WASI, wasmer |
| Component Model | `0x0d` | wasmtime, jco transpile |

Signal K currently uses WASI P1. To run .NET plugins, either:
1. **Upgrade runtime** to wasmtime with component support
2. **Transpile** with `jco` to JavaScript + P1 WASM

### Step 1: Install Prerequisites

```powershell
# Install .NET 10 SDK (https://dotnet.microsoft.com/download/dotnet/10.0)
# Verify installation
dotnet --version  # Should show 10.0.x

# Install componentize-dotnet templates
dotnet new install BytecodeAlliance.Componentize.DotNet.Templates
```

### Step 2: Create Project Structure

```
anchor-watch-dotnet/
├── AnchorWatch.csproj      # Project file with componentize-dotnet
├── PluginImpl.cs           # Plugin implementation
├── nuget.config            # NuGet feed for LLVM compiler
├── patch-threadstatic.ps1  # Build-time patcher (Windows)
└── wit/
    └── signalk-plugin.wit  # WIT interface definition
```

### Step 3: Create WIT Interface

Create `wit/signalk-plugin.wit`:

```wit
package signalk:plugin@1.0.0;

/// Plugin interface - exported by WASM plugin
interface plugin {
    /// Returns unique plugin identifier
    plugin-id: func() -> string;

    /// Returns human-readable plugin name
    plugin-name: func() -> string;

    /// Returns JSON Schema for plugin configuration
    plugin-schema: func() -> string;

    /// Start the plugin with JSON configuration
    /// Returns 0 on success, non-zero on error
    plugin-start: func(config: string) -> s32;

    /// Stop the plugin
    /// Returns 0 on success, non-zero on error
    plugin-stop: func() -> s32;
}

/// Signal K API - imported from host
interface signalk-api {
    /// Log debug message
    sk-debug: func(message: string);

    /// Set plugin status message
    sk-set-status: func(message: string);

    /// Set plugin error message
    sk-set-error: func(message: string);

    /// Emit a Signal K delta message
    sk-handle-message: func(delta-json: string);

    /// Register a PUT handler for a path
    sk-register-put-handler: func(context: string, path: string) -> s32;
}

/// World definition - connects imports and exports
world signalk-plugin {
    import signalk-api;
    export plugin;
}
```

### Step 4: Create Project File

Create `AnchorWatch.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <RuntimeIdentifier>wasi-wasm</RuntimeIdentifier>
    <UseAppHost>false</UseAppHost>
    <PublishTrimmed>true</PublishTrimmed>
    <InvariantGlobalization>true</InvariantGlobalization>
    <SelfContained>true</SelfContained>
    <OutputType>Library</OutputType>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <Nullable>enable</Nullable>
    <IlcExportUnmanagedEntrypoints>true</IlcExportUnmanagedEntrypoints>
    <TrimmerSingleWarn>false</TrimmerSingleWarn>
    <WasmEnableThreads>false</WasmEnableThreads>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="BytecodeAlliance.Componentize.DotNet.Wasm.SDK"
                      Version="0.7.0-preview00010" />
    <!-- Platform-specific LLVM compiler (adjust for your platform) -->
    <PackageReference Include="runtime.win-x64.Microsoft.DotNet.ILCompiler.LLVM"
                      Version="10.0.0-*" />
  </ItemGroup>

  <ItemGroup>
    <Wit Update="wit/signalk-plugin.wit" World="signalk-plugin" />
  </ItemGroup>

  <ItemGroup>
    <Compile Remove="Program.cs" />
  </ItemGroup>

  <!-- Patch wit-bindgen generated files for WASI compatibility -->
  <Target Name="PatchWitBindgen" AfterTargets="GenerateWitBindings" BeforeTargets="CoreCompile">
    <PropertyGroup>
      <WitBindgenFile>$(IntermediateOutputPath)wit_bindgen\SignalkPlugin.cs</WitBindgenFile>
    </PropertyGroup>
    <Exec Command="powershell -ExecutionPolicy Bypass -File &quot;$(MSBuildProjectDirectory)\patch-threadstatic.ps1&quot; -FilePath &quot;$(WitBindgenFile)&quot;"
          Condition="Exists('$(WitBindgenFile)')" />
  </Target>

</Project>
```

### Step 5: Create NuGet Config

Create `nuget.config` for the experimental LLVM compiler:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="dotnet-experimental"
         value="https://pkgs.dev.azure.com/dnceng/public/_packaging/dotnet-experimental/nuget/v3/index.json" />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
</configuration>
```

### Step 6: Create Build Patcher

Create `patch-threadstatic.ps1` (required to fix wit-bindgen issues):

```powershell
# Patch wit-bindgen generated C# files for WASI compatibility
# Fixes:
# 1. ThreadStaticAttribute missing in WASI single-threaded environment
# 2. Missing using statements in generated code
param([string]$FilePath)

# Get the directory containing the generated files
$dir = Split-Path $FilePath -Parent

# Patch all .cs files in the wit_bindgen directory
Get-ChildItem -Path $dir -Filter "*.cs" | ForEach-Object {
    $file = $_.FullName
    $content = Get-Content $file -Raw
    $modified = $false

    # Add missing using statements if not present
    if ($content -match '#nullable enable' -and $content -notmatch 'using System;(\r?\n)') {
        $content = $content -replace '(#nullable enable\r?\n)', "`$1using System;`nusing System.Collections.Generic;`n"
        $modified = $true
    }

    # For SignalkPlugin.cs specifically, add ThreadStatic stub
    if ($_.Name -eq 'SignalkPlugin.cs') {
        if ($content -match '\[ThreadStatic\]') {
            $content = $content -replace '\[ThreadStatic\]', '[global::System.ThreadStatic]'
            $modified = $true
        }

        if ($content -notmatch '// WASI ThreadStatic stub') {
            $stub = @"
// WASI ThreadStatic stub - single-threaded environment
namespace System {
    [global::System.AttributeUsage(global::System.AttributeTargets.Field, Inherited = false)]
    public sealed class ThreadStaticAttribute : global::System.Attribute { }
}

"@
            $content = $content -replace 'namespace SignalkPluginWorld', ($stub + 'namespace SignalkPluginWorld')
            $modified = $true
        }
    }

    if ($modified) {
        Set-Content $file $content -NoNewline
        Write-Host "Patched $($_.Name)"
    }
}

Write-Host "Patching complete"
```

### Step 7: Implement Plugin

Create `PluginImpl.cs`:

```csharp
using System.Text.Json;
using System.Text.Json.Serialization;
using SignalkPluginWorld.wit.exports.signalk.plugin.v1_0_0;
using SignalkPluginWorld.wit.imports.signalk.plugin.v1_0_0;

namespace AnchorWatch;

/// <summary>
/// Anchor Watch Plugin - monitors vessel position relative to anchor
/// </summary>
public class PluginImpl : IPlugin
{
    private static PluginConfig? _config;
    private static bool _isRunning;

    public static string PluginId() => "anchor-watch-dotnet";

    public static string PluginName() => "Anchor Watch (.NET)";

    public static string PluginSchema() => """
        {
            "type": "object",
            "title": "Anchor Watch Configuration",
            "properties": {
                "maxRadius": {
                    "type": "number",
                    "title": "Maximum Radius (meters)",
                    "description": "Alert when vessel drifts beyond this radius from anchor",
                    "default": 50
                },
                "checkInterval": {
                    "type": "number",
                    "title": "Check Interval (seconds)",
                    "default": 10
                }
            }
        }
        """;

    public static int PluginStart(string config)
    {
        try
        {
            SignalkApiInterop.SkDebug($"Starting Anchor Watch with config: {config}");

            // Parse configuration
            _config = string.IsNullOrEmpty(config)
                ? new PluginConfig()
                : JsonSerializer.Deserialize(config, SourceGenerationContext.Default.PluginConfig)
                  ?? new PluginConfig();

            _isRunning = true;

            SignalkApiInterop.SkSetStatus($"Monitoring anchor (radius: {_config.MaxRadius}m)");
            SignalkApiInterop.SkDebug("Anchor Watch started successfully");

            return 0; // Success
        }
        catch (Exception ex)
        {
            SignalkApiInterop.SkSetError($"Failed to start: {ex.Message}");
            return 1; // Error
        }
    }

    public static int PluginStop()
    {
        _isRunning = false;
        SignalkApiInterop.SkSetStatus("Stopped");
        SignalkApiInterop.SkDebug("Anchor Watch stopped");
        return 0;
    }
}

/// <summary>
/// Plugin configuration
/// </summary>
public class PluginConfig
{
    [JsonPropertyName("maxRadius")]
    public double MaxRadius { get; set; } = 50;

    [JsonPropertyName("checkInterval")]
    public int CheckInterval { get; set; } = 10;
}

/// <summary>
/// JSON source generator for AOT compatibility
/// </summary>
[JsonSourceGenerationOptions(WriteIndented = false)]
[JsonSerializable(typeof(PluginConfig))]
internal partial class SourceGenerationContext : JsonSerializerContext
{
}
```

### Step 8: Build

```powershell
cd examples/wasm-plugins/anchor-watch-dotnet

# Clean previous build
Remove-Item -Recurse -Force obj -ErrorAction SilentlyContinue

# Build
dotnet build

# Output location
# bin/Debug/net10.0/wasi-wasm/publish/AnchorWatch.wasm
```

Expected output:
```
Wiederherstellung abgeschlossen (1.7s)
  AnchorWatch net10.0 wasi-wasm erfolgreich mit 1 Warnung(en) (16.9s)
```

The warning about `ThreadStaticAttribute` conflict is expected and harmless.

### Step 9: Verify Output

```powershell
# Check file size
dir bin\Debug\net10.0\wasi-wasm\publish\AnchorWatch.wasm
# ~20 MB

# Verify WIT interface (requires jco)
npx @bytecodealliance/jco wit bin\Debug\net10.0\wasi-wasm\publish\AnchorWatch.wasm
```

Expected WIT output:
```wit
package root:component;

world root {
  import wasi:cli/environment@0.2.0;
  import wasi:io/streams@0.2.0;
  ...
  import signalk:plugin/signalk-api@1.0.0;

  export signalk:plugin/plugin@1.0.0;
}
```

### Troubleshooting .NET Builds

#### Error: ThreadStaticAttribute not found
The `patch-threadstatic.ps1` script should fix this automatically. If it persists:
1. Delete the `obj` folder completely
2. Ensure the patch script path is correct in `.csproj`
3. Run `dotnet build` again

#### Error: Microsoft.DotNet.ILCompiler.LLVM not found
Ensure `nuget.config` is present with the `dotnet-experimental` feed.

#### Error: List<> or Span<> not found
The patch script adds missing `using` statements. If errors persist, manually add to the generated files:
```csharp
using System;
using System.Collections.Generic;
```

#### Large binary size (~20 MB)
This is expected for NativeAOT-LLVM compilation. The binary includes:
- .NET runtime (trimmed)
- WASI Component Model adapter
- Your plugin code

Future optimizations may reduce this.

### Using the Signal K API

The WIT-generated bindings provide type-safe access to Signal K APIs:

```csharp
using SignalkPluginWorld.wit.imports.signalk.plugin.v1_0_0;

// Log debug message
SignalkApiInterop.SkDebug("Debug message");

// Set status
SignalkApiInterop.SkSetStatus("Running");

// Set error
SignalkApiInterop.SkSetError("Something went wrong");

// Emit delta
var delta = """
{
    "context": "vessels.self",
    "updates": [{
        "source": {"label": "anchor-watch-dotnet", "type": "plugin"},
        "timestamp": "2025-12-02T10:00:00.000Z",
        "values": [{
            "path": "navigation.anchor.position",
            "value": {"latitude": 60.1234, "longitude": 24.5678}
        }]
    }]
}
""";
SignalkApiInterop.SkHandleMessage(delta);

// Register PUT handler
SignalkApiInterop.SkRegisterPutHandler("vessels.self", "navigation.anchor.position");
```

### Runtime Integration (Coming Soon)

The .NET WASM component uses WASI Component Model format. To run it in Signal K:

**Option 1: Wasmtime Runtime**
Replace Node.js WASI with wasmtime (supports Component Model natively).

**Option 2: jco Transpilation**
Transpile to JavaScript + WASI P1:
```bash
npx @bytecodealliance/jco transpile AnchorWatch.wasm -o ./transpiled
```

This generates JavaScript bindings that work with the current Node.js runtime.

📁 **See [examples/wasm-plugins/anchor-watch-dotnet](../examples/wasm-plugins/anchor-watch-dotnet/) for the complete working example**

---

## Plugin Capabilities

### Capability Types

Declare required capabilities in `package.json`:

| Capability | Description | Status |
|------------|-------------|--------|
| `dataRead` | Read Signal K data model | ✅ Supported |
| `dataWrite` | Emit delta messages | ✅ Supported |
| `storage` | Write to VFS (`vfs-only`) | ✅ Supported |
| `httpEndpoints` | Register custom HTTP endpoints | ✅ Supported |
| `staticFiles` | Serve HTML/CSS/JS from `public/` folder | ✅ Supported |
| `network` | HTTP requests (via as-fetch) | ✅ Supported (AssemblyScript only) |
| `putHandlers` | Register PUT handlers for vessel control | ✅ Supported |
| `serialPorts` | Serial port access | ⏳ Planned (Phase 3) |

### Network API (AssemblyScript)

AssemblyScript plugins can make HTTP requests using the `as-fetch` library integrated into the SDK:

**Requirements:**
- Plugin must declare `"network": true` in manifest
- Server must be running Node.js 18+ (for native fetch support)
- Import network functions from SDK
- Must add `"transform": ["as-fetch/transform"]` to `asconfig.json` options
- Must set `"exportRuntime": true` in `asconfig.json` options

**Example: HTTP GET Request**

```typescript
import { httpGet, hasNetworkCapability } from 'signalk-assemblyscript-plugin-sdk/assembly/network'
import { debug, setError } from 'signalk-assemblyscript-plugin-sdk/assembly'

class MyPlugin extends Plugin {
  start(config: string): i32 {
    // Always check capability first
    if (!hasNetworkCapability()) {
      setError('Network capability not granted')
      return 1
    }

    // Make HTTP GET request
    const response = httpGet('https://api.example.com/data')
    if (response === null) {
      setError('HTTP request failed')
      return 1
    }

    debug('Received: ' + response)
    return 0
  }
}
```

**Available Network Functions:**

```typescript
// Check if network capability is granted
hasNetworkCapability(): boolean

// HTTP GET request - returns response body or null on error
httpGet(url: string): string | null

// HTTP POST request - returns status code or -1 on error
httpPost(url: string, body: string): i32

// HTTP POST with response - returns response body or null
httpPostWithResponse(url: string, body: string): string | null

// HTTP PUT request - returns status code or -1 on error
httpPut(url: string, body: string): i32

// HTTP DELETE request - returns status code or -1 on error
httpDelete(url: string): i32

// Advanced HTTP request with full control
httpRequest(
  url: string,
  method: string,
  body: string | null,
  contentType: string | null
): HttpResponse | null
```

**Build Configuration (asconfig.json):**

For plugins using network capability, your `asconfig.json` must include:

```json
{
  "targets": {
    "release": {
      "outFile": "build/plugin.wasm",
      "optimize": true,
      "shrinkLevel": 2,
      "runtime": "stub"
    }
  },
  "options": {
    "bindings": "esm",
    "exportRuntime": true,
    "transform": ["as-fetch/transform"]
  }
}
```

**Key requirements:**
- `"exportRuntime": true` - Required for AssemblyScript loader string handling
- `"transform": ["as-fetch/transform"]` - Required for as-fetch HTTP support

**Manifest Configuration:**

```json
{
  "name": "my-plugin",
  "wasmCapabilities": {
    "network": true
  },
  "dependencies": {
    "signalk-assemblyscript-plugin-sdk": "^0.1.0",
    "as-fetch": "^2.1.4"
  }
}
```

**Complete Example:**

See [examples/wasm-plugins/weather-plugin](examples/wasm-plugins/weather-plugin/) for a full working example that fetches weather data from OpenWeatherMap.

**Security Notes:**
- Requests are subject to standard browser/Node.js security policies
- CORS applies for cross-origin requests
- No rate limiting enforced by server (implement in your plugin)
- Network capability cannot be bypassed - enforced at runtime

### PUT Handlers API

WASM plugins can register PUT handlers to respond to PUT requests from clients, enabling vessel control and configuration management. This is useful for:
- Controlling autopilot and steering
- Managing anchor watch and alarms
- Configuring devices and sensors
- Handling action requests from dashboards

#### Enabling PUT Handlers

**Requirements:**
- Plugin must declare `"putHandlers": true` in manifest
- Import PUT handler functions from FFI
- Register handlers during `plugin_start()`
- Export handler functions with correct naming convention

#### Manifest Configuration

```json
{
  "name": "@signalk/my-plugin",
  "wasmCapabilities": {
    "putHandlers": true
  }
}
```

#### Rust Example - Anchor Watch

See [examples/wasm-plugins/anchor-watch-rust](../examples/wasm-plugins/anchor-watch-rust/) for a complete Rust implementation.

**Register PUT Handler:**

```rust
#[link(wasm_import_module = "env")]
extern "C" {
    fn sk_register_put_handler(
        context_ptr: *const u8, context_len: usize,
        path_ptr: *const u8, path_len: usize
    ) -> i32;
}

fn register_put_handler(context: &str, path: &str) -> i32 {
    unsafe {
        sk_register_put_handler(
            context.as_ptr(), context.len(),
            path.as_ptr(), path.len()
        )
    }
}

// In plugin_start():
register_put_handler("vessels.self", "navigation.anchor.position");
register_put_handler("vessels.self", "navigation.anchor.maxRadius");
```

**Implement PUT Handler:**

```rust
/// Handle PUT request for navigation.anchor.position
#[no_mangle]
pub extern "C" fn handle_put_vessels_self_navigation_anchor_position(
    value_ptr: *const u8,
    value_len: usize,
    response_ptr: *mut u8,
    response_max_len: usize,
) -> i32 {
    // 1. Read value from buffer
    let value_json = unsafe {
        let slice = std::slice::from_raw_parts(value_ptr, value_len);
        String::from_utf8_lossy(slice).to_string()
    };

    // 2. Parse and validate
    #[derive(Deserialize)]
    struct Position { latitude: f64, longitude: f64 }

    let result = match serde_json::from_str::<Position>(&value_json) {
        Ok(pos) => {
            // 3. Update state
            STATE.with(|state| {
                let mut s = state.borrow_mut();
                s.config.anchor_lat = pos.latitude;
                s.config.anchor_lon = pos.longitude;
            });

            // 4. Emit delta to update data model
            let delta = format!(
                r#"{{"context":"vessels.self","updates":[{{"source":{{"label":"my-plugin"}},"values":[{{"path":"navigation.anchor.position","value":{{"latitude":{},"longitude":{}}}}}]}}]}}"#,
                pos.latitude, pos.longitude
            );
            handle_message(&delta);

            // 5. Return success response
            r#"{"state":"COMPLETED","statusCode":200}"#.to_string()
        }
        Err(e) => {
            format!(r#"{{"state":"COMPLETED","statusCode":400,"message":"Invalid position: {}"}}"#, e)
        }
    };

    // Write response to buffer
    write_string(&result, response_ptr, response_max_len)
}
```

#### Handler Naming Convention

Handler functions must follow this naming pattern:

**Format:** `handle_put_{context}_{path}`
- Replace all dots (`.`) with underscores (`_`)
- Convert to lowercase (recommended)

**Examples:**
| Context | Path | Handler Function Name |
|---------|------|----------------------|
| `vessels.self` | `navigation.anchor.position` | `handle_put_vessels_self_navigation_anchor_position` |
| `vessels.self` | `steering.autopilot.target.headingTrue` | `handle_put_vessels_self_steering_autopilot_target_headingTrue` |
| `vessels.self` | `electrical.switches.anchorLight` | `handle_put_vessels_self_electrical_switches_anchorLight` |

#### Request Format

PUT handlers receive a JSON request with this structure:

```json
{
  "context": "vessels.self",
  "path": "navigation.anchor.position",
  "value": {
    "latitude": 60.1234,
    "longitude": 24.5678
  }
}
```

**Request Fields:**
- `context` - Signal K context (e.g., `vessels.self`)
- `path` - Signal K path (e.g., `navigation.anchor.position`)
- `value` - The value to set (type depends on path)

#### Response Format

PUT handlers must return a JSON response:

```json
{
  "state": "COMPLETED",
  "statusCode": 200,
  "message": "Operation successful"
}
```

**Response Fields:**
- `state` - Request state: `COMPLETED` or `PENDING`
  - `COMPLETED` - Request finished (success or error)
  - `PENDING` - Request accepted but still processing
- `statusCode` - HTTP status code
  - `200` - Success
  - `400` - Bad request (invalid input)
  - `403` - Forbidden
  - `500` - Server error (handler exception)
  - `501` - Not implemented
- `message` - Human-readable message (optional)

#### Testing PUT Handlers

**Important: Source Parameter**

When multiple plugins or providers register handlers for the same Signal K path, you **MUST** include a `source` parameter in the PUT request body to identify which handler should process the request.

The `source` value must match the **npm package name** from `package.json`, not the plugin ID.

**Using curl:**

```bash
# Set anchor position (with source parameter)
curl -X PUT http://localhost:3000/signalk/v1/api/vessels/self/navigation/anchor/position \
  -H "Content-Type: application/json" \
  -d '{"value": {"latitude": 60.1234, "longitude": 24.5678}, "source": "@signalk/anchor-watch-rust"}'

# Set drag alarm radius
curl -X PUT http://localhost:3000/signalk/v1/api/vessels/self/navigation/anchor/maxRadius \
  -H "Content-Type: application/json" \
  -d '{"value": 75, "source": "@signalk/anchor-watch-rust"}'

# Set anchor state
curl -X PUT http://localhost:3000/signalk/v1/api/vessels/self/navigation/anchor/state \
  -H "Content-Type: application/json" \
  -d '{"value": "on", "source": "@signalk/anchor-watch-rust"}'
```

**Error without source parameter:**

If multiple sources provide the same path and you omit the `source` parameter:

```json
{
  "state": "COMPLETED",
  "statusCode": 400,
  "message": "there are multiple sources for the given path, but no source was specified in the request"
}
```

**Using WebSocket:**

```json
{
  "context": "vessels.self",
  "put": {
    "path": "navigation.anchor.position",
    "value": {
      "latitude": 60.1234,
      "longitude": 24.5678
    },
    "source": "@signalk/anchor-watch-rust"
  }
}
```

#### Best Practices

**1. Validate Input**
```csharp
if (radius <= 0 || radius > 1000) {
    return MarshalJson(new PutResponse {
        State = "COMPLETED",
        StatusCode = 400,
        Message = "Radius must be between 0 and 1000 meters"
    });
}
```

**2. Update Data Model**

After processing a PUT request, emit a delta to update the Signal K data model:

```csharp
var delta = $@"{{
  ""context"": ""vessels.self"",
  ""updates"": [{{
    ""source"": {{
      ""label"": ""my-plugin"",
      ""type"": ""plugin""
    }},
    ""timestamp"": ""{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ss.fffZ}"",
    ""values"": [{{
      ""path"": ""navigation.anchor.position"",
      ""value"": {{
        ""latitude"": {position.Latitude},
        ""longitude"": {position.Longitude}
      }}
    }}]
  }}]
}}";
SignalKApi.EmitDelta(delta);
```

**3. Handle Errors Gracefully**

```csharp
try {
    // Process request
} catch (Exception ex) {
    return MarshalJson(new PutResponse {
        State = "COMPLETED",
        StatusCode = 500,
        Message = $"Error: {ex.Message}"
    });
}
```

**4. Set supportsPut Metadata**

The server automatically sets `meta.supportsPut: true` for paths with registered PUT handlers, making them discoverable by clients.

#### Complete Example

See [examples/wasm-plugins/anchor-watch-dotnet](examples/wasm-plugins/anchor-watch-dotnet/) for a complete working example demonstrating:
- C# / .NET 8 WASM development
- PUT handler registration and implementation
- State management with VFS storage
- Delta emission for data model updates
- Proper error handling and validation
- Request/response marshaling

#### Security Considerations

- ✅ PUT handlers are capability-controlled
- ✅ Sandboxed execution - no direct system access
- ✅ Memory isolated - cannot access other plugins
- ⚠️ Validate all input from PUT requests
- ⚠️ Implement authorization if handling sensitive operations
- ⚠️ Rate limiting not enforced - implement if needed

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
