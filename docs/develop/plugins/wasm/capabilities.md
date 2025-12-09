---
title: Plugin Capabilities
---

# Plugin Capabilities

## WASM Memory Limitations

WASM plugins running in Node.js have **~64KB buffer limitations** for stdin/stdout operations. This is a fundamental limitation of the Node.js WASI implementation, not a Signal K restriction.

**Impact:**

- Small JSON responses (< 64KB): Work fine in pure WASM
- Medium data (64KB - 1MB): May freeze or fail
- Large data (> 1MB): Will fail or freeze the server

### Hybrid Architecture Pattern

For plugins that need to handle large data volumes (logs, file streaming, large JSON responses), use a **hybrid approach**:

- **WASM Plugin**: Registers HTTP endpoints and provides configuration UI
- **Node.js Handler**: Server intercepts specific endpoints and handles I/O directly in Node.js
- **Result**: Can handle unlimited data without memory constraints

Use this pattern when your plugin needs to:

- Stream large log files (journalctl, syslog)
- Return large JSON responses (> 64KB)
- Process large file uploads
- Handle streaming data

## Capability Types

Declare required capabilities in `package.json`:

| Capability      | Description                              | Status                          |
| --------------- | ---------------------------------------- | ------------------------------- |
| `dataRead`      | Read Signal K data model                 | Supported                       |
| `dataWrite`     | Emit delta messages                      | Supported                       |
| `storage`       | Write to VFS (`vfs-only`)                | Supported                       |
| `httpEndpoints` | Register custom HTTP endpoints           | Supported                       |
| `staticFiles`   | Serve HTML/CSS/JS from `public/` folder  | Supported                       |
| `network`       | HTTP requests (via as-fetch)             | Supported (AssemblyScript only) |
| `putHandlers`   | Register PUT handlers for vessel control | Supported                       |
| `rawSockets`    | UDP socket access for radar, NMEA, etc.  | Supported                       |
| `serialPorts`   | Serial port access                       | Planned                         |

## Network API (AssemblyScript)

AssemblyScript plugins can make HTTP requests using the `as-fetch` library integrated into the SDK.

**Requirements:**

- Plugin must declare `"network": true` in manifest
- Server must be running Node.js 18+ (for native fetch support)
- Import network functions from SDK
- Must add `"transform": ["as-fetch/transform"]` to `asconfig.json` options
- Must set `"exportRuntime": true` in `asconfig.json` options

**Example: HTTP GET Request**

```typescript
import {
  httpGet,
  hasNetworkCapability
} from '@signalk/assemblyscript-plugin-sdk/assembly/network'
import { debug, setError } from '@signalk/assemblyscript-plugin-sdk/assembly'

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

For plugins using network capability:

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

**Manifest Configuration:**

```json
{
  "name": "my-plugin",
  "wasmCapabilities": {
    "network": true
  },
  "dependencies": {
    "@signalk/assemblyscript-plugin-sdk": "^0.2.0",
    "as-fetch": "^2.1.4"
  }
}
```

## Raw Sockets API (UDP)

The `rawSockets` capability enables direct UDP socket access for plugins that need to communicate with devices like:

- Marine radars (Navico, Raymarine, Furuno, Garmin)
- NMEA 0183 over UDP
- AIS receivers
- Other marine electronics using UDP multicast

**Requirements:**

- Plugin must declare `"rawSockets": true` in manifest
- Sockets are non-blocking (poll-based receive)
- Automatic cleanup when plugin stops

**Manifest Configuration:**

```json
{
  "name": "my-radar-plugin",
  "wasmManifest": "plugin.wasm",
  "wasmCapabilities": {
    "rawSockets": true,
    "dataWrite": true
  }
}
```

**FFI Functions Available:**

| Function                        | Signature                                                              | Description                                             |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| `sk_udp_create`                 | `(type: i32) -> i32`                                                   | Create socket (0=udp4, 1=udp6). Returns socket_id or -1 |
| `sk_udp_bind`                   | `(socket_id, port) -> i32`                                             | Bind to port (0=any). Returns 0 or -1                   |
| `sk_udp_join_multicast`         | `(socket_id, addr_ptr, addr_len, iface_ptr, iface_len) -> i32`         | Join multicast group                                    |
| `sk_udp_leave_multicast`        | `(socket_id, addr_ptr, addr_len, iface_ptr, iface_len) -> i32`         | Leave multicast group                                   |
| `sk_udp_set_multicast_ttl`      | `(socket_id, ttl) -> i32`                                              | Set multicast TTL                                       |
| `sk_udp_set_multicast_loopback` | `(socket_id, enabled) -> i32`                                          | Enable/disable loopback                                 |
| `sk_udp_set_broadcast`          | `(socket_id, enabled) -> i32`                                          | Enable/disable broadcast                                |
| `sk_udp_send`                   | `(socket_id, addr_ptr, addr_len, port, data_ptr, data_len) -> i32`     | Send datagram                                           |
| `sk_udp_recv`                   | `(socket_id, buf_ptr, buf_max_len, addr_out_ptr, port_out_ptr) -> i32` | Receive datagram (non-blocking)                         |
| `sk_udp_pending`                | `(socket_id) -> i32`                                                   | Get number of buffered datagrams                        |
| `sk_udp_close`                  | `(socket_id) -> void`                                                  | Close socket                                            |

> **Note:** Use exact function names. Do NOT use `sk_udp_recv_from` - the correct name is `sk_udp_recv`.

**Rust Example:**

```rust
#[link(wasm_import_module = "env")]
extern "C" {
    fn sk_udp_create(socket_type: i32) -> i32;
    fn sk_udp_bind(socket_id: i32, port: u16) -> i32;
    fn sk_udp_join_multicast(
        socket_id: i32,
        addr_ptr: *const u8, addr_len: usize,
        iface_ptr: *const u8, iface_len: usize
    ) -> i32;
    fn sk_udp_recv(
        socket_id: i32,
        buf_ptr: *mut u8, buf_max_len: usize,
        addr_out_ptr: *mut u8, port_out_ptr: *mut u16
    ) -> i32;
    fn sk_udp_close(socket_id: i32);
}

// Example: Radar discovery
fn start_radar_locator() -> i32 {
    // Create UDP socket
    let socket_id = unsafe { sk_udp_create(0) }; // udp4
    if socket_id < 0 {
        return -1;
    }

    // Bind to radar discovery port
    if unsafe { sk_udp_bind(socket_id, 6878) } < 0 {
        return -1;
    }

    // Join radar multicast group
    let group = "239.254.2.0";
    let iface = "";
    if unsafe { sk_udp_join_multicast(socket_id, group.as_ptr(), group.len(), iface.as_ptr(), iface.len()) } < 0 {
        return -1;
    }

    socket_id
}
```

**Important Notes:**

- Receive is non-blocking - returns 0 if no data available
- Incoming datagrams are buffered (max 1000 per socket)
- Oldest datagrams are dropped if buffer is full
- All sockets are automatically closed when plugin stops
- Use `sk_udp_pending()` to check if data is available before calling `sk_udp_recv()`

## PUT Handlers API

WASM plugins can register PUT handlers to respond to PUT requests from clients, enabling vessel control and configuration management.

**Requirements:**

- Plugin must declare `"putHandlers": true` in manifest
- Import PUT handler functions from FFI
- Register handlers during `plugin_start()`
- Export handler functions with correct naming convention

**Manifest Configuration:**

```json
{
  "name": "my-plugin",
  "wasmManifest": "plugin.wasm",
  "wasmCapabilities": {
    "putHandlers": true
  }
}
```

**Handler Naming Convention:**

**Format:** `handle_put_{context}_{path}`

- Replace all dots (`.`) with underscores (`_`)
- Convert to lowercase (recommended)

**Examples:**

| Context        | Path                                    | Handler Function Name                                           |
| -------------- | --------------------------------------- | --------------------------------------------------------------- |
| `vessels.self` | `navigation.anchor.position`            | `handle_put_vessels_self_navigation_anchor_position`            |
| `vessels.self` | `steering.autopilot.target.headingTrue` | `handle_put_vessels_self_steering_autopilot_target_headingTrue` |

**Response Format:**

```json
{
  "state": "COMPLETED",
  "statusCode": 200,
  "message": "Operation successful"
}
```

- `state` - Request state: `COMPLETED` or `PENDING`
- `statusCode` - HTTP status code (200, 400, 403, 500, 501)
- `message` - Human-readable message (optional)

## Storage API

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

## Delta Emission

Emit delta messages to update Signal K data:

```rust
fn emit_position_delta() {
    let delta = r#"{
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
    }"#;

    handle_message(&delta);
}
```
