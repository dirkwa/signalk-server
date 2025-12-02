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
import loader from '@assemblyscript/loader'
import { FetchHandler } from 'as-fetch/bindings.raw.esm.js'

const debug = Debug('signalk:wasm:runtime')

// Initialize fetch for as-fetch integration
// Node.js 18+ has native fetch, fallback to node-fetch for older versions
let nodeFetch: typeof fetch
try {
  // Try to use native Node.js fetch (Node 18+)
  const nativeFetch = globalThis.fetch
  if (!nativeFetch) {
    throw new Error('Native fetch not available')
  }

  // Wrap native fetch to handle headers properly for as-fetch
  // as-fetch may pass headers in formats that Node.js fetch doesn't accept
  nodeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const sanitizedInit = init ? { ...init } : {}

    // Ensure headers are in a format Node.js fetch accepts
    if (sanitizedInit.headers) {
      // Convert headers to plain object if needed
      const headers = sanitizedInit.headers

      // Check if it's already a plain object with string keys
      if (typeof headers === 'object' && !Array.isArray(headers) && !(headers instanceof Headers)) {
        // Check if it's a plain object by looking at constructor
        if (Object.getPrototypeOf(headers) === Object.prototype || Object.getPrototypeOf(headers) === null) {
          // It's already a plain object, keep it as-is
          sanitizedInit.headers = headers as Record<string, string>
        } else {
          // It's some other object type, try to convert it
          const headersObj: Record<string, string> = {}
          try {
            for (const [key, value] of Object.entries(headers)) {
              headersObj[key] = String(value)
            }
            sanitizedInit.headers = headersObj
          } catch (err) {
            debug('Error converting headers:', err)
            sanitizedInit.headers = {}
          }
        }
      } else if (Array.isArray(headers)) {
        // Convert array of arrays to object
        const headersObj: Record<string, string> = {}
        for (const [key, value] of headers) {
          headersObj[key] = value
        }
        sanitizedInit.headers = headersObj
      } else if (headers instanceof Headers) {
        // Convert Headers instance to plain object
        const headersObj: Record<string, string> = {}
        headers.forEach((value, key) => {
          headersObj[key] = value
        })
        sanitizedInit.headers = headersObj
      } else {
        // Unknown format, start fresh
        sanitizedInit.headers = {}
      }
    } else {
      // Provide default headers if none specified
      sanitizedInit.headers = {}
    }

    return nativeFetch(input, sanitizedInit)
  }
} catch {
  // If native fetch not available, could use node-fetch polyfill
  // For now, we'll just use a stub that logs an error
  debug('Warning: Native fetch not available, network capability will be limited')
  nodeFetch = async () => {
    throw new Error('Fetch not available - Node.js 18+ required for network capability')
  }
}

export interface WasmCapabilities {
  network: boolean
  storage: 'vfs-only' | 'none'
  dataRead: boolean
  dataWrite: boolean
  serialPorts: boolean
  putHandlers: boolean
  httpEndpoints?: boolean
  resourceProvider?: boolean
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
    start: (config: string) => number | Promise<number> // 0 = success, non-zero = error (async for Asyncify support)
    stop: () => number
    memory?: WebAssembly.Memory
    // Optional: HTTP endpoint registration
    http_endpoints?: () => string // Returns JSON array of endpoint definitions
  }
  // AssemblyScript loader instance (if AssemblyScript plugin)
  asLoader?: any
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

      // First check if this is an AssemblyScript plugin by inspecting exports
      debug(`Compiling WASM module for inspection...`)
      let module: WebAssembly.Module
      try {
        module = await WebAssembly.compile(wasmBuffer)
        debug(`WASM module compiled successfully`)
      } catch (compileError) {
        debug(`WASM compilation failed: ${compileError}`)
        throw compileError
      }

      // Inspect module imports and exports to determine plugin type
      const imports = WebAssembly.Module.imports(module)
      const moduleExports = WebAssembly.Module.exports(module)
      debug(`Module has ${imports.length} imports, ${moduleExports.length} exports`)
      debug(`Module imports: ${JSON.stringify(imports.map(i => `${i.module}.${i.name}`).slice(0, 20))}`)

      const isAssemblyScriptPlugin = moduleExports.some(e => e.name === 'plugin_id')
      const isRustPlugin = moduleExports.some(e => e.name === '_start')

      debug(`Plugin type detection: AS=${isAssemblyScriptPlugin}, Rust=${isRustPlugin}`)

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

            // Update plugin status in Signal K server
            if (app && app.setPluginStatus) {
              app.setPluginStatus(pluginId, message)
            }
          } catch (error) {
            debug(`Plugin set status error: ${error}`)
          }
        },
        sk_set_error: (ptr: number, len: number) => {
          try {
            const message = readUtf8String(ptr, len)
            debug(`[${pluginId}] Error: ${message}`)

            // Update plugin error in Signal K server
            if (app && app.setPluginError) {
              app.setPluginError(pluginId, message)
            }
          } catch (error) {
            debug(`Plugin set error error: ${error}`)
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
        },
        // Privileged operation: Execute shell command (for log reading, journalctl, etc.)
        sk_exec_command: (cmdPtr: number, cmdLen: number, outPtr: number, outMaxLen: number): number => {
          try {
            const command = readUtf8String(cmdPtr, cmdLen)
            debug(`[${pluginId}] Executing command: ${command}`)

            // Security: Only allow specific whitelisted commands for logs
            const allowedCommands = [
              /^journalctl\s+-u\s+signalk/,  // journalctl for signalk service
              /^cat\s+\/var\/log\//,         // Read log files
              /^tail\s+-n\s+\d+\s+\//,       // Tail log files
            ]

            const isAllowed = allowedCommands.some(pattern => pattern.test(command))
            if (!isAllowed) {
              debug(`[${pluginId}] Command not allowed: ${command}`)
              return 0 // Return 0 bytes written
            }

            // Execute command
            const { execSync } = require('child_process')
            const output = execSync(command, {
              encoding: 'utf8',
              maxBuffer: 10 * 1024 * 1024, // 10MB max
              timeout: 30000 // 30 second timeout
            })

            // Write output to WASM memory
            const outputBytes = Buffer.from(output, 'utf8')
            const bytesToWrite = Math.min(outputBytes.length, outMaxLen)

            if (rawExports.memory) {
              const memory = rawExports.memory as WebAssembly.Memory
              const memView = new Uint8Array(memory.buffer)
              memView.set(outputBytes.slice(0, bytesToWrite), outPtr)
            }

            return bytesToWrite
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            debug(`[${pluginId}] Command execution error: ${errorMsg}`)
            return 0
          }
        },
        // Capability checking - used by network API
        sk_has_capability: (capPtr: number, capLen: number): number => {
          try {
            const capability = readUtf8String(capPtr, capLen)
            debug(`[${pluginId}] Checking capability: ${capability}`)

            // Check if plugin has requested capability
            if (capability === 'network') {
              return capabilities.network ? 1 : 0
            }
            // Add more capabilities as needed
            return 0
          } catch (error) {
            debug(`Plugin capability check error: ${error}`)
            return 0
          }
        }
      }

      // Initialize as-fetch handler for network capability
      let fetchHandler: any = null
      let fetchImports = {}

      if (capabilities.network) {
        debug(`Setting up as-fetch handler for network capability`)

        // Create a wrapper that reads strings from WASM memory
        const fetchWrapper = async (urlPtr: number | string | URL | RequestInfo, init?: RequestInit) => {
          let url: string

          // If urlPtr is a number, it's a WASM memory pointer - read the string
          if (typeof urlPtr === 'number') {
            if (!memoryRef) {
              throw new Error('WASM memory not available for string conversion')
            }

            // Read the string from WASM memory using AssemblyScript string layout
            // AssemblyScript stores strings as UTF-16LE with metadata before the pointer
            // SIZE_OFFSET = -4 means the byte length is stored 4 bytes before ptr
            const SIZE_OFFSET = -4
            const memView = new Uint32Array(memoryRef.buffer)

            // Get byte length from SIZE_OFFSET, then convert to UTF-16 char count
            const strLengthInBytes = memView[(urlPtr + SIZE_OFFSET) >>> 2]
            const strLengthInChars = strLengthInBytes >>> 1  // Divide by 2 for UTF-16

            // String data starts at ptr (not ptr+4)
            const strView = new Uint16Array(memoryRef.buffer, urlPtr, strLengthInChars)
            url = String.fromCharCode(...Array.from(strView))
            debug(`Converted WASM string pointer ${urlPtr} to URL: ${url}`)
          } else {
            url = String(urlPtr)
          }

          return nodeFetch(url, init)
        }

        fetchHandler = new FetchHandler(fetchWrapper)
        fetchImports = fetchHandler.imports
      }

      // Use different instantiation methods based on plugin type
      let instance: WebAssembly.Instance
      let asLoaderInstance: any = null
      let rawExports: any

      if (isAssemblyScriptPlugin) {
        // Use AssemblyScript loader for automatic string handling
        debug(`Using AssemblyScript loader for ${pluginId}`)

        asLoaderInstance = await loader.instantiate(module, {
          wasi_snapshot_preview1: wasiImports.wasi_snapshot_preview1 || wasiImports,
          env: envImports,
          ...fetchImports
        })

        instance = asLoaderInstance.instance
        rawExports = asLoaderInstance.exports
        debug(`AssemblyScript instance created with loader`)
      } else {
        // Standard WebAssembly instantiation for Rust plugins
        instance = await WebAssembly.instantiate(module, {
          wasi_snapshot_preview1: wasiImports.wasi_snapshot_preview1 || wasiImports,
          env: envImports,
          ...fetchImports
        } as any)
        rawExports = instance.exports as any
        debug(`Standard WASM instance created`)
      }

      // Set memory reference for UTF-8 string reading in FFI callbacks
      if (rawExports.memory) {
        memoryRef = rawExports.memory as WebAssembly.Memory
      }

      // Store reference to the function that needs to be resumed
      let asyncifyResumeFunction: (() => any) | null = null

      // Initialize as-fetch handler if network capability is enabled
      if (fetchHandler && capabilities.network) {
        debug(`Initializing as-fetch handler with exports`)
        // The second parameter is the "main function" that gets called after async operations complete
        // This function needs to re-call the WASM function to continue execution in rewind state
        fetchHandler.init(rawExports, () => {
          debug(`FetchHandler calling main function to resume execution`)
          if (asyncifyResumeFunction) {
            asyncifyResumeFunction()
          }
        })
      }

      // Initialize based on plugin type
      if (isRustPlugin) {
        // Rust plugin - start WASI
        debug(`Initializing Rust plugin: ${pluginId}`)
        wasi.start(instance)
      } else if (isAssemblyScriptPlugin) {
        // AssemblyScript plugin - no _start needed
        debug(`Initialized AssemblyScript plugin: ${pluginId}`)
      } else {
        throw new Error(`Unknown WASM plugin format for ${pluginId}`)
      }

      // Create normalized export interface
      let idFunc: () => string
      let nameFunc: () => string
      let schemaFunc: () => string
      let startFunc: (config: string) => number | Promise<number>
      let stopFunc: () => number

      if (isAssemblyScriptPlugin && asLoaderInstance) {
        // AssemblyScript loader provides __getString to decode string pointers
        // The exported functions return pointers, we decode them with __getString
        idFunc = () => {
          const ptr = asLoaderInstance.exports.plugin_id()
          return asLoaderInstance.exports.__getString(ptr)
        }
        nameFunc = () => {
          const ptr = asLoaderInstance.exports.plugin_name()
          return asLoaderInstance.exports.__getString(ptr)
        }
        schemaFunc = () => {
          const ptr = asLoaderInstance.exports.plugin_schema()
          return asLoaderInstance.exports.__getString(ptr)
        }

        // For plugin_start, encode config as UTF-8 bytes and copy to WASM memory
        // This function now supports Asyncify for async operations like fetchSync()
        startFunc = async (config: string) => {
          debug(`Calling plugin_start with config: ${config.substring(0, 100)}...`)
          // Encode string as UTF-8 bytes
          const encoder = new TextEncoder()
          const configBytes = encoder.encode(config)
          const configLen = configBytes.length

          // Allocate memory in WASM for the UTF-8 bytes
          const configPtr = asLoaderInstance.exports.__new(configLen, 0) // id=0 for ArrayBuffer

          // Copy UTF-8 bytes to WASM memory
          const memory = asLoaderInstance.exports.memory.buffer
          const memoryView = new Uint8Array(memory)
          memoryView.set(configBytes, configPtr)

          // Set up the resume function BEFORE calling plugin_start to avoid race condition
          // The FetchHandler might complete very quickly and call the main function immediately
          let resumePromiseResolve: (() => void) | null = null
          const resumePromise = new Promise<void>((resolve) => {
            resumePromiseResolve = resolve
          })

          asyncifyResumeFunction = () => {
            // Re-call plugin_start to continue execution in rewind state (state 2)
            debug(`Re-calling plugin_start to resume from rewind state`)
            const resumeResult = asLoaderInstance.exports.plugin_start(configPtr, configLen)
            if (resumePromiseResolve) {
              resumePromiseResolve()
            }
            return resumeResult
          }

          // Call plugin_start - this may trigger Asyncify
          let result = asLoaderInstance.exports.plugin_start(configPtr, configLen)

          // Check if Asyncify is available and the function is in unwound state
          if (typeof asLoaderInstance.exports.asyncify_get_state === 'function') {
            const state = asLoaderInstance.exports.asyncify_get_state()
            debug(`Asyncify state after plugin_start: ${state}`)

            if (state === 1) {
              // State 1 = unwound (async operation in progress)
              // The FetchHandler will handle the async operation and call the main function to resume
              debug(`Plugin is in unwound state - waiting for async operation to complete`)

              // Wait for the FetchHandler to complete the async operation and call the resume function
              await resumePromise

              debug(`Async operation completed, plugin execution resumed`)
            } else {
              // Clear the resume function if we didn't need it
              asyncifyResumeFunction = null
            }
          }

          // Free the allocated memory if __free is available
          // Note: Some AS builds may not export __free
          if (typeof asLoaderInstance.exports.__free === 'function') {
            asLoaderInstance.exports.__free(configPtr)
          }

          return result
        }
        stopFunc = () => asLoaderInstance.exports.plugin_stop()
      } else {
        // Rust plugins return JavaScript strings directly
        idFunc = rawExports.id
        nameFunc = rawExports.name
        schemaFunc = rawExports.schema
        startFunc = rawExports.start
        stopFunc = rawExports.stop
      }

      // Wrap http_endpoints if it exists
      const httpEndpointsFunc = rawExports.http_endpoints
        ? (isAssemblyScriptPlugin && asLoaderInstance
            ? () => {
                const ptr = asLoaderInstance.exports.http_endpoints()
                return asLoaderInstance.exports.__getString(ptr)
              }
            : rawExports.http_endpoints)
        : undefined

      const exports = {
        id: idFunc,
        name: nameFunc,
        schema: schemaFunc,
        start: startFunc,
        stop: stopFunc,
        memory: rawExports.memory,
        ...(httpEndpointsFunc && { http_endpoints: httpEndpointsFunc })
      }

      const pluginInstance: WasmPluginInstance = {
        pluginId,
        wasmPath,
        vfsRoot,
        capabilities,
        wasi,
        module,
        instance,
        exports,
        asLoader: asLoaderInstance
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
