/**
 * WASM Runtime Management
 *
 * Handles Wasmer WASM runtime initialization, module loading,
 * and instance lifecycle management for Signal K WASM plugins.
 */

/// <reference lib="webworker" />

import { WASI } from '@wasmer/wasi'
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
  wasi: WASI
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
    capabilities: WasmCapabilities
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
      const wasi = new WASI({
        env: {
          PLUGIN_ID: pluginId
        },
        args: [],
        preopens: {
          '/': vfsRoot // Plugin sees "/" as its isolated VFS root
        }
        // No network access by default
      })

      // Load WASM module
      const wasmBuffer = fs.readFileSync(wasmPath)
      const module = await WebAssembly.compile(wasmBuffer)

      // Instantiate with WASI imports
      // Note: In Phase 1, we're using basic WASI without full WIT bindings
      // Full WIT integration will be added as we build out the FFI layer
      const wasiImports = wasi.getImports(module) as any

      const instance = await WebAssembly.instantiate(module, {
        wasi_snapshot_preview1: wasiImports,
        env: {
          // Placeholder for future FFI imports
          // These will be populated by wasm-serverapi.ts
        }
      } as any)

      // Start WASI
      wasi.start(instance)

      // Extract exports (will be properly typed once WIT bindings are in place)
      const exports = instance.exports as any

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
