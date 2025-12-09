---
title: WASM Plugins
children:
  - assemblyscript.md
  - rust.md
  - go.md
  - dotnet.md
  - http_endpoints.md
  - deltas.md
  - capabilities.md
  - best_practices.md
---

# WASM Plugin Development Guide

## Overview

This guide covers how to develop WASM/WASIX plugins for Signal K Server 3.0. WASM plugins run in a secure sandbox with isolated storage and capability-based permissions.

## What Makes a WASM Plugin?

A WASM plugin is identified by the **`wasmManifest`** field in `package.json`:

```json
{
  "name": "my-plugin-name",
  "wasmManifest": "plugin.wasm",
  "wasmCapabilities": { ... }
}
```

**Key points:**

- **`wasmManifest`** (required): Path to the compiled `.wasm` file. This field tells Signal K to load this as a WASM plugin instead of a Node.js plugin.
- **`wasmCapabilities`** (required): Declares what permissions the plugin needs (network, storage, etc.)
- **Package name** (flexible): Can be anything - `my-plugin`, `@myorg/my-plugin`, etc. There is **no requirement** to use `@signalk/` scope.
- **Keywords**: Include both `signalk-node-server-plugin` and `signalk-wasm-plugin` for discovery

## Language Options

Signal K Server 3.0 supports multiple languages for WASM plugin development:

- **AssemblyScript** - TypeScript-like syntax, easiest for JS/TS developers, smallest binaries (3-10 KB)
- **Rust** - Best performance and tooling, medium binaries (50-200 KB)
- **Go/TinyGo** - Go via TinyGo compiler, medium binaries (50-150 KB)
- **C#/.NET** - **NOT WORKING** - .NET 10 with componentize-dotnet produces WASI Component Model (P2/P3) format. Currently incompatible with Node.js/jco runtime. See [Creating C#/.NET Plugins](./dotnet.md) for details.

## Prerequisites

### For AssemblyScript Plugins

- Node.js >= 20
- npm or yarn
- AssemblyScript: `npm install --save-dev assemblyscript`

### For Rust Plugins

- Rust toolchain: `rustup`
- WASI Preview 1 target: `rustup target add wasm32-wasip1`

> **Note**: Signal K uses WASI Preview 1 (`wasm32-wasip1`), not the older `wasm32-wasi` target. The `wasm32-wasip1` target is the modern Rust target name for WASI Preview 1.

### For Go/TinyGo Plugins

- TinyGo compiler: https://tinygo.org/getting-started/install/
- Go 1.21+ (for development/testing)

```bash
# Verify TinyGo installation
tinygo version
# Should show: tinygo version 0.30.0 (or later)
```

### For C#/.NET Plugins

- .NET 10 SDK: Download from https://dotnet.microsoft.com/download/dotnet/10.0
- componentize-dotnet templates: `dotnet new install BytecodeAlliance.Componentize.DotNet.Templates`
- Windows: Visual Studio 2022 or VS Code with C# extension
- Verify installation: `dotnet --version` should show `10.0.x`

## Why WASM Plugins?

### Benefits

- **Security**: Sandboxed execution with no access to host system
- **Hot-reload**: Update plugins without server restart
- **Multi-language**: Write plugins in Rust, AssemblyScript, and more
- **Crash isolation**: Plugin crashes don't affect server
- **Performance**: Near-native performance with WASM
- **Small binaries**: 3-200 KB depending on language

### Current Capabilities

- **Delta Emission**: Send SignalK deltas to update vessel data
- **Status & Error Reporting**: Set plugin status and error messages
- **Configuration**: JSON schema-based configuration
- **Data Storage**: VFS-isolated file storage
- **HTTP Endpoints**: Register custom REST API endpoints
- **Static Files**: Serve web UI from `public/` directory
- **Command Execution**: Whitelisted shell commands (logs only)
- **Network Access**: HTTP requests via as-fetch (AssemblyScript)
- **Resource Providers**: Serve SignalK resources
- **Weather Providers**: Integrate with Signal K Weather API
- **Radar Providers**: Integrate with Signal K Radar API

### Upcoming Features

- **Direct Serial Ports**: Serial device access

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

**[Jump to AssemblyScript Guide](./assemblyscript.md)**

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

**[Jump to Rust Guide](./rust.md)**

### Go/TinyGo - For Go Developers

**Best for:**

- Go developers wanting to write plugins
- Medium complexity plugins
- Resource providers with hybrid patterns

**Pros:**

- Familiar Go syntax
- Good standard library support
- Medium binaries (50-150 KB)
- Strong typing

**Cons:**

- Requires TinyGo (not standard Go)
- Some Go features unavailable
- Slower than Rust

**[Jump to Go/TinyGo Guide](./go.md)**

### C#/.NET - NOT CURRENTLY WORKING

> **Status: Non-functional** - Waiting for better tooling

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

**[Jump to C#/.NET Guide](./dotnet.md)** (reference only)
