/**
 * WASM Runtime Management
 *
 * Handles Wasmer WASM runtime initialization, module loading,
 * and instance lifecycle management for Signal K WASM plugins.
 */

/// <reference lib="webworker" />

// Try to use native Node.js WASI first, fall back to @wasmer/wasi
let WASI: any
try {
  // Node.js 20+ has built-in WASI support
  WASI = require('node:wasi').WASI
} catch {
  // Fall back to @wasmer/wasi for older Node versions
  WASI = require('@wasmer/wasi').WASI
}

import * as fs from 'fs'
import * as path from 'path'
import Debug from 'debug'

const debug = Debug('signalk:wasm:runtime')

export interface WasmCapabilities {
  network: boolean
  storage: 'vfs-only' | 'none'
  dataRead: boolean
  dataWrite: boolean
  serialPorts: boolean
  putHandlers: boolean
}

export interface WasmPluginInstance {
  pluginId: string
  wasmPath: string
  vfsRoot: string
  capabilities: WasmCapabilities
  wasi: any  // WASI type varies between Node.js and @wasmer/wasi
  module: WebAssembly.Module
  instance: WebAssembly.Instance
  exports: {
    id: () => string
    name: () => string
    schema: () => string
    start: (config: string) => number // 0 = success, non-zero = error
    stop: () => number
    memory?: WebAssembly.Memory
  }
}

export class WasmRuntime {
  private instances: Map<string, WasmPluginInstance> = new Map()
  private enabled: boolean = true

  constructor() {
    debug('Initializing WASM runtime')
  }

  /**
   * Check if WASM support is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Enable or disable WASM plugin support
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    debug(`WASM support ${enabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * Load and instantiate a WASM plugin module
   */
  async loadPlugin(
    pluginId: string,
    wasmPath: string,
    vfsRoot: string,
    capabilities: WasmCapabilities,
    app?: any
  ): Promise<WasmPluginInstance> {
    if (!this.enabled) {
      throw new Error('WASM support is disabled')
    }

    debug(`Loading WASM plugin: ${pluginId} from ${wasmPath}`)

    try {
      // Ensure VFS root exists
      if (!fs.existsSync(vfsRoot)) {
        fs.mkdirSync(vfsRoot, { recursive: true })
      }

      // Create WASI instance with VFS isolation
      debug(`Creating WASI instance for ${pluginId}`)
      const wasi = new WASI({
        version: 'preview1',
        env: {
          PLUGIN_ID: pluginId
        },
        args: [],
        preopens: {
          '/': vfsRoot // Plugin sees "/" as its isolated VFS root
        }
        // No network access by default
      })
      debug(`WASI instance created`)

      // Load WASM module
      debug(`Reading WASM file: ${wasmPath}`)
      const wasmBuffer = fs.readFileSync(wasmPath)
      debug(`WASM file size: ${wasmBuffer.length} bytes`)

      debug(`Compiling WASM module...`)
      let module: WebAssembly.Module
      try {
        module = await WebAssembly.compile(wasmBuffer)
        debug(`WASM module compiled successfully`)
      } catch (compileError) {
        debug(`WASM compilation failed: ${compileError}`)
        throw compileError
      }

      // Inspect module imports to determine what's needed
      const imports = WebAssembly.Module.imports(module)
      debug(`Module has ${imports.length} imports`)
      debug(`Module imports: ${JSON.stringify(imports.map(i => `${i.module}.${i.name}`).slice(0, 20))}`)

      // Instantiate with WASI imports
      // Note: In Phase 1, we're using basic WASI without full WIT bindings
      // Full WIT integration will be added as we build out the FFI layer

      // Node.js WASI uses getImportObject(), @wasmer/wasi uses getImports()
      const wasiImports = (wasi.getImportObject ? wasi.getImportObject() : wasi.getImports(module)) as any
      debug(`Got WASI imports`)

      // Helper to read UTF-8 buffers from AssemblyScript - will be set after instance creation
      let memoryRef: WebAssembly.Memory | null = null

      const readUtf8String = (ptr: number, len: number): string => {
        if (!memoryRef) {
          throw new Error('AssemblyScript module memory not initialized')
        }

        // The AssemblyScript SDK passes UTF-8 encoded ArrayBuffers to our FFI functions
        // Format: ptr points to UTF-8 bytes, len is the byte length
        const bytes = new Uint8Array(memoryRef.buffer, ptr, len)
        const decoder = new TextDecoder('utf-8')
        return decoder.decode(bytes)
      }

      const readAssemblyScriptString = (ptr: number): string => {
        if (!memoryRef) {
          throw new Error('AssemblyScript module memory not initialized')
        }

        // For plugin metadata functions (id, name, schema), the plugin returns
        // AssemblyScript String objects with this layout:
        // ptr - 8: rtSize (4 bytes) - total allocation size
        // ptr - 4: length (4 bytes) - string content length IN BYTES
        // ptr: string data as UTF-16LE

        const view = new DataView(memoryRef.buffer)
        const lengthInBytes = view.getUint32(ptr - 4, true)

        const bytes = new Uint8Array(memoryRef.buffer, ptr, lengthInBytes)
        const decoder = new TextDecoder('utf-16le')
        return decoder.decode(bytes)
      }

      // Create env imports - our Signal K API functions
      const envImports: any = {
        abort: (msg: number, file: number, line: number, column: number) => {
          debug(`WASM abort called: ${msg} at ${file}:${line}:${column}`)
        },
        seed: () => {
          return Date.now() * Math.random()
        },
        'console.log': (ptr: number, len: number) => {
          try {
            const message = readUtf8String(ptr, len)
            debug(`[${pluginId}] ${message}`)
          } catch (error) {
            debug(`WASM console.log error: ${error}`)
          }
        },
        // Signal K API functions that the plugin imports
        sk_debug: (ptr: number, len: number) => {
          try {
            const message = readUtf8String(ptr, len)
            debug(`[${pluginId}] ${message}`)
          } catch (error) {
            debug(`Plugin debug error: ${error}`)
          }
        },
        sk_set_status: (ptr: number, len: number) => {
          try {
            const message = readUtf8String(ptr, len)
            debug(`[${pluginId}] Status: ${message}`)
          } catch (error) {
            debug(`Plugin set status error: ${error}`)
          }
        },
        sk_handle_message: (ptr: number, len: number) => {
          try {
            const deltaJson = readUtf8String(ptr, len)
            debug(`[${pluginId}] Emitting delta: ${deltaJson.substring(0, 200)}...`)

            // Parse and send delta to Signal K server if app is available
            if (app && app.handleMessage) {
              try {
                const delta = JSON.parse(deltaJson)
                app.handleMessage(pluginId, delta)
                debug(`[${pluginId}] Delta processed by server`)
              } catch (parseError) {
                debug(`[${pluginId}] Failed to parse/process delta: ${parseError}`)
              }
            } else {
              debug(`[${pluginId}] Warning: app.handleMessage not available, delta not processed`)
            }
          } catch (error) {
            debug(`Plugin handle message error: ${error}`)
          }
        }
      }

      const instance = await WebAssembly.instantiate(module, {
        wasi_snapshot_preview1: wasiImports.wasi_snapshot_preview1 || wasiImports,
        env: envImports
      } as any)
      debug(`WASM instance created`)

      // Extract raw exports first to check plugin type
      const rawExports = instance.exports as any

      // Set memory reference for string reading
      if (rawExports.memory) {
        memoryRef = rawExports.memory as WebAssembly.Memory
      }

      // Detect plugin type and initialize accordingly
      // Rust plugins have _start function, AssemblyScript plugins don't
      const isRustPlugin = !!rawExports._start
      const isAssemblyScriptPlugin = !!rawExports.plugin_id

      if (isRustPlugin) {
        // Rust plugin - start WASI
        debug(`Detected Rust plugin: ${pluginId}`)
        wasi.start(instance)
      } else if (isAssemblyScriptPlugin) {
        // AssemblyScript plugin - no _start needed, just use exports directly
        debug(`Detected AssemblyScript plugin: ${pluginId}`)
        // AssemblyScript plugins don't need WASI initialization
        // They export functions directly that we can call
      } else {
        throw new Error(`Unknown WASM plugin format for ${pluginId}`)
      }

      // Create normalized export interface
      // Maps both Rust-style (id, name, schema) and AssemblyScript-style (plugin_id, plugin_name, plugin_schema)

      // Wrap functions based on plugin type
      let idFunc: () => string
      let nameFunc: () => string
      let schemaFunc: () => string
      let startFunc: (config: string) => number
      let stopFunc: () => number

      if (isAssemblyScriptPlugin) {
        // AssemblyScript functions return pointers to strings in memory
        idFunc = () => readAssemblyScriptString(rawExports.plugin_id())
        nameFunc = () => readAssemblyScriptString(rawExports.plugin_name())
        schemaFunc = () => readAssemblyScriptString(rawExports.plugin_schema())

        // start/stop functions work differently - they take/return numbers
        startFunc = (config: string) => {
          // For now, we need to pass config as a pointer too
          // This is a TODO - implement proper string passing
          return rawExports.plugin_start(0, 0)
        }
        stopFunc = () => rawExports.plugin_stop()
      } else {
        // Rust plugins return JavaScript strings directly
        idFunc = rawExports.id
        nameFunc = rawExports.name
        schemaFunc = rawExports.schema
        startFunc = rawExports.start
        stopFunc = rawExports.stop
      }

      const exports = {
        id: idFunc,
        name: nameFunc,
        schema: schemaFunc,
        start: startFunc,
        stop: stopFunc,
        memory: rawExports.memory
      }

      const pluginInstance: WasmPluginInstance = {
        pluginId,
        wasmPath,
        vfsRoot,
        capabilities,
        wasi,
        module,
        instance,
        exports
      }

      this.instances.set(pluginId, pluginInstance)
      debug(`Successfully loaded WASM plugin: ${pluginId}`)

      return pluginInstance
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      debug(`Failed to load WASM plugin ${pluginId}: ${errorMsg}`)
      throw new Error(`Failed to load WASM plugin ${pluginId}: ${errorMsg}`)
    }
  }

  /**
   * Unload a WASM plugin instance
   */
  async unloadPlugin(pluginId: string): Promise<void> {
    const instance = this.instances.get(pluginId)
    if (!instance) {
      debug(`Plugin ${pluginId} not found in loaded instances`)
      return
    }

    debug(`Unloading WASM plugin: ${pluginId}`)

    try {
      // Call stop if available
      if (instance.exports.stop) {
        instance.exports.stop()
      }

      // Remove from instances
      this.instances.delete(pluginId)

      // Let GC clean up the instance
      debug(`Successfully unloaded WASM plugin: ${pluginId}`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      debug(`Error unloading WASM plugin ${pluginId}: ${errorMsg}`)
      throw error
    }
  }

  /**
   * Reload a WASM plugin (unload + load)
   */
  async reloadPlugin(pluginId: string): Promise<WasmPluginInstance> {
    const oldInstance = this.instances.get(pluginId)
    if (!oldInstance) {
      throw new Error(`Plugin ${pluginId} not loaded`)
    }

    const { wasmPath, vfsRoot, capabilities } = oldInstance

    // Unload old instance
    await this.unloadPlugin(pluginId)

    // Load new instance
    return this.loadPlugin(pluginId, wasmPath, vfsRoot, capabilities)
  }

  /**
   * Get a loaded plugin instance
   */
  getInstance(pluginId: string): WasmPluginInstance | undefined {
    return this.instances.get(pluginId)
  }

  /**
   * Get all loaded plugin instances
   */
  getAllInstances(): WasmPluginInstance[] {
    return Array.from(this.instances.values())
  }

  /**
   * Check if a plugin is loaded
   */
  isPluginLoaded(pluginId: string): boolean {
    return this.instances.has(pluginId)
  }

  /**
   * Shutdown the WASM runtime and unload all plugins
   */
  async shutdown(): Promise<void> {
    debug('Shutting down WASM runtime')

    const pluginIds = Array.from(this.instances.keys())
    for (const pluginId of pluginIds) {
      try {
        await this.unloadPlugin(pluginId)
      } catch (error) {
        debug(`Error unloading plugin ${pluginId} during shutdown:`, error)
      }
    }

    this.instances.clear()
    debug('WASM runtime shutdown complete')
  }
}

// Global singleton instance
let runtimeInstance: WasmRuntime | null = null

/**
 * Get the global WASM runtime instance
 */
export function getWasmRuntime(): WasmRuntime {
  if (!runtimeInstance) {
    runtimeInstance = new WasmRuntime()
  }
  return runtimeInstance
}

/**
 * Initialize the WASM runtime
 */
export function initializeWasmRuntime(): WasmRuntime {
  if (runtimeInstance) {
    debug('WASM runtime already initialized')
    return runtimeInstance
  }

  runtimeInstance = new WasmRuntime()
  return runtimeInstance
}
