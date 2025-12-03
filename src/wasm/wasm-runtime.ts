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

/**
 * WASM binary format types
 */
export type WasmFormat = 'wasi-p1' | 'component-model' | 'unknown'

/**
 * Detect the format of a WASM binary by inspecting the magic bytes
 * - WASI P1 modules start with: 0x00 0x61 0x73 0x6D 0x01 0x00 0x00 0x00 (version 1)
 * - Component Model starts with: 0x00 0x61 0x73 0x6D 0x0d 0x00 0x01 0x00 (version 13/0x0d)
 */
export function detectWasmFormat(buffer: Buffer): WasmFormat {
  if (buffer.length < 8) {
    return 'unknown'
  }

  // Check WASM magic number: \0asm
  if (buffer[0] !== 0x00 || buffer[1] !== 0x61 || buffer[2] !== 0x73 || buffer[3] !== 0x6d) {
    return 'unknown'
  }

  // Check version byte (byte 4)
  const version = buffer[4]

  if (version === 0x01) {
    return 'wasi-p1'
  } else if (version === 0x0d) {
    return 'component-model'
  }

  return 'unknown'
}

export interface WasmPluginInstance {
  pluginId: string
  wasmPath: string
  vfsRoot: string
  capabilities: WasmCapabilities
  format: WasmFormat  // Binary format: wasi-p1 or component-model
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
  // Component Model transpiled module (if Component Model plugin)
  componentModule?: any
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

      // Check if wasmPath points to a pre-transpiled jco JavaScript module
      if (wasmPath.endsWith('.js')) {
        debug(`Detected pre-transpiled jco module: ${wasmPath}`)
        return await this.loadPreTranspiledPlugin(pluginId, wasmPath, vfsRoot, capabilities, app)
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

      // Detect WASM binary format (WASI P1 vs Component Model)
      const wasmFormat = detectWasmFormat(wasmBuffer)
      debug(`Detected WASM format: ${wasmFormat}`)

      // Handle Component Model binaries (e.g., from .NET)
      if (wasmFormat === 'component-model') {
        debug(`Component Model detected - using jco transpilation`)
        return await this.loadComponentModelPlugin(pluginId, wasmPath, wasmBuffer, vfsRoot, capabilities, app)
      }

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

      // Detect plugin type by export signatures:
      // - Rust library: has plugin_id AND allocate export (buffer-based strings)
      // - Rust command: has _start export (WASI command)
      // - AssemblyScript: has plugin_id but NOT allocate (uses AS loader for string handling)
      const hasPluginId = moduleExports.some(e => e.name === 'plugin_id')
      const hasAllocate = moduleExports.some(e => e.name === 'allocate')
      const hasStart = moduleExports.some(e => e.name === '_start')

      // Rust library plugins export allocate for buffer management
      const isRustLibraryPlugin = hasPluginId && hasAllocate
      // Rust command plugins have _start
      const isRustPlugin = hasStart
      // AssemblyScript: has plugin_id but NOT allocate (we'll use AS loader for string handling)
      const isAssemblyScriptPlugin = hasPluginId && !hasAllocate && !hasStart

      debug(`Plugin type detection: AS=${isAssemblyScriptPlugin}, RustLib=${isRustLibraryPlugin}, RustCmd=${isRustPlugin}`)

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
        },
        // PUT Handler Registration - allows plugins to handle PUT requests
        sk_register_put_handler: (contextPtr: number, contextLen: number, pathPtr: number, pathLen: number): number => {
          try {
            const context = readUtf8String(contextPtr, contextLen)
            const path = readUtf8String(pathPtr, pathLen)
            debug(`[${pluginId}] Registering PUT handler: context=${context}, path=${path}`)

            // Check if plugin has putHandlers capability
            if (!capabilities.putHandlers) {
              debug(`[${pluginId}] PUT handlers capability not granted`)
              return 0 // Failure
            }

            // Debug: Log app availability
            debug(`[${pluginId}] app available: ${!!app}, app.registerActionHandler available: ${!!(app && app.registerActionHandler)}`)
            if (app) {
              const appKeys = Object.keys(app).filter(k => k.toLowerCase().includes('register') || k.toLowerCase().includes('handler')).slice(0, 10)
              debug(`[${pluginId}] app handler-related keys: ${appKeys.join(', ')}`)
            }

            // Register PUT handler with Signal K server using app.registerActionHandler
            // (app.registerPutHandler is only available on the wrapped appCopy for regular plugins)
            if (app && app.registerActionHandler) {
              // First, send meta message to indicate this path supports PUT
              if (app.handleMessage) {
                app.handleMessage(pluginId, {
                  updates: [
                    {
                      meta: [
                        {
                          path: path,
                          value: {
                            supportsPut: true
                          }
                        }
                      ]
                    }
                  ]
                })
                debug(`[${pluginId}] Sent supportsPut meta for ${path}`)
              }

              // The callback will be invoked when a PUT request arrives
              const callback = (cbContext: string, cbPath: string, value: any, cb: (result: any) => void) => {
                debug(`[${pluginId}] PUT request received: ${cbContext}.${cbPath} = ${JSON.stringify(value)}`)

                // Find the corresponding handler function in WASM exports
                // Handler function name format: handle_put_<context>_<path> (sanitized)
                const handlerName = `handle_put_${cbContext.replace(/\./g, '_')}_${cbPath.replace(/\./g, '_')}`

                // Check both AssemblyScript loader exports and raw exports (for Rust plugins)
                const exports = asLoaderInstance?.exports || rawExports
                const handlerFunc = exports?.[handlerName]

                if (handlerFunc) {
                  debug(`[${pluginId}] Calling WASM handler: ${handlerName}`)

                  // Prepare value JSON (just the value, not the full context)
                  const valueJson = JSON.stringify(value)

                  try {
                    let responseJson: string

                    if (asLoaderInstance) {
                      // AssemblyScript: pass string directly (loader handles conversion)
                      responseJson = handlerFunc(valueJson)
                    } else if (rawExports?.allocate) {
                      // Rust library plugin: use buffer-based string passing
                      const valueBytes = Buffer.from(valueJson, 'utf8')
                      const valuePtr = rawExports.allocate(valueBytes.length)
                      const responseMaxLen = 8192
                      const responsePtr = rawExports.allocate(responseMaxLen)

                      // Write value to WASM memory
                      const memory = rawExports.memory as WebAssembly.Memory
                      const memView = new Uint8Array(memory.buffer)
                      memView.set(valueBytes, valuePtr)

                      // Call handler
                      const writtenLen = handlerFunc(valuePtr, valueBytes.length, responsePtr, responseMaxLen)

                      // Read response from WASM memory
                      const responseBytes = new Uint8Array(memory.buffer, responsePtr, writtenLen)
                      responseJson = new TextDecoder('utf-8').decode(responseBytes)

                      // Deallocate
                      if (rawExports.deallocate) {
                        rawExports.deallocate(valuePtr, valueBytes.length)
                        rawExports.deallocate(responsePtr, responseMaxLen)
                      }
                    } else {
                      throw new Error('Unknown plugin type for PUT handler')
                    }

                    const response = JSON.parse(responseJson)
                    debug(`[${pluginId}] PUT handler response: ${JSON.stringify(response)}`)
                    cb(response)
                  } catch (error) {
                    debug(`[${pluginId}] PUT handler error: ${error}`)
                    cb({
                      state: 'COMPLETED',
                      statusCode: 500,
                      message: `Handler error: ${error}`
                    })
                  }
                } else {
                  debug(`[${pluginId}] Warning: Handler function not found: ${handlerName}`)
                  cb({
                    state: 'COMPLETED',
                    statusCode: 501,
                    message: 'Handler not implemented'
                  })
                }
              }

              app.registerActionHandler(context, path, pluginId, callback)
              debug(`[${pluginId}] PUT handler registered successfully via registerActionHandler`)
              return 1 // Success
            } else {
              debug(`[${pluginId}] app.registerActionHandler not available`)
              return 0
            }
          } catch (error) {
            debug(`Plugin register PUT handler error: ${error}`)
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
        // Rust command plugin - start WASI
        debug(`Initializing Rust command plugin: ${pluginId}`)
        wasi.start(instance)
      } else if (isRustLibraryPlugin) {
        // Rust library plugin - no _start needed, just initialize WASI
        debug(`Initialized Rust library plugin: ${pluginId}`)
        // Call _initialize if it exists (WASI reactor pattern)
        if (rawExports._initialize) {
          debug(`Calling _initialize for Rust library plugin`)
          rawExports._initialize()
        }
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
      } else if (isRustLibraryPlugin) {
        // Rust library plugins use buffer-based string handling
        // Functions like plugin_id(out_ptr, out_max_len) -> written_len
        debug(`Setting up Rust library plugin exports with buffer-based strings`)

        // Helper to call a Rust function that writes to a buffer and returns length
        const callRustStringFunc = (funcName: string): string => {
          const func = rawExports[funcName]
          if (typeof func !== 'function') {
            debug(`Warning: ${funcName} not found in exports`)
            return ''
          }

          // Allocate a buffer in WASM memory for the output
          const maxLen = 8192  // 8KB should be enough for id/name/schema
          const allocate = rawExports.allocate
          if (typeof allocate !== 'function') {
            throw new Error('Rust plugin missing allocate export')
          }

          const outPtr = allocate(maxLen)
          if (!outPtr) {
            throw new Error(`Failed to allocate ${maxLen} bytes for ${funcName}`)
          }

          try {
            // Call the function - it writes to buffer and returns length
            const writtenLen = func(outPtr, maxLen)
            if (writtenLen <= 0) {
              debug(`${funcName} returned ${writtenLen}`)
              return ''
            }

            // Read the string from WASM memory
            const memory = rawExports.memory as WebAssembly.Memory
            const bytes = new Uint8Array(memory.buffer, outPtr, writtenLen)
            const decoder = new TextDecoder('utf-8')
            const result = decoder.decode(bytes)
            debug(`${funcName} returned: ${result.substring(0, 100)}...`)
            return result
          } finally {
            // Deallocate the buffer
            const deallocate = rawExports.deallocate
            if (typeof deallocate === 'function') {
              deallocate(outPtr, maxLen)
            }
          }
        }

        idFunc = () => callRustStringFunc('plugin_id')
        nameFunc = () => callRustStringFunc('plugin_name')
        schemaFunc = () => callRustStringFunc('plugin_schema')

        // plugin_start takes config string as input
        startFunc = (config: string) => {
          debug(`Calling Rust plugin_start with config: ${config.substring(0, 100)}...`)

          const encoder = new TextEncoder()
          const configBytes = encoder.encode(config)
          const configLen = configBytes.length

          // Allocate memory for config
          const allocate = rawExports.allocate
          const configPtr = allocate(configLen)

          // Copy config to WASM memory
          const memory = rawExports.memory as WebAssembly.Memory
          const memoryView = new Uint8Array(memory.buffer)
          memoryView.set(configBytes, configPtr)

          try {
            const result = rawExports.plugin_start(configPtr, configLen)
            debug(`plugin_start returned: ${result}`)
            return result
          } finally {
            const deallocate = rawExports.deallocate
            if (typeof deallocate === 'function') {
              deallocate(configPtr, configLen)
            }
          }
        }

        stopFunc = () => {
          const result = rawExports.plugin_stop()
          debug(`plugin_stop returned: ${result}`)
          return result
        }
      } else {
        // Rust command plugins or unknown - try direct exports
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
        format: 'wasi-p1',
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
   * Load a pre-transpiled jco plugin (JavaScript module)
   *
   * When wasmManifest points to a .js file, it's a pre-transpiled jco output
   * that we can load directly as a JavaScript module.
   */
  private async loadPreTranspiledPlugin(
    pluginId: string,
    jsPath: string,
    vfsRoot: string,
    capabilities: WasmCapabilities,
    app?: any
  ): Promise<WasmPluginInstance> {
    debug(`Loading pre-transpiled jco plugin: ${pluginId} from ${jsPath}`)

    try {
      // Convert to file:// URL for dynamic import on Windows/Unix
      const jsUrl = `file://${jsPath.replace(/\\/g, '/')}`
      debug(`Importing module from: ${jsUrl}`)

      // Create Signal K API callbacks for the plugin
      const signalkApi = this.createComponentSignalkApi(pluginId, app)

      // Try to load and inject callbacks into signalk-api.js before loading main module
      const signalkApiPath = path.join(path.dirname(jsPath), 'signalk-api.js')
      if (fs.existsSync(signalkApiPath)) {
        const signalkApiUrl = `file://${signalkApiPath.replace(/\\/g, '/')}`
        debug(`Injecting Signal K API callbacks from: ${signalkApiUrl}`)
        try {
          const signalkApiModule = await import(signalkApiUrl)
          if (typeof signalkApiModule._setCallbacks === 'function') {
            signalkApiModule._setCallbacks({
              debug: signalkApi.skDebug || signalkApi['sk-debug'],
              setStatus: signalkApi.skSetStatus || signalkApi['sk-set-status'],
              setError: signalkApi.skSetError || signalkApi['sk-set-error'],
              handleMessage: signalkApi.skHandleMessage || signalkApi['sk-handle-message'],
              registerPutHandler: signalkApi.skRegisterPutHandler || signalkApi['sk-register-put-handler']
            })
            debug(`Signal K API callbacks injected successfully`)
          }
        } catch (apiErr) {
          debug(`Could not inject signalk-api callbacks: ${apiErr}`)
        }
      }

      // Import the pre-transpiled module
      const componentModule = await import(jsUrl)
      debug(`Module imported, exports: ${Object.keys(componentModule).join(', ')}`)

      // Wait for WASM initialization if $init is exported (jco --tla-compat mode)
      if (componentModule.$init && typeof componentModule.$init.then === 'function') {
        debug(`Waiting for WASM $init promise...`)
        try {
          await componentModule.$init
          debug(`WASM $init completed successfully`)
        } catch (initError) {
          debug(`WASM $init failed: ${initError}`)
          throw initError
        }
      }

      // Debug: Log all exports from the componentModule after $init
      debug(`After $init, componentModule keys: ${Object.keys(componentModule).join(', ')}`)
      if (componentModule.plugin) {
        debug(`componentModule.plugin keys: ${Object.keys(componentModule.plugin).join(', ')}`)
        // Check if the plugin functions are actually defined
        const pluginFuncs = componentModule.plugin
        debug(`pluginId type: ${typeof pluginFuncs.pluginId}, value: ${pluginFuncs.pluginId}`)
        debug(`pluginName type: ${typeof pluginFuncs.pluginName}, value: ${pluginFuncs.pluginName}`)
        debug(`pluginStart type: ${typeof pluginFuncs.pluginStart}, value: ${pluginFuncs.pluginStart}`)
      }

      // Instantiate the component
      let componentInstance: any

      if (typeof componentModule.instantiate === 'function') {
        debug(`Instantiating via instantiate() function`)
        // jco generates an instantiate function that takes an import resolver
        componentInstance = await componentModule.instantiate(
          (name: string) => {
            debug(`Import resolver called for: ${name}`)
            // Provide our Signal K API for signalk:plugin imports
            if (name.includes('signalk')) {
              return signalkApi
            }
            // WASI imports are handled by the shims bundled in jco output
            return {}
          },
          // Provide core WASM files resolver if needed
          async (coreModule: string) => {
            const corePath = path.join(path.dirname(jsPath), coreModule)
            debug(`Loading core module: ${corePath}`)
            const coreBuffer = fs.readFileSync(corePath)
            return WebAssembly.compile(coreBuffer)
          }
        )
      } else if (componentModule.default) {
        // Some jco outputs export default
        componentInstance = componentModule.default
      } else {
        // Direct exports
        componentInstance = componentModule
      }

      debug(`Component instance created, keys: ${Object.keys(componentInstance || {}).join(', ')}`)

      // Find the plugin exports - jco uses various naming conventions
      let pluginExports = componentInstance?.['signalk:plugin/plugin@1.0.0']
        || componentInstance?.plugin
        || componentInstance?.['signalk:plugin/plugin']
        || componentInstance

      debug(`Plugin exports found, keys: ${Object.keys(pluginExports || {}).join(', ')}`)

      // Map Component Model exports to our standard interface
      const exports = {
        id: () => {
          const fn = pluginExports?.pluginId || pluginExports?.['plugin-id']
          debug(`Calling pluginId, fn type: ${typeof fn}`)
          try {
            const result = typeof fn === 'function' ? fn() : fn
            debug(`plugin_id() = ${result}`)
            return result || pluginId
          } catch (err) {
            debug(`plugin_id() threw error: ${err}`)
            throw err
          }
        },
        name: () => {
          const fn = pluginExports?.pluginName || pluginExports?.['plugin-name']
          const result = typeof fn === 'function' ? fn() : fn
          debug(`plugin_name() = ${result}`)
          return result || pluginId
        },
        schema: () => {
          const fn = pluginExports?.pluginSchema || pluginExports?.['plugin-schema']
          const result = typeof fn === 'function' ? fn() : fn
          debug(`plugin_schema() = ${result}`)
          return result || '{}'
        },
        start: async (config: string) => {
          const fn = pluginExports?.pluginStart || pluginExports?.['plugin-start']
          if (typeof fn === 'function') {
            debug(`Calling plugin_start with config: ${config.substring(0, 100)}...`)
            const result = await fn(config)
            debug(`plugin_start() = ${result}`)
            return typeof result === 'number' ? result : 0
          }
          debug(`No plugin_start function found`)
          return 0
        },
        stop: () => {
          const fn = pluginExports?.pluginStop || pluginExports?.['plugin-stop']
          if (typeof fn === 'function') {
            debug(`Calling plugin_stop`)
            const result = fn()
            debug(`plugin_stop() = ${result}`)
            return typeof result === 'number' ? result : 0
          }
          debug(`No plugin_stop function found`)
          return 0
        }
      }

      // Create a minimal WASI instance for compatibility tracking
      const wasi = new WASI({
        version: 'preview1',
        env: { PLUGIN_ID: pluginId },
        args: [],
        preopens: { '/': vfsRoot }
      })

      // Create plugin instance
      const pluginInstance: WasmPluginInstance = {
        pluginId,
        wasmPath: jsPath,
        vfsRoot,
        capabilities,
        format: 'component-model',
        wasi,
        module: null as any,
        instance: null as any,
        exports,
        componentModule: componentInstance
      }

      this.instances.set(pluginId, pluginInstance)
      debug(`Successfully loaded pre-transpiled jco plugin: ${pluginId}`)

      return pluginInstance
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      debug(`Failed to load pre-transpiled plugin ${pluginId}: ${errorMsg}`)
      if (error instanceof Error && error.stack) {
        debug(`Stack: ${error.stack}`)
      }
      throw new Error(`Failed to load pre-transpiled plugin ${pluginId}: ${errorMsg}`)
    }
  }

  /**
   * Load a WASI Component Model plugin using jco transpilation
   *
   * Component Model binaries (e.g., from .NET 10) cannot be loaded directly
   * by Node.js WASI. We use jco to transpile them to JavaScript + WASI P1.
   */
  private async loadComponentModelPlugin(
    pluginId: string,
    wasmPath: string,
    wasmBuffer: Buffer,
    vfsRoot: string,
    capabilities: WasmCapabilities,
    app?: any
  ): Promise<WasmPluginInstance> {
    debug(`Loading Component Model plugin: ${pluginId}`)

    try {
      // Import jco transpile dynamically
      const { transpile } = await import('@bytecodealliance/jco')

      // Transpile the Component Model WASM to JavaScript bindings
      debug(`Transpiling Component Model to JavaScript...`)

      // Get the output directory for transpiled files
      const transpiledDir = path.join(path.dirname(wasmPath), '.jco-transpiled', pluginId)
      if (!fs.existsSync(transpiledDir)) {
        fs.mkdirSync(transpiledDir, { recursive: true })
      }

      // Transpile the component
      const { files } = await transpile(wasmBuffer, {
        name: pluginId.replace(/[^a-zA-Z0-9]/g, '_'),
        instantiation: 'async',
        map: {
          // Map WASI imports to preview2-shim
          'wasi:cli/*': '@bytecodealliance/preview2-shim/cli#*',
          'wasi:clocks/*': '@bytecodealliance/preview2-shim/clocks#*',
          'wasi:filesystem/*': '@bytecodealliance/preview2-shim/filesystem#*',
          'wasi:io/*': '@bytecodealliance/preview2-shim/io#*',
          'wasi:random/*': '@bytecodealliance/preview2-shim/random#*',
          'wasi:sockets/*': '@bytecodealliance/preview2-shim/sockets#*'
        }
      })

      // Write transpiled files to disk
      for (const [filename, content] of Object.entries(files)) {
        const filePath = path.join(transpiledDir, filename)
        const fileDir = path.dirname(filePath)
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true })
        }
        fs.writeFileSync(filePath, content as Uint8Array)
        debug(`Wrote transpiled file: ${filePath}`)
      }

      // Find the main module file
      const mainModulePath = path.join(transpiledDir, `${pluginId.replace(/[^a-zA-Z0-9]/g, '_')}.js`)
      if (!fs.existsSync(mainModulePath)) {
        // Try to find any .js file
        const jsFiles = Object.keys(files).filter(f => f.endsWith('.js') && !f.endsWith('.d.ts'))
        if (jsFiles.length === 0) {
          throw new Error('No JavaScript module found in transpiled output')
        }
        debug(`Available JS files: ${jsFiles.join(', ')}`)
      }

      // Import the transpiled module
      debug(`Importing transpiled module from: ${mainModulePath}`)
      const componentModule = await import(`file://${mainModulePath}`)

      // Create imports for the component - provide Signal K API
      const signalkApi = this.createComponentSignalkApi(pluginId, app)

      // Instantiate the component with imports
      debug(`Instantiating component...`)
      let componentInstance: any

      // Check if it's an instantiate function or direct exports
      if (typeof componentModule.instantiate === 'function') {
        componentInstance = await componentModule.instantiate(
          (name: string) => {
            // Import resolver - return our Signal K API for signalk:plugin imports
            if (name.startsWith('signalk:plugin/signalk-api')) {
              return signalkApi
            }
            // Return empty object for other imports (WASI shims handle those)
            return {}
          }
        )
      } else {
        // Direct exports - assume it's already instantiated
        componentInstance = componentModule
      }

      debug(`Component instance created`)

      // Extract plugin interface exports
      // Component Model exports are under 'signalk:plugin/plugin@1.0.0'
      let pluginExports = componentInstance['signalk:plugin/plugin@1.0.0']
        || componentInstance.plugin
        || componentInstance

      // Map Component Model exports to our standard interface
      const exports = {
        id: () => {
          const result = pluginExports.pluginId?.() || pluginExports['plugin-id']?.()
          return result || pluginId
        },
        name: () => {
          const result = pluginExports.pluginName?.() || pluginExports['plugin-name']?.()
          return result || pluginId
        },
        schema: () => {
          const result = pluginExports.pluginSchema?.() || pluginExports['plugin-schema']?.()
          return result || '{}'
        },
        start: async (config: string) => {
          const fn = pluginExports.pluginStart || pluginExports['plugin-start']
          if (fn) {
            const result = await fn(config)
            return typeof result === 'number' ? result : 0
          }
          return 0
        },
        stop: () => {
          const fn = pluginExports.pluginStop || pluginExports['plugin-stop']
          if (fn) {
            const result = fn()
            return typeof result === 'number' ? result : 0
          }
          return 0
        }
      }

      // Create a minimal WASI instance for compatibility (not actually used for Component Model)
      const wasi = new WASI({
        version: 'preview1',
        env: { PLUGIN_ID: pluginId },
        args: [],
        preopens: { '/': vfsRoot }
      })

      // Create plugin instance
      const pluginInstance: WasmPluginInstance = {
        pluginId,
        wasmPath,
        vfsRoot,
        capabilities,
        format: 'component-model',
        wasi,
        module: null as any, // Component Model doesn't use WebAssembly.Module directly
        instance: null as any, // Component Model doesn't use WebAssembly.Instance directly
        exports,
        componentModule: componentInstance
      }

      this.instances.set(pluginId, pluginInstance)
      debug(`Successfully loaded Component Model plugin: ${pluginId}`)

      return pluginInstance
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      debug(`Failed to load Component Model plugin ${pluginId}: ${errorMsg}`)
      if (error instanceof Error && error.stack) {
        debug(`Stack trace: ${error.stack}`)
      }
      throw new Error(`Failed to load Component Model plugin ${pluginId}: ${errorMsg}`)
    }
  }

  /**
   * Create Signal K API imports for a Component Model plugin
   */
  private createComponentSignalkApi(pluginId: string, app?: any) {
    return {
      skDebug: (message: string) => {
        debug(`[${pluginId}] ${message}`)
      },
      'sk-debug': (message: string) => {
        debug(`[${pluginId}] ${message}`)
      },
      skSetStatus: (message: string) => {
        debug(`[${pluginId}] Status: ${message}`)
        if (app && app.setPluginStatus) {
          app.setPluginStatus(pluginId, message)
        }
      },
      'sk-set-status': (message: string) => {
        debug(`[${pluginId}] Status: ${message}`)
        if (app && app.setPluginStatus) {
          app.setPluginStatus(pluginId, message)
        }
      },
      skSetError: (message: string) => {
        debug(`[${pluginId}] Error: ${message}`)
        if (app && app.setPluginError) {
          app.setPluginError(pluginId, message)
        }
      },
      'sk-set-error': (message: string) => {
        debug(`[${pluginId}] Error: ${message}`)
        if (app && app.setPluginError) {
          app.setPluginError(pluginId, message)
        }
      },
      skHandleMessage: (deltaJson: string) => {
        debug(`[${pluginId}] Emitting delta: ${deltaJson.substring(0, 200)}...`)
        if (app && app.handleMessage) {
          try {
            const delta = JSON.parse(deltaJson)
            app.handleMessage(pluginId, delta)
          } catch (error) {
            debug(`Failed to parse delta JSON: ${error}`)
          }
        }
      },
      'sk-handle-message': (deltaJson: string) => {
        debug(`[${pluginId}] Emitting delta: ${deltaJson.substring(0, 200)}...`)
        if (app && app.handleMessage) {
          try {
            const delta = JSON.parse(deltaJson)
            app.handleMessage(pluginId, delta)
          } catch (error) {
            debug(`Failed to parse delta JSON: ${error}`)
          }
        }
      },
      skRegisterPutHandler: (context: string, path: string) => {
        debug(`[${pluginId}] Registering PUT handler: ${context} ${path}`)
        // PUT handler registration would need additional implementation
        return 0
      },
      'sk-register-put-handler': (context: string, path: string) => {
        debug(`[${pluginId}] Registering PUT handler: ${context} ${path}`)
        return 0
      }
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
