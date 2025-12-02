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
  - Support for both Rust and AssemblyScript plugins

- **`wasm-storage.ts`** - Virtual filesystem (VFS) management
  - Per-plugin isolated storage
  - Server-managed vs plugin-managed config
  - Node.js to WASM data migration
  - Disk usage tracking

- **`wasm-serverapi.ts`** - FFI bridge to ServerAPI
  - Capability enforcement
  - Delta message handling
  - Configuration management
  - Status and logging
  - Network API integration (Node.js 18+ fetch)

- **`wasm-subscriptions.ts`** - Delta subscription management
  - Pattern matching
  - Buffering during reload
  - Subscription state tracking

### Plugin Loader (Modular Architecture)

The plugin loader has been refactored into logical modules under `loader/`:

- **`loader/types.ts`** - Shared type definitions
  - `WasmPlugin` interface - Runtime plugin state
  - `WasmPluginMetadata` interface - Plugin manifest data

- **`loader/plugin-registry.ts`** - Plugin registration and management
  - `registerWasmPlugin()` - Main registration function
  - `getAllWasmPlugins()` - Get all registered plugins
  - `getWasmPlugin()` - Get plugin by ID
  - Global plugin registry (Map)
  - Crash recovery timer management

- **`loader/plugin-lifecycle.ts`** - Lifecycle operations
  - `startWasmPlugin()` - Start a plugin
  - `stopWasmPlugin()` - Stop a plugin
  - `unloadWasmPlugin()` - Unload and free memory
  - `reloadWasmPlugin()` - Hot-reload without server restart
  - `handleWasmPluginCrash()` - Automatic crash recovery with exponential backoff
  - `shutdownAllWasmPlugins()` - Graceful shutdown

- **`loader/plugin-config.ts`** - Configuration management
  - `updateWasmPluginConfig()` - Update and persist configuration
  - `setWasmPluginEnabled()` - Enable/disable plugins at runtime

- **`loader/plugin-routes.ts`** - HTTP route handling
  - `setupWasmPluginRoutes()` - Basic REST API (GET/POST /config)
  - `setupPluginSpecificRoutes()` - Custom plugin endpoints
  - `handleLogViewerRequest()` - Node.js log streaming for large data
  - Express route registration and removal

- **`loader/index.ts`** - Public API entry point
  - Re-exports all public functions
  - Single import point for consumers

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

**Phase 1 (Core Infrastructure) - ✅ COMPLETE**
- ✅ Dependencies added (@wasmer/wasi, @assemblyscript/loader, as-fetch)
- ✅ Runtime initialization implemented (wasm-runtime.ts)
- ✅ VFS storage layer implemented (wasm-storage.ts)
- ✅ Plugin loader with hot-reload (loader/)
- ✅ ServerAPI FFI bridge (wasm-serverapi.ts)
- ✅ Delta subscription manager (wasm-subscriptions.ts)
- ✅ Integration with existing plugin system (src/interfaces/plugins.ts)
- ✅ Server initialization (src/index.ts)
- ✅ Network API support (fetch integration)
- ✅ AssemblyScript SDK published (`signalk-assemblyscript-plugin-sdk`)
- ✅ Example plugins (hello-assemblyscript, weather-plugin, signalk-logviewer)

**Phase 2 (Code Quality) - ✅ COMPLETE**
- ✅ Refactored loader into modular architecture (6 focused modules)
- ✅ Fixed Plugin Config UI for disabled plugins
- ✅ Implemented full runtime enable/disable with unload/reload
- ✅ Added special handling for large data streams (logviewer)

## Architecture Benefits

The modular loader architecture provides:

1. **Better Maintainability**: Each module has a single, clear responsibility
2. **Easier Navigation**: Find functionality quickly by module purpose
3. **Race Condition Prevention**: Related async operations kept together
4. **Clean Dependencies**: Minimal circular dependencies via forward references
5. **Testability**: Smaller modules are easier to unit test

### Circular Dependency Resolution

The loader modules use a forward reference pattern to avoid circular dependencies:

```typescript
// In plugin-registry.ts
let startWasmPluginRef: typeof import('./plugin-lifecycle').startWasmPlugin
let stopWasmPluginRef: typeof import('./plugin-lifecycle').stopWasmPlugin

export function initializeLifecycleFunctions(
  startFn: typeof startWasmPluginRef,
  stopFn: typeof stopWasmPluginRef
) {
  startWasmPluginRef = startFn
  stopWasmPluginRef = stopFn
}

// In loader/index.ts
import { initializeLifecycleFunctions } from './plugin-registry'
import { startWasmPlugin, stopWasmPlugin } from './plugin-lifecycle'

initializeLifecycleFunctions(startWasmPlugin, stopWasmPlugin)
```

This pattern allows `plugin-registry` to call lifecycle functions without directly importing them, breaking the circular dependency while maintaining type safety.

## Next Steps

**Phase 3 - Production Hardening:**
1. Add comprehensive unit tests for each loader module
2. Implement plugin dependency resolution
3. Add plugin versioning and compatibility checks
4. Performance profiling and optimization
5. Security audit of capability enforcement
6. Documentation for plugin developers

**Phase 4 - Rust Support:**
1. Complete Rust SDK with WIT bindings
2. Rust example plugins
3. Cross-language testing (AS ↔ Rust)
