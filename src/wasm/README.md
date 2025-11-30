# Signal K WASM Plugin Infrastructure

This directory contains the infrastructure for running WebAssembly (WASM/WASIX) plugins in Signal K Server 3.0.

## Architecture

The WASM plugin system runs alongside the existing Node.js plugin system in a hybrid mode:
- **Node.js plugins**: Continue running with full access (unsandboxed)
- **WASM plugins**: Run in Wasmer sandbox with VFS isolation and capability restrictions

## Files

### Core Infrastructure

- **`wasm-runtime.ts`** - WASM runtime management using Wasmer
  - Module loading and compilation
  - Instance lifecycle (load, unload, reload)
  - Singleton runtime instance

- **`wasm-storage.ts`** - Virtual filesystem (VFS) management
  - Per-plugin isolated storage
  - Server-managed vs plugin-managed config
  - Node.js to WASM data migration
  - Disk usage tracking

### Pending Implementation

- **`wasm-loader.ts`** - Plugin registration and loading
  - Type detection (Node.js vs WASM)
  - Hot-reload without server restart
  - Crash recovery with exponential backoff

- **`wasm-serverapi.ts`** - FFI bridge to ServerAPI
  - Capability enforcement
  - Delta message handling
  - Configuration management
  - Status and logging

- **`wasm-subscriptions.ts`** - Delta subscription management
  - Pattern matching
  - Buffering during reload
  - Subscription state tracking

## WIT Interface

The WASM plugin API is defined in WebAssembly Interface Types (WIT) at:
`packages/server-api/wit/signalk.wit`

This provides a type-safe, language-agnostic API definition that generates:
- Rust bindings via `wit-bindgen`
- JavaScript host bindings via `@bytecodealliance/jco`

## Dependencies

Added to `package.json`:
- `@wasmer/wasi` - WASM runtime with WASI support
- `@bytecodealliance/jco` - WIT bindings generator

## VFS Structure

Each WASM plugin gets an isolated virtual filesystem:

```
$CONFIG_DIR/plugin-config-data/{plugin-id}/
├── {plugin-id}.json        # Server-managed config (outside VFS)
├── vfs/                    # VFS root (plugin sees as "/")
│   ├── data/               # Persistent storage
│   ├── config/             # Plugin-managed config
│   └── tmp/                # Temporary files
```

## Capabilities

WASM plugins declare required capabilities in `package.json`:

```json
{
  "wasmCapabilities": {
    "dataRead": true,
    "dataWrite": true,
    "storage": "vfs-only",
    "network": false,
    "serialPorts": false
  }
}
```

## Usage

### Initialize Runtime

```typescript
import { initializeWasmRuntime } from './wasm/wasm-runtime'

const runtime = initializeWasmRuntime()
```

### Load Plugin

```typescript
const instance = await runtime.loadPlugin(
  'my-wasm-plugin',
  '/path/to/plugin.wasm',
  '/path/to/vfs/root',
  capabilities
)
```

### Hot Reload

```typescript
await runtime.reloadPlugin('my-wasm-plugin')
```

## Status

**Phase 1 (Core Infrastructure Complete):** Minimal Viable WASM Plugin Support
- ✅ Dependencies added (@wasmer/wasi, @bytecodealliance/jco)
- ✅ WIT interface defined (packages/server-api/wit/signalk.wit)
- ✅ Runtime initialization implemented (wasm-runtime.ts)
- ✅ VFS storage layer implemented (wasm-storage.ts)
- ✅ Plugin loader with hot-reload (wasm-loader.ts)
- ✅ ServerAPI FFI bridge (wasm-serverapi.ts)
- ✅ Delta subscription manager (wasm-subscriptions.ts)
- ✅ Integration with existing plugin system (src/interfaces/plugins.ts)
- ✅ Server initialization (src/index.ts)

## Next Steps

1. Complete `wasm-loader.ts` with plugin registration
2. Implement `wasm-serverapi.ts` FFI bridge
3. Integrate with `src/interfaces/plugins.ts`
4. Add runtime initialization to `src/index.ts`
5. Create Rust SDK with example plugins
6. Test hot-reload functionality
