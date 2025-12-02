# WASM Runtime Changelog

All notable changes to the SignalK WASM runtime since forking from v2.18.0.

## [3.0.0-alpha.5] - 2025-12-03

### Investigated - C#/.NET WASM Support

#### Status: NOT CURRENTLY WORKING

Attempted to add C#/.NET as a third WASM plugin language option using componentize-dotnet. After extensive investigation, discovered fundamental incompatibility between componentize-dotnet and Node.js/V8 (via jco transpilation).

**What Was Tested:**
- .NET 10.0 Preview with `BytecodeAlliance.Componentize.DotNet.Wasm.SDK` 0.7.0-preview00010
- WASI Component Model (P2) compilation target
- jco 1.10.0 for JavaScript transpilation

**What Works:**
- Building .NET WASI Component: ✅
- Transpiling with jco to JavaScript: ✅
- Plugin initialization (`$init`): ✅
- Plugin registration in Signal K: ✅

**What Fails:**
- Calling any exported function results in: `RuntimeError: null function or function signature mismatch`
- Root cause: .NET NativeAOT uses indirect call tables (`call_indirect`) that are initialized by `_initialize()`. This works in Wasmtime but table entries remain null in V8.

**Workarounds Attempted (None Successful):**
1. Manual `_initialize()` call - No effect
2. Manual `InitializeModules()` call - Crashes (already called by `_initialize`)
3. Various jco flags (`--instantiation sync`, `--tla-compat`) - No effect
4. Removing `[ThreadStatic]` attribute - Fixed build issues but not runtime

**Conclusion:**
componentize-dotnet explicitly only supports Wasmtime and WAMR runtimes, not V8/JavaScript. This is a known limitation documented in their README. The issue is deeply embedded in how .NET NativeAOT-LLVM structures WASM output.

**Issue Filed:**
https://github.com/bytecodealliance/componentize-dotnet/issues/103

**Files Created:**
- `examples/wasm-plugins/anchor-watch-dotnet/` - Complete example with documentation
- `examples/wasm-plugins/anchor-watch-dotnet/ISSUE_REPORT.md` - Detailed technical report

**Documentation Updated:**
- `wasm/WASM_PLUGIN_DEV_GUIDE.md` - C#/.NET section marked as NOT WORKING
- `examples/wasm-plugins/anchor-watch-dotnet/README.md` - Marked as NOT WORKING with explanation

**Future Possibilities:**
- Wait for componentize-dotnet to add V8/jco support
- Alternative: Mono interpreter approach (different compilation strategy)
- Alternative: Direct Wasmtime embedding in Node.js (if/when available)

---

## [3.0.0-alpha.4] - 2025-01-02

### Added - Asyncify Support for Network Requests

#### FetchHandler Integration
- Integrated `as-fetch/bindings.raw.esm.js` for HTTP request handling in WASM plugins
- Added FetchHandler initialization with resume callback in `wasm-runtime.ts`
- Implemented Asyncify state machine support (Normal, Unwound, Rewound states)
- Added automatic detection and handling of Asyncify state transitions
- Implemented Promise-based async/await pattern for plugin_start()

**Files Modified:**
- `wasm-runtime.ts` (lines 451-566)
  - FetchHandler initialization with main function callback
  - Async plugin_start() with race condition prevention
  - Asyncify state checking and Promise handling
  - Type updates: `start: (config: string) => number | Promise<number>`
- `loader/plugin-lifecycle.ts` (line 106)
  - Made start() await async plugin_start() call
- `wasm-loader.ts`
  - Added FetchHandler import and initialization

**Key Features:**
- Race condition prevention: Promise/callback setup BEFORE calling plugin_start()
- Automatic state transition handling (no developer intervention needed)
- Supports `fetchSync()` from as-fetch library for synchronous-style HTTP requests

### Fixed - Config File Path Resolution

#### Plugin ID Mismatch Issue
- Fixed config file not found on server restart due to plugin ID mismatch
- Changed plugin discovery to load WASM first to get real plugin ID
- Use real plugin ID for config file lookup instead of package name derivation

**Problem:**
- Startup used `weather-plugin-example` (from package name `@signalk/weather-plugin-example`)
- Actual plugin ID from WASM: `weather-example`
- Config file saved by UI: `weather-example.json`
- Startup looked for: `weather-plugin-example.json` ❌

**Solution:**
- Load WASM module at startup to extract real plugin ID
- Use real ID for all config operations
- Reuse loaded instance for enabled plugins (no double-loading)

**Files Modified:**
- `loader/plugin-registry.ts` (lines 85-185)
  - Load WASM first (lines 85-106)
  - Extract plugin ID from exports (line 103)
  - Check config using real ID (lines 109-110)
  - Reuse instance for enabled plugins (line 185)

### Added - Enhanced Logging

#### WASM Plugin Lifecycle Logging
- Added comprehensive debug logging for plugin discovery and lifecycle
- Added structured logging with `signalk:wasm:*` namespaces
- Improved error messages with context and troubleshooting hints

**Log Namespaces:**
- `signalk:wasm:loader` - Plugin discovery and registration
- `signalk:wasm:runtime` - WASM runtime operations and Asyncify
- `signalk:wasm:lifecycle` - Plugin start/stop/reload events
- `signalk:wasm:api` - Server API calls from WASM

**Files Modified:**
- `wasm-runtime.ts` - Added Asyncify state logging
- `loader/plugin-registry.ts` - Added discovery and config loading logs
- `loader/plugin-lifecycle.ts` - Added lifecycle event logs

### Dependencies

#### Added
- `as-fetch` (^2.1.4) - HTTP client library for AssemblyScript with Asyncify support
- `@assemblyscript/loader` (^0.27.x) - AssemblyScript WASM loader

**Files Modified:**
- Root `package.json` - Added as-fetch and @assemblyscript/loader dependencies

### Examples

#### Weather Plugin v0.1.8
Production-ready example demonstrating:
- Asyncify integration with `fetchSync()`
- Real API integration (OpenWeatherMap)
- Network capability usage
- Delta emission for multiple paths
- Configuration schema with validation
- Auto-restart support

**Files:**
- `examples/wasm-plugins/weather-plugin/assembly/index.ts`
  - Complete implementation using fetchSync()
  - Proper error handling and status reporting
- `examples/wasm-plugins/weather-plugin/package.json`
  - Version 0.1.8
  - Dependencies: as-fetch, signalk-assemblyscript-plugin-sdk
  - Capabilities: network, storage, dataRead, dataWrite
- `examples/wasm-plugins/weather-plugin/asconfig.json`
  - Critical: `"transform": ["as-fetch/transform"]` for Asyncify
  - `"bindings": "esm"` for FetchHandler
  - `"exportRuntime": true` for Asyncify state functions
- `examples/wasm-plugins/weather-plugin/README.md`
  - Comprehensive developer onboarding guide
  - Asyncify explanation and usage patterns
  - Troubleshooting guide
  - Configuration requirements

### Documentation

#### Asyncify Implementation Guide
- Created `wasm/ASYNCIFY_IMPLEMENTATION.md`
- Detailed technical architecture documentation
- State machine explanation
- Race condition prevention details
- Debugging guide with log examples
- Common issues and solutions

#### Weather Plugin README
- Complete onboarding guide for new developers
- Step-by-step quick start
- Asyncify concept explanation
- Critical configuration files breakdown
- Code examples with explanations
- Troubleshooting section
- API reference

### Breaking Changes

None. All changes are additive and backward compatible.

### Migration Guide

Existing WASM plugins continue to work without changes. To add network capability:

1. Add as-fetch dependency: `npm install as-fetch@^2.1.4`
2. Enable Asyncify transform in `asconfig.json`:
   ```json
   {
     "options": {
       "bindings": "esm",
       "exportRuntime": true,
       "transform": ["as-fetch/transform"]
     }
   }
   ```
3. Enable network capability in `package.json`:
   ```json
   {
     "wasmCapabilities": {
       "network": true
     }
   }
   ```
4. Use fetchSync() in your plugin:
   ```typescript
   import { fetchSync } from 'as-fetch/sync'

   const response = fetchSync('https://api.example.com/data')
   if (response && response.status === 200) {
     const data = response.text()
     // Process data...
   }
   ```

### Technical Details

#### Asyncify State Machine

**State 0 (Normal)**: Regular WASM execution
- Plugin code runs normally
- No async operations in progress

**State 1 (Unwound/Paused)**: Async operation started
- WASM execution paused
- HTTP request happening in JavaScript
- Call stack saved to Asyncify memory

**State 2 (Rewound/Resuming)**: Async operation completed
- JavaScript callback triggers resume
- WASM execution continues from pause point
- Returns to State 0 (Normal)

#### Race Condition Prevention

The runtime sets up the resume callback BEFORE calling plugin_start() to prevent the callback being undefined if the HTTP request completes very quickly:

```typescript
// 1. Set up Promise and callback FIRST
asyncifyResumeFunction = () => {
  // Re-call plugin_start to continue from rewind state
}

// 2. THEN call plugin_start
let result = asLoaderInstance.exports.plugin_start(configPtr, configLen)

// 3. If unwound, wait for Promise
if (state === 1) {
  await resumePromise
}
```

### Performance Considerations

- **Minimal Overhead**: Asyncify only activates when async operations are used
- **No Double-Loading**: Plugin loaded once, instance reused for enabled plugins
- **Efficient State Management**: Asyncify state checked only when necessary
- **Memory Safe**: All WASM memory operations properly bounded and validated

### Security Considerations

- **Capability System**: Network access requires explicit `"network": true` capability
- **Sandboxed Execution**: WASM plugins run in isolated environment
- **No Direct System Access**: All I/O goes through controlled FFI bridge
- **HTTPS Enforcement**: Recommended for all production API calls

### Known Limitations

- **Node.js 18+ Required**: Native fetch API needed for as-fetch
- **Single Thread**: WASM execution is single-threaded
- **No Streaming**: HTTP responses loaded entirely into memory
- **Asyncify Overhead**: Small performance cost for state machine management

### Future Enhancements

Potential improvements for future versions:
- POST/PUT/DELETE request support with as-fetch
- WebSocket support for real-time data
- Streaming HTTP responses for large data
- HTTP request caching layer
- Rate limiting helpers
- Request retry with exponential backoff

### Credits

- Asyncify implementation based on Binaryen Asyncify transform
- as-fetch library by rockmor (https://github.com/rockmor/as-fetch)
- AssemblyScript compiler and loader (https://www.assemblyscript.org/)

### References

- [Asyncify Implementation Details](../../wasm/ASYNCIFY_IMPLEMENTATION.md)
- [Weather Plugin Example](../../examples/wasm-plugins/weather-plugin/)
- [WASM Plugin Development Guide](../../WASM_PLUGIN_DEV_GUIDE.md)
- [Binaryen Asyncify Documentation](https://github.com/WebAssembly/binaryen/blob/main/src/passes/Asyncify.cpp)
